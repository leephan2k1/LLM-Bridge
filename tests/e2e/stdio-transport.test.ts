import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";

describe("Subprocess Stdio Protocol E2E", () => {
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  const tempDbPath = path.resolve(process.cwd(), "test-stdio.db");

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }
    if (transport) {
      await transport.close();
      transport = undefined;
    }
    // Clean up temporary database files
    for (const file of [tempDbPath, `${tempDbPath}-wal`, `${tempDbPath}-shm`]) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore
        }
      }
    }
  });

  it("should communicate with the server subprocess over stdio transport", async () => {
    const serverScript = path.resolve(process.cwd(), "dist/index.js");

    transport = new StdioClientTransport({
      command: "node",
      args: [serverScript],
      env: {
        ...process.env,
        HUB_DB_PATH: tempDbPath,
        HUB_LOG_LEVEL: "warn",
      },
    });

    client = new Client(
      { name: "stdio-e2e-client", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    await client.connect(transport);

    const toolsResult = await client.listTools();
    expect(toolsResult.tools.length).toBeGreaterThan(0);

    const regResult = await client.callTool({
      name: "register_agent",
      arguments: {
        agent_id: "test-agent",
        display_name: "Test Agent",
      },
    });

    expect(regResult.isError).toBeFalsy();
    const text = (regResult.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("test-agent");
  });
});

