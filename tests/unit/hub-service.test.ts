import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/persistence/database.js";
import { HubService } from "../../src/domain/services/hub-service.js";

describe("HubService Unit Tests", () => {
  let db: Database.Database;
  let hub: HubService;

  beforeEach(() => {
    // In-memory database for fast and clean unit tests
    db = initDatabase(":memory:");
    hub = new HubService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("should register and list agents", () => {
    const reg = hub.registerAgent({
      agentId: "gemini-antigravity",
      displayName: "Gemini",
      capabilities: ["coding", "review"],
    });

    expect(reg.agent.agentId).toBe("gemini-antigravity");
    expect(reg.agent.displayName).toBe("Gemini");
    expect(reg.agent.capabilities).toEqual(["coding", "review"]);

    const agents = hub.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("gemini-antigravity");
  });

  it("should create session and default channel", () => {
    hub.registerAgent({ agentId: "gemini-antigravity" });
    hub.registerAgent({ agentId: "claude-code" });

    const session = hub.createSession({
      sessionId: "feat-123",
      name: "Feature 123",
      description: "Test session",
      participants: ["gemini-antigravity", "claude-code"],
    });

    expect(session.sessionId).toBe("feat-123");
    expect(session.participants).toEqual(["gemini-antigravity", "claude-code"]);
    expect(session.channels).toHaveLength(1);
    expect(session.channels?.[0].channelId).toBe("general");

    const sessions = hub.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("feat-123");
  });

  it("should send message and support idempotency", () => {
    hub.createSession({
      sessionId: "s1",
      name: "Session 1",
      participants: ["agent-a", "agent-b"],
    });

    const msg1 = hub.sendMessage({
      sessionId: "s1",
      channelId: "general",
      fromAgentId: "agent-a",
      to: "agent-b",
      content: "Hello Agent B!",
      idempotencyKey: "idem-key-1",
    });

    expect(msg1.messageId).toBeDefined();
    expect(msg1.recipients).toEqual(["agent-b"]);

    // Repeated send with same idempotency key should return original message
    const msg2 = hub.sendMessage({
      sessionId: "s1",
      channelId: "general",
      fromAgentId: "agent-a",
      to: "agent-b",
      content: "Hello again with same key",
      idempotencyKey: "idem-key-1",
    });

    expect(msg2.messageId).toBe(msg1.messageId);
  });

  it("should read inbox, mark read, and calculate unread count", () => {
    hub.createSession({
      sessionId: "s1",
      name: "Session 1",
      participants: ["alice", "bob"],
    });

    hub.sendMessage({
      sessionId: "s1",
      channelId: "general",
      fromAgentId: "alice",
      to: "bob",
      content: "Message 1 for Bob",
    });

    hub.sendMessage({
      sessionId: "s1",
      channelId: "general",
      fromAgentId: "alice",
      to: "bob",
      content: "Message 2 for Bob",
    });

    let inbox = hub.readInbox({ agentId: "bob" });
    expect(inbox.messages).toHaveLength(2);
    expect(inbox.unreadCount).toBe(2);

    // Mark first message read
    hub.markMessageRead(inbox.messages[0].id, "bob");

    inbox = hub.readInbox({ agentId: "bob" });
    expect(inbox.unreadCount).toBe(1);

    // Filter unread only
    const unreadInbox = hub.readInbox({ agentId: "bob", unreadOnly: true });
    expect(unreadInbox.messages).toHaveLength(1);
  });

  it("should support reply_to_message and retrieve thread history", () => {
    hub.createSession({
      sessionId: "review-session",
      name: "Review Session",
      participants: ["gemini", "claude"],
    });

    // 1. Gemini sends review request
    const req = hub.sendMessage({
      sessionId: "review-session",
      channelId: "general",
      fromAgentId: "gemini",
      to: "claude",
      messageType: "review_request",
      content: "Please review my PR",
    });

    // 2. Claude replies
    const reply = hub.replyToMessage({
      messageId: req.messageId,
      fromAgentId: "claude",
      messageType: "review_result",
      content: "Looks good to me! LGTM.",
    });

    expect(reply.threadId).toBe(req.threadId);
    expect(reply.recipients).toEqual(["gemini"]);

    // 3. Check thread
    const thread = hub.getThread(req.threadId);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].content).toBe("Please review my PR");
    expect(thread.messages[1].content).toBe("Looks good to me! LGTM.");
    expect(thread.messages[1].parentMessageId).toBe(req.messageId);
  });

  it("should create and update tasks", () => {
    hub.createSession({
      sessionId: "task-session",
      name: "Task Session",
      participants: ["lead", "dev"],
    });

    const task = hub.createTask({
      sessionId: "task-session",
      title: "Write documentation",
      assigneeId: "dev",
      creatorId: "lead",
    });

    expect(task.status).toBe("open");

    const updated = hub.updateTaskStatus(task.id, "in_progress");
    expect(updated.status).toBe("in_progress");

    const fetched = hub.getTask(task.id);
    expect(fetched.status).toBe("in_progress");
  });
});
