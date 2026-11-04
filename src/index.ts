#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/index.js";
import { initDatabase } from "./persistence/database.js";
import { HubService } from "./domain/services/hub-service.js";
import { createMcpServer } from "./server/create-server.js";
import { globalEventBus } from "./events/event-bus.js";
import { logger } from "./observability/logger.js";

async function main() {
  const config = loadConfig();
  logger.info("Starting LLM Bridge MCP Server", {
    name: config.serverName,
    version: config.serverVersion,
    dbPath: config.dbPath,
  });

  await globalEventBus.start();

  const db = initDatabase(config.dbPath);
  const hub = new HubService(db, globalEventBus);
  const server = createMcpServer(hub, config);

  const transport = new StdioServerTransport();

  const shutdown = async () => {
    logger.info("Shutting down LLM Bridge MCP Server...");
    try {
      await globalEventBus.stop();
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  logger.info("LLM Bridge MCP Server running on stdio");
}

main().catch((err) => {
  logger.error("Fatal error starting server", { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});

