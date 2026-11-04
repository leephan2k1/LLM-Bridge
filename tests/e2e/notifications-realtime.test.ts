import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/persistence/database.js";
import { HubService } from "../../src/domain/services/hub-service.js";
import { createMcpServer } from "../../src/server/create-server.js";
import { HubEventBus } from "../../src/events/event-bus.js";
import type { HubConfig } from "../../src/config/index.js";

describe("MCP Real-Time Notifications & Autonomous Dialogue", () => {
  let db: Database.Database;
  let eventBus: HubEventBus;
  let hub: HubService;
  let clientGemini: Client;
  let clientClaude: Client;

  const testConfig: HubConfig = {
    dbPath: ":memory:",
    serverName: "llm-bridge-realtime",
    serverVersion: "1.0.0",
    logLevel: "error",
  };

  beforeEach(async () => {
    db = initDatabase(":memory:");
    eventBus = new HubEventBus("/tmp/test-llm-bridge-rt.sock");
    await eventBus.start();

    hub = new HubService(db, eventBus);
    const server = createMcpServer(hub, testConfig);

    const [cTransport1, sTransport1] = InMemoryTransport.createLinkedPair();
    const [cTransport2, sTransport2] = InMemoryTransport.createLinkedPair();

    clientGemini = new Client(
      { name: "gemini-client", version: "1.0.0" },
      { capabilities: { tools: {}, resources: { subscribe: true } } }
    );

    clientClaude = new Client(
      { name: "claude-client", version: "1.0.0" },
      { capabilities: { tools: {}, resources: { subscribe: true } } }
    );

    await Promise.all([
      server.connect(sTransport1),
      clientGemini.connect(cTransport1),
    ]);

    // Create a second server connected to the same hub/db/eventBus
    const server2 = createMcpServer(hub, testConfig);
    await Promise.all([
      server2.connect(sTransport2),
      clientClaude.connect(cTransport2),
    ]);

    // Register both agents and session
    hub.registerAgent({ agentId: "gemini-agent", displayName: "Gemini" });
    hub.registerAgent({ agentId: "claude-agent", displayName: "Claude" });
    hub.createSession({
      sessionId: "realtime-session",
      name: "Realtime Session",
      participants: ["gemini-agent", "claude-agent"],
    });
  });

  afterEach(async () => {
    await clientGemini.close();
    await clientClaude.close();
    await eventBus.stop();
    db.close();
  });

  it("should push notifications/resources/updated to Claude when Gemini sends a message", async () => {
    const receivedUris: string[] = [];

    // Claude subscribes to its inbox resource
    await clientClaude.subscribeResource({ uri: "hub://inbox/claude-agent" });

    // Claude listens for notifications
    clientClaude.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
      receivedUris.push(notification.params.uri);
    });

    // Gemini sends a message to Claude
    await clientGemini.callTool({
      name: "send_message",
      arguments: {
        session_id: "realtime-session",
        channel_id: "general",
        from_agent_id: "gemini-agent",
        to: "claude-agent",
        content: "Hey Claude, wake up in real-time!",
      },
    });

    // Small delay for event tick
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedUris).toContain("hub://inbox/claude-agent");
    expect(receivedUris).toContain("hub://sessions/realtime-session");
  });

  it("should wake up immediately using wait_for_message tool when peer sends a message", async () => {
    // Claude starts waiting for a message asynchronously
    const waitPromise = clientClaude.callTool({
      name: "wait_for_message",
      arguments: {
        agent_id: "claude-agent",
        session_id: "realtime-session",
        timeout_seconds: 5,
      },
    });

    // Gemini sends message 50ms later
    setTimeout(async () => {
      await clientGemini.callTool({
        name: "send_message",
        arguments: {
          session_id: "realtime-session",
          channel_id: "general",
          from_agent_id: "gemini-agent",
          to: "claude-agent",
          content: "Prompt-free wake-up message",
        },
      });
    }, 50);

    const result = await waitPromise;
    expect(result.isError).toBeFalsy();

    const data = JSON.parse(
      (result.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(data.timedOut).toBe(false);
    expect(data.event.content).toBe("Prompt-free wake-up message");
    expect(data.event.fromAgentId).toBe("gemini-agent");
  });

  it("should support synchronous send_message with wait_for_reply", async () => {
    // 1. Claude waits in background and automatically replies when Gemini asks
    const claudeAutoReplyPromise = (async () => {
      const waitResult = await clientClaude.callTool({
        name: "wait_for_message",
        arguments: {
          agent_id: "claude-agent",
          session_id: "realtime-session",
          timeout_seconds: 5,
        },
      });

      const waitData = JSON.parse(
        (waitResult.content as Array<{ type: string; text: string }>)[0].text
      );

      // Immediately send reply
      await clientClaude.callTool({
        name: "reply_to_message",
        arguments: {
          message_id: waitData.event.messageId,
          from_agent_id: "claude-agent",
          content: "I received it immediately and here is my instant review!",
        },
      });
    })();

    // 2. Gemini sends message and waits for reply in the same tool call!
    const geminiSendResult = await clientGemini.callTool({
      name: "send_message",
      arguments: {
        session_id: "realtime-session",
        channel_id: "general",
        from_agent_id: "gemini-agent",
        to: "claude-agent",
        content: "Need your review now",
        wait_for_reply: true,
        timeout_seconds: 5,
      },
    });

    await claudeAutoReplyPromise;

    const sendData = JSON.parse(
      (geminiSendResult.content as Array<{ type: string; text: string }>)[0].text
    );

    expect(sendData.replyReceived).toBe(true);
    expect(sendData.reply.content).toContain("I received it immediately");
    expect(sendData.reply.fromAgentId).toBe("claude-agent");
  });
});
