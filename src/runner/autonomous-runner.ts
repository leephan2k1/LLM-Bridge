#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";

interface AgentConfig {
  agentId: string;
  displayName: string;
  systemPrompt: string;
}

/**
 * Autonomous Runner demonstrates prompt-free, real-time reactive communication
 * between 2 LLM agents using MCP notifications.
 */
async function runAutonomousDialogue() {
  const serverPath = path.resolve(process.cwd(), "dist/index.js");

  console.log("==========================================================");
  console.log("  LLM Bridge — Autonomous Real-Time Multi-Agent Dialogue   ");
  console.log("==========================================================\n");

  // Create Client 1: Gemini
  const transport1 = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: { ...process.env, HUB_LOG_LEVEL: "error" },
  });
  const gemini = new Client({ name: "gemini-host", version: "1.0.0" }, { capabilities: {} });
  await gemini.connect(transport1);

  // Create Client 2: Claude
  const transport2 = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: { ...process.env, HUB_LOG_LEVEL: "error" },
  });
  const claude = new Client({ name: "claude-host", version: "1.0.0" }, { capabilities: {} });
  await claude.connect(transport2);

  // Register agents
  await gemini.callTool({
    name: "register_agent",
    arguments: { agent_id: "gemini", display_name: "Gemini Agent", capabilities: ["coding", "architecture"] },
  });
  await claude.callTool({
    name: "register_agent",
    arguments: { agent_id: "claude", display_name: "Claude Agent", capabilities: ["review", "security", "testing"] },
  });

  const sessionId = "session-" + Date.now().toString(36);
  await gemini.callTool({
    name: "create_session",
    arguments: {
      session_id: sessionId,
      name: "Autonomous Architecture Review",
      participants: ["gemini", "claude"],
    },
  });

  console.log(`[Hub] Session initialized: ${sessionId}`);
  console.log(`[Hub] Subscribing Claude to real-time inbox notifications...`);

  // Claude subscribes to its inbox resource
  await claude.subscribeResource({ uri: `hub://inbox/claude` });

  let turns = 0;
  const maxTurns = 4;

  // Set up Claude's real-time notification listener
  claude.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
    if (notification.params.uri !== `hub://inbox/claude`) return;
    if (turns >= maxTurns) return;

    // Read incoming message
    const inboxResult = await claude.callTool({
      name: "read_inbox",
      arguments: { agent_id: "claude", session_id: sessionId, unread_only: true },
    });
    const inbox = JSON.parse((inboxResult.content as Array<{ type: string; text: string }>)[0].text);

    for (const msg of inbox.messages) {
      turns++;
      console.log(`\n🔔 [Real-Time Notification received by Claude] from ${msg.fromAgentId}:`);
      console.log(`   "${msg.content}"`);

      // Mark as read
      await claude.callTool({
        name: "mark_message_read",
        arguments: { message_id: msg.id, agent_id: "claude" },
      });

      // Claude responds autonomously based on turn
      let replyContent = "";
      if (turns === 1) {
        replyContent = "Reviewing Auth Service: I noticed token revocation should use Redis blacklist instead of in-memory maps for distributed scaling.";
      } else if (turns === 3) {
        replyContent = "The Redis token blacklist approach looks robust! Security check PASSED. Ready for deployment.";
      }

      if (replyContent) {
        console.log(`\n💬 [Claude Auto-Reply turn ${turns}]: "${replyContent}"`);
        await claude.callTool({
          name: "reply_to_message",
          arguments: {
            message_id: msg.id,
            from_agent_id: "claude",
            content: replyContent,
            message_type: "review_result",
          },
        });
      }
    }
  });

  // Gemini sends the initial message and uses wait_for_reply to wait reactively
  console.log(`\n💬 [Gemini Initial Request]: "Please review the proposed Auth Service token design."`);
  const initialSend = await gemini.callTool({
    name: "send_message",
    arguments: {
      session_id: sessionId,
      channel_id: "general",
      from_agent_id: "gemini",
      to: "claude",
      message_type: "review_request",
      content: "Please review the proposed Auth Service token design.",
      wait_for_reply: true,
      timeout_seconds: 5,
    },
  });

  const sendResult = JSON.parse((initialSend.content as Array<{ type: string; text: string }>)[0].text);
  if (sendResult.replyReceived) {
    turns++;
    console.log(`\n🔔 [Real-Time Reply received by Gemini without prompt!]:`);
    console.log(`   "${sendResult.reply.content}"`);

    // Gemini sends turn 2
    console.log(`\n💬 [Gemini Turn 2]: "Great suggestion. I have updated the Auth Service to use Redis for token revocation."`);
    await gemini.callTool({
      name: "send_message",
      arguments: {
        session_id: sessionId,
        channel_id: "general",
        from_agent_id: "gemini",
        to: "claude",
        thread_id: sendResult.threadId,
        content: "Great suggestion. I have updated the Auth Service to use Redis for token revocation.",
        wait_for_reply: true,
        timeout_seconds: 5,
      },
    });
  }

  // Allow events to finish settling
  await new Promise((r) => setTimeout(r, 600));

  console.log("\n==========================================================");
  console.log("✅ Autonomous Dialogue Completed Successfully (0 human prompts needed)!");
  console.log("==========================================================\n");

  await gemini.close();
  await claude.close();
  process.exit(0);
}

runAutonomousDialogue().catch((err) => {
  console.error("Runner failed:", err);
  process.exit(1);
});
