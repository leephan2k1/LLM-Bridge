import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/persistence/database.js";
import { HubService } from "../../src/domain/services/hub-service.js";
import { createMcpServer } from "../../src/server/create-server.js";
import type { HubConfig } from "../../src/config/index.js";

describe("E2E MCP Server Protocol Tests", () => {
  let db: Database.Database;
  let hub: HubService;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  const testConfig: HubConfig = {
    dbPath: ":memory:",
    serverName: "llm-bridge-test",
    serverVersion: "1.0.0",
    logLevel: "error",
  };

  beforeEach(async () => {
    db = initDatabase(":memory:");
    hub = new HubService(db);
    const server = createMcpServer(hub, testConfig);

    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    db.close();
  });

  it("should list available tools on the MCP server", async () => {
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);

    expect(toolNames).toContain("register_agent");
    expect(toolNames).toContain("list_agents");
    expect(toolNames).toContain("create_session");
    expect(toolNames).toContain("list_sessions");
    expect(toolNames).toContain("join_session");
    expect(toolNames).toContain("create_channel");
    expect(toolNames).toContain("list_channels");
    expect(toolNames).toContain("send_message");
    expect(toolNames).toContain("reply_to_message");
    expect(toolNames).toContain("read_inbox");
    expect(toolNames).toContain("get_thread");
    expect(toolNames).toContain("mark_message_read");
    expect(toolNames).toContain("create_task");
    expect(toolNames).toContain("update_task_status");
    expect(toolNames).toContain("get_task");
  });

  it("should run full end-to-end communication workflow between Gemini and Claude", async () => {
    // 1. Register agents
    const regGemini = await client.callTool({
      name: "register_agent",
      arguments: {
        agent_id: "gemini-antigravity",
        display_name: "Gemini in Antigravity",
        capabilities: ["coding", "planning"],
      },
    });
    expect(regGemini.isError).toBeFalsy();

    const regClaude = await client.callTool({
      name: "register_agent",
      arguments: {
        agent_id: "claude-code",
        display_name: "Claude Code",
        capabilities: ["review", "testing"],
      },
    });
    expect(regClaude.isError).toBeFalsy();

    // 2. List agents
    const listAgentsResult = await client.callTool({
      name: "list_agents",
      arguments: {},
    });
    const parsedAgents = JSON.parse(
      (listAgentsResult.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(parsedAgents.some((a: { agentId: string }) => a.agentId === "gemini-antigravity")).toBeTruthy();
    expect(parsedAgents.some((a: { agentId: string }) => a.agentId === "claude-code")).toBeTruthy();

    // 3. Create a session
    const createSessionResult = await client.callTool({
      name: "create_session",
      arguments: {
        session_id: "ipbp-feature-123",
        name: "IPBP Feature 123",
        description: "Implement and review auth feature",
        participants: ["gemini-antigravity", "claude-code"],
      },
    });
    expect(createSessionResult.isError).toBeFalsy();

    // 4. Gemini sends a review request to Claude
    const sendResult = await client.callTool({
      name: "send_message",
      arguments: {
        session_id: "ipbp-feature-123",
        channel_id: "general",
        from_agent_id: "gemini-antigravity",
        to: "claude-code",
        message_type: "review_request",
        content: "Please review the new authentication service implementation.",
        metadata: { priority: "high" },
      },
    });
    expect(sendResult.isError).toBeFalsy();
    const sentMsg = JSON.parse(
      (sendResult.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(sentMsg.messageId).toBeDefined();
    expect(sentMsg.threadId).toBeDefined();

    // 5. Claude checks inbox
    const inboxResult = await client.callTool({
      name: "read_inbox",
      arguments: {
        agent_id: "claude-code",
        session_id: "ipbp-feature-123",
        unread_only: true,
      },
    });
    const inboxData = JSON.parse(
      (inboxResult.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(inboxData.messages).toHaveLength(1);
    expect(inboxData.messages[0].fromAgentId).toBe("gemini-antigravity");
    expect(inboxData.messages[0].content).toContain("authentication service");

    // 6. Claude marks message read
    await client.callTool({
      name: "mark_message_read",
      arguments: {
        message_id: sentMsg.messageId,
        agent_id: "claude-code",
      },
    });

    // 7. Claude replies to Gemini's message
    const replyResult = await client.callTool({
      name: "reply_to_message",
      arguments: {
        message_id: sentMsg.messageId,
        from_agent_id: "claude-code",
        message_type: "review_result",
        content: "LGTM! The auth middleware correctly handles token revocation.",
      },
    });
    expect(replyResult.isError).toBeFalsy();

    // 8. Gemini checks the thread
    const threadResult = await client.callTool({
      name: "get_thread",
      arguments: {
        thread_id: sentMsg.threadId,
      },
    });
    const threadData = JSON.parse(
      (threadResult.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(threadData.messages).toHaveLength(2);
    expect(threadData.messages[0].fromAgentId).toBe("gemini-antigravity");
    expect(threadData.messages[1].fromAgentId).toBe("claude-code");
    expect(threadData.messages[1].content).toContain("LGTM!");
  });

  it("should expose MCP resources and prompts", async () => {
    // Resources
    const resourcesList = await client.listResources();
    const uris = resourcesList.resources.map((r) => r.uri);
    expect(uris).toContain("hub://agents");
    expect(uris).toContain("hub://sessions");

    const agentsResource = await client.readResource({ uri: "hub://agents" });
    expect(agentsResource.contents[0].mimeType).toBe("application/json");

    // Prompts
    const promptsList = await client.listPrompts();
    const promptNames = promptsList.prompts.map((p) => p.name);
    expect(promptNames).toContain("agent-review");

    const promptResult = await client.getPrompt({
      name: "agent-review",
      arguments: { request_details: "Review AuthController" },
    });
    expect(promptResult.messages[0].content.type).toBe("text");
  });
});

