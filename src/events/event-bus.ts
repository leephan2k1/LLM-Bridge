import { EventEmitter } from "node:events";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../observability/logger.js";
import type { MessageType } from "../domain/types.js";

export interface HubEvent {
  type: "new_message";
  messageId: string;
  sessionId: string;
  channelId: string;
  threadId: string;
  fromAgentId: string;
  toAgentIds: string[];
  messageType: MessageType;
  content: string;
  createdAt: string;
}

export class HubEventBus extends EventEmitter {
  private ipcServer?: net.Server;
  private ipcClients: Set<net.Socket> = new Set();
  private outboundClient?: net.Socket;
  private socketPath: string;
  private isPrimary = false;

  constructor(socketPath?: string) {
    super();
    this.setMaxListeners(100);

    if (socketPath) {
      this.socketPath = socketPath;
    } else {
      if (os.platform() === "win32") {
        this.socketPath = "\\\\.\\pipe\\llm-bridge-ipc";
      } else {
        this.socketPath = path.join(os.tmpdir(), "llm-bridge-ipc.sock");
      }
    }
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      // Try to connect as client first. If connection fails, become server.
      const testSocket = net.connect(this.socketPath);

      testSocket.on("connect", () => {
        // A server is already running! We act as client.
        this.isPrimary = false;
        this.outboundClient = testSocket;
        this.setupClientSocket(testSocket);
        logger.info("Connected to existing IPC Event Bus server", { socketPath: this.socketPath });
        resolve();
      });

      testSocket.on("error", () => {
        // No server is running, or socket is stale. Clean up and become the server.
        testSocket.destroy();
        this.startServer().then(resolve);
      });
    });
  }

  private startServer(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (os.platform() !== "win32" && fs.existsSync(this.socketPath)) {
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          // ignore
        }
      }

      this.ipcServer = net.createServer((socket) => {
        this.ipcClients.add(socket);

        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event: HubEvent = JSON.parse(line);
              // Emit locally
              this.emit("event", event);
              // Forward to other connected clients
              this.broadcastToIpcClients(line, socket);
            } catch (err) {
              logger.error("Failed to parse IPC event line", { error: (err as Error).message });
            }
          }
        });

        socket.on("close", () => {
          this.ipcClients.delete(socket);
        });

        socket.on("error", () => {
          this.ipcClients.delete(socket);
        });
      });

      this.ipcServer.listen(this.socketPath, () => {
        this.isPrimary = true;
        logger.info("Started primary IPC Event Bus server", { socketPath: this.socketPath });
        resolve();
      });

      this.ipcServer.on("error", (err) => {
        logger.warn("IPC server error, fallback to memory-only event bus", { error: err.message });
        resolve();
      });
    });
  }

  private setupClientSocket(socket: net.Socket) {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event: HubEvent = JSON.parse(line);
          this.emit("event", event);
        } catch (err) {
          logger.error("Failed to parse incoming IPC event", { error: (err as Error).message });
        }
      }
    });

    socket.on("close", () => {
      this.outboundClient = undefined;
    });

    socket.on("error", (err) => {
      logger.warn("IPC outbound client connection error", { error: err.message });
      this.outboundClient = undefined;
    });
  }

  private broadcastToIpcClients(payload: string, except?: net.Socket) {
    for (const client of this.ipcClients) {
      if (client !== except && !client.destroyed) {
        try {
          client.write(payload + "\n");
        } catch {
          // ignore
        }
      }
    }
  }

  publish(event: HubEvent): void {
    // 1. Emit locally for listeners in this process
    this.emit("event", event);

    const payload = JSON.stringify(event);

    // 2. If we are server, broadcast to all connected clients
    if (this.isPrimary && this.ipcServer) {
      this.broadcastToIpcClients(payload);
    } else if (this.outboundClient && !this.outboundClient.destroyed) {
      // 3. If we are client, send to server to fan out
      try {
        this.outboundClient.write(payload + "\n");
      } catch (err) {
        logger.warn("Failed to write event to IPC server", { error: (err as Error).message });
      }
    }
  }

  waitForMessage(
    filter: {
      agentId: string;
      sessionId?: string;
      threadId?: string;
    },
    timeoutMs: number = 30000
  ): Promise<HubEvent | null> {
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;

      const handler = (event: HubEvent) => {
        if (event.type !== "new_message") return;

        const isRecipient =
          event.toAgentIds.includes(filter.agentId) || event.toAgentIds.includes("*");

        if (!isRecipient) return;

        if (filter.sessionId && event.sessionId !== filter.sessionId) return;
        if (filter.threadId && event.threadId !== filter.threadId) return;

        // Match found!
        if (timer) clearTimeout(timer);
        this.off("event", handler);
        resolve(event);
      };

      this.on("event", handler);

      timer = setTimeout(() => {
        this.off("event", handler);
        resolve(null);
      }, timeoutMs);
    });
  }

  async stop(): Promise<void> {
    if (this.outboundClient) {
      this.outboundClient.destroy();
      this.outboundClient = undefined;
    }
    for (const client of this.ipcClients) {
      client.destroy();
    }
    this.ipcClients.clear();

    if (this.ipcServer) {
      await new Promise<void>((resolve) => {
        this.ipcServer?.close(() => resolve());
      });
      this.ipcServer = undefined;
      if (os.platform() !== "win32" && fs.existsSync(this.socketPath)) {
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          // ignore
        }
      }
    }
  }
}

export const globalEventBus = new HubEventBus();

