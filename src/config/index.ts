import path from "node:path";

export interface HubConfig {
  dbPath: string;
  serverName: string;
  serverVersion: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(): HubConfig {
  const dbPath = process.env.HUB_DB_PATH
    ? path.resolve(process.cwd(), process.env.HUB_DB_PATH)
    : path.resolve(process.cwd(), "local-agent-hub.db");

  const logLevel = (process.env.HUB_LOG_LEVEL as HubConfig["logLevel"]) || "info";

  return {
    dbPath,
    serverName: "llm-bridge-hub",
    serverVersion: "1.0.0",
    logLevel,
  };
}

