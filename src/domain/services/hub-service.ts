import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Agent,
  Channel,
  ContentFormat,
  InboxMessage,
  Message,
  MessageType,
  Session,
  Task,
  TaskStatus,
} from "../types.js";
import { logger } from "../../observability/logger.js";

export class HubService {
  constructor(private db: Database.Database) {}

  // -------------------------------------------------------------
  // Agent Management
  // -------------------------------------------------------------

  registerAgent(input: {
    agentId: string;
    displayName?: string;
    capabilities?: string[];
    clientInstanceId?: string;
  }): { agent: Agent; clientInstanceId: string } {
    const now = new Date().toISOString();
    const displayName = input.displayName || input.agentId;
    const capabilities = JSON.stringify(input.capabilities || ["messaging"]);
    const clientInstanceId = input.clientInstanceId || `inst_${randomUUID()}`;

    const upsertAgent = this.db.prepare(`
      INSERT INTO agents (agent_id, display_name, capabilities, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        display_name = excluded.display_name,
        capabilities = excluded.capabilities,
        updated_at = excluded.updated_at
    `);

    const upsertInstance = this.db.prepare(`
      INSERT INTO client_instances (instance_id, agent_id, last_seen)
      VALUES (?, ?, ?)
      ON CONFLICT(instance_id) DO UPDATE SET
        last_seen = excluded.last_seen
    `);

    const transaction = this.db.transaction(() => {
      upsertAgent.run(input.agentId, displayName, capabilities, now, now);
      upsertInstance.run(clientInstanceId, input.agentId, now);
    });

    transaction();

    logger.info("Agent registered", { agentId: input.agentId, clientInstanceId });

    return {
      agent: {
        agentId: input.agentId,
        displayName,
        capabilities: input.capabilities || ["messaging"],
        createdAt: now,
        updatedAt: now,
        lastSeen: now,
      },
      clientInstanceId,
    };
  }

  touchAgent(agentId: string, clientInstanceId?: string) {
    const now = new Date().toISOString();
    if (clientInstanceId) {
      this.db
        .prepare(`
          INSERT INTO client_instances (instance_id, agent_id, last_seen)
          VALUES (?, ?, ?)
          ON CONFLICT(instance_id) DO UPDATE SET last_seen = excluded.last_seen
        `)
        .run(clientInstanceId, agentId, now);
    }
  }

  listAgents(): Agent[] {
    const rows = this.db
      .prepare(`
        SELECT a.agent_id, a.display_name, a.capabilities, a.created_at, a.updated_at,
               MAX(ci.last_seen) as last_seen
        FROM agents a
        LEFT JOIN client_instances ci ON a.agent_id = ci.agent_id
        GROUP BY a.agent_id
        ORDER BY a.agent_id ASC
      `)
      .all() as Array<{
      agent_id: string;
      display_name: string;
      capabilities: string;
      created_at: string;
      updated_at: string;
      last_seen: string | null;
    }>;

    return rows.map((r) => ({
      agentId: r.agent_id,
      displayName: r.display_name,
      capabilities: JSON.parse(r.capabilities || "[]"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastSeen: r.last_seen || undefined,
    }));
  }

  private ensureAgentExists(agentId: string) {
    const agent = this.db
      .prepare("SELECT agent_id FROM agents WHERE agent_id = ?")
      .get(agentId);
    if (!agent) {
      this.registerAgent({ agentId, displayName: agentId });
    }
  }

  // -------------------------------------------------------------
  // Session & Channel Management
  // -------------------------------------------------------------

  createSession(input: {
    sessionId: string;
    name: string;
    description?: string;
    participants: string[];
  }): Session {
    const existing = this.db
      .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
      .get(input.sessionId);
    if (existing) {
      throw new Error(`Session with ID '${input.sessionId}' already exists.`);
    }

    const now = new Date().toISOString();
    const insertSession = this.db.prepare(`
      INSERT INTO sessions (session_id, name, description, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertParticipant = this.db.prepare(`
      INSERT INTO session_participants (session_id, agent_id)
      VALUES (?, ?)
    `);

    const insertChannel = this.db.prepare(`
      INSERT INTO channels (session_id, channel_id, name, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertSession.run(input.sessionId, input.name, input.description || null, now);

      for (const p of input.participants) {
        this.ensureAgentExists(p);
        insertParticipant.run(input.sessionId, p);
      }

      // Automatically create a default 'general' channel
      insertChannel.run(input.sessionId, "general", "General", "Default general channel", now);
    });

    transaction();

    logger.info("Session created", { sessionId: input.sessionId, participants: input.participants });

    return {
      sessionId: input.sessionId,
      name: input.name,
      description: input.description,
      createdAt: now,
      participants: input.participants,
      channels: [
        {
          sessionId: input.sessionId,
          channelId: "general",
          name: "General",
          description: "Default general channel",
          createdAt: now,
        },
      ],
    };
  }

  joinSession(sessionId: string, agentId: string) {
    const session = this.db
      .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
      .get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found.`);
    }

    this.ensureAgentExists(agentId);

    this.db
      .prepare(`
        INSERT INTO session_participants (session_id, agent_id)
        VALUES (?, ?)
        ON CONFLICT(session_id, agent_id) DO NOTHING
      `)
      .run(sessionId, agentId);

    logger.info("Agent joined session", { sessionId, agentId });
  }

  listSessions(agentId?: string): Session[] {
    let query = "SELECT session_id, name, description, created_at FROM sessions";
    const params: unknown[] = [];

    if (agentId) {
      query += ` WHERE session_id IN (
        SELECT session_id FROM session_participants WHERE agent_id = ?
      )`;
      params.push(agentId);
    }

    query += " ORDER BY created_at DESC";

    const sessions = this.db.prepare(query).all(...params) as Array<{
      session_id: string;
      name: string;
      description: string | null;
      created_at: string;
    }>;

    return sessions.map((s) => {
      const participants = (
        this.db
          .prepare("SELECT agent_id FROM session_participants WHERE session_id = ?")
          .all(s.session_id) as Array<{ agent_id: string }>
      ).map((p) => p.agent_id);

      const channels = (
        this.db
          .prepare("SELECT session_id, channel_id, name, description, created_at FROM channels WHERE session_id = ?")
          .all(s.session_id) as Array<{
          session_id: string;
          channel_id: string;
          name: string;
          description: string | null;
          created_at: string;
        }>
      ).map((c) => ({
        sessionId: c.session_id,
        channelId: c.channel_id,
        name: c.name,
        description: c.description || undefined,
        createdAt: c.created_at,
      }));

      return {
        sessionId: s.session_id,
        name: s.name,
        description: s.description || undefined,
        createdAt: s.created_at,
        participants,
        channels,
      };
    });
  }

  createChannel(
    sessionId: string,
    channelId: string,
    name?: string,
    description?: string
  ): Channel {
    const session = this.db
      .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
      .get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found.`);
    }

    const now = new Date().toISOString();
    const chName = name || channelId;

    this.db
      .prepare(`
        INSERT INTO channels (session_id, channel_id, name, description, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id, channel_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description
      `)
      .run(sessionId, channelId, chName, description || null, now);

    return {
      sessionId,
      channelId,
      name: chName,
      description,
      createdAt: now,
    };
  }

  listChannels(sessionId: string): Channel[] {
    const rows = this.db
      .prepare("SELECT session_id, channel_id, name, description, created_at FROM channels WHERE session_id = ?")
      .all(sessionId) as Array<{
      session_id: string;
      channel_id: string;
      name: string;
      description: string | null;
      created_at: string;
    }>;

    return rows.map((c) => ({
      sessionId: c.session_id,
      channelId: c.channel_id,
      name: c.name,
      description: c.description || undefined,
      createdAt: c.created_at,
    }));
  }

  // -------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------

  sendMessage(input: {
    sessionId: string;
    channelId: string;
    fromAgentId: string;
    fromInstanceId?: string;
    to: string | string[];
    threadId?: string;
    parentMessageId?: string;
    messageType?: MessageType;
    content: string;
    contentFormat?: ContentFormat;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }): { messageId: string; threadId: string; createdAt: string; recipients: string[] } {
    // 1. Check idempotency
    if (input.idempotencyKey) {
      const existing = this.db
        .prepare("SELECT id, thread_id, created_at FROM messages WHERE idempotency_key = ?")
        .get(input.idempotencyKey) as { id: string; thread_id: string; created_at: string } | undefined;

      if (existing) {
        const recipients = (
          this.db
            .prepare("SELECT agent_id FROM message_recipients WHERE message_id = ?")
            .all(existing.id) as Array<{ agent_id: string }>
        ).map((r) => r.agent_id);

        return {
          messageId: existing.id,
          threadId: existing.thread_id,
          createdAt: existing.created_at,
          recipients,
        };
      }
    }

    // 2. Validate session
    const session = this.db
      .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
      .get(input.sessionId);
    if (!session) {
      throw new Error(`Session '${input.sessionId}' not found.`);
    }

    // 3. Ensure sender is in session
    this.ensureAgentExists(input.fromAgentId);
    this.joinSession(input.sessionId, input.fromAgentId);

    // 4. Ensure channel exists
    const channel = this.db
      .prepare("SELECT channel_id FROM channels WHERE session_id = ? AND channel_id = ?")
      .get(input.sessionId, input.channelId);
    if (!channel) {
      this.createChannel(input.sessionId, input.channelId);
    }

    // 5. Resolve recipients
    const sessionParticipants = (
      this.db
        .prepare("SELECT agent_id FROM session_participants WHERE session_id = ?")
        .all(input.sessionId) as Array<{ agent_id: string }>
    ).map((p) => p.agent_id);

    let recipientIds: string[] = [];
    if (input.to === "*" || input.to === "all") {
      recipientIds = sessionParticipants.filter((id) => id !== input.fromAgentId);
    } else {
      const toList = Array.isArray(input.to) ? input.to : [input.to];
      recipientIds = [...new Set(toList)];

      // Auto-add recipients to session if not yet present
      for (const recId of recipientIds) {
        this.ensureAgentExists(recId);
        this.joinSession(input.sessionId, recId);
      }
    }

    // 6. Resolve thread
    let threadId = input.threadId;
    if (input.parentMessageId && !threadId) {
      const parent = this.db
        .prepare("SELECT thread_id FROM messages WHERE id = ?")
        .get(input.parentMessageId) as { thread_id: string } | undefined;
      if (parent) {
        threadId = parent.thread_id;
      }
    }

    const messageId = `msg_${randomUUID()}`;
    if (!threadId) {
      threadId = `th_${messageId}`;
    }

    const now = new Date().toISOString();

    const insertThread = this.db.prepare(`
      INSERT INTO threads (thread_id, session_id, channel_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id) DO NOTHING
    `);

    const insertMessage = this.db.prepare(`
      INSERT INTO messages (
        id, session_id, channel_id, thread_id, parent_message_id,
        from_agent_id, from_instance_id, type, content, content_format,
        idempotency_key, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRecipient = this.db.prepare(`
      INSERT INTO message_recipients (message_id, agent_id)
      VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertThread.run(threadId, input.sessionId, input.channelId, now);
      insertMessage.run(
        messageId,
        input.sessionId,
        input.channelId,
        threadId,
        input.parentMessageId || null,
        input.fromAgentId,
        input.fromInstanceId || null,
        input.messageType || "message",
        input.content,
        input.contentFormat || "markdown",
        input.idempotencyKey || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now
      );

      for (const recId of recipientIds) {
        insertRecipient.run(messageId, recId);
      }
    });

    transaction();

    logger.info("Message sent", {
      messageId,
      threadId,
      from: input.fromAgentId,
      recipients: recipientIds,
    });

    return {
      messageId,
      threadId,
      createdAt: now,
      recipients: recipientIds,
    };
  }

  replyToMessage(input: {
    messageId: string;
    fromAgentId: string;
    fromInstanceId?: string;
    content: string;
    messageType?: MessageType;
    metadata?: Record<string, unknown>;
  }) {
    const parent = this.db
      .prepare(`
        SELECT id, session_id, channel_id, thread_id, from_agent_id
        FROM messages WHERE id = ?
      `)
      .get(input.messageId) as
      | {
          id: string;
          session_id: string;
          channel_id: string;
          thread_id: string;
          from_agent_id: string;
        }
      | undefined;

    if (!parent) {
      throw new Error(`Message with ID '${input.messageId}' not found.`);
    }

    return this.sendMessage({
      sessionId: parent.session_id,
      channelId: parent.channel_id,
      fromAgentId: input.fromAgentId,
      fromInstanceId: input.fromInstanceId,
      to: parent.from_agent_id,
      parentMessageId: parent.id,
      threadId: parent.thread_id,
      messageType: input.messageType || "message",
      content: input.content,
      metadata: input.metadata,
    });
  }

  readInbox(input: {
    agentId: string;
    sessionId?: string;
    channelId?: string;
    limit?: number;
    cursor?: string;
    unreadOnly?: boolean;
  }): { messages: InboxMessage[]; unreadCount: number; nextCursor?: string } {
    this.ensureAgentExists(input.agentId);

    const limit = Math.min(Math.max(input.limit || 20, 1), 100);

    let whereClause = "mr.agent_id = ?";
    const params: unknown[] = [input.agentId];

    if (input.sessionId) {
      whereClause += " AND m.session_id = ?";
      params.push(input.sessionId);
    }

    if (input.channelId) {
      whereClause += " AND m.channel_id = ?";
      params.push(input.channelId);
    }

    if (input.unreadOnly) {
      whereClause += " AND r.read_at IS NULL";
    }

    if (input.cursor) {
      whereClause += " AND m.created_at < ?";
      params.push(input.cursor);
    }

    // Get unread count
    const countRow = this.db
      .prepare(`
        SELECT COUNT(*) as count
        FROM message_recipients mr
        JOIN messages m ON mr.message_id = m.id
        LEFT JOIN message_reads r ON mr.message_id = r.message_id AND mr.agent_id = r.agent_id
        WHERE mr.agent_id = ? AND r.read_at IS NULL
      `)
      .get(input.agentId) as { count: number };

    // Fetch messages
    const rows = this.db
      .prepare(`
        SELECT m.id, m.session_id, m.channel_id, m.thread_id, m.parent_message_id,
               m.from_agent_id, m.from_instance_id, m.type, m.content, m.content_format,
               m.correlation_id, m.idempotency_key, m.metadata, m.created_at,
               r.read_at
        FROM message_recipients mr
        JOIN messages m ON mr.message_id = m.id
        LEFT JOIN message_reads r ON mr.message_id = r.message_id AND mr.agent_id = r.agent_id
        WHERE ${whereClause}
        ORDER BY m.created_at DESC
        LIMIT ?
      `)
      .all(...params, limit) as Array<{
      id: string;
      session_id: string;
      channel_id: string;
      thread_id: string;
      parent_message_id: string | null;
      from_agent_id: string;
      from_instance_id: string | null;
      type: MessageType;
      content: string;
      content_format: ContentFormat;
      correlation_id: string | null;
      idempotency_key: string | null;
      metadata: string | null;
      created_at: string;
      read_at: string | null;
    }>;

    const messages: InboxMessage[] = rows.map((r) => {
      const toRecipients = (
        this.db
          .prepare("SELECT agent_id FROM message_recipients WHERE message_id = ?")
          .all(r.id) as Array<{ agent_id: string }>
      ).map((rec) => rec.agent_id);

      return {
        id: r.id,
        sessionId: r.session_id,
        channelId: r.channel_id,
        threadId: r.thread_id,
        parentMessageId: r.parent_message_id || undefined,
        fromAgentId: r.from_agent_id,
        fromInstanceId: r.from_instance_id || undefined,
        toAgentIds: toRecipients,
        type: r.type,
        content: r.content,
        contentFormat: r.content_format,
        createdAt: r.created_at,
        correlationId: r.correlation_id || undefined,
        idempotencyKey: r.idempotency_key || undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        isRead: !!r.read_at,
        readAt: r.read_at || undefined,
      };
    });

    const nextCursor =
      rows.length === limit ? rows[rows.length - 1].created_at : undefined;

    return {
      messages,
      unreadCount: countRow.count,
      nextCursor,
    };
  }

  getThread(threadId: string): {
    threadId: string;
    sessionId?: string;
    channelId?: string;
    messages: Message[];
  } {
    const thread = this.db
      .prepare("SELECT thread_id, session_id, channel_id FROM threads WHERE thread_id = ?")
      .get(threadId) as
      | { thread_id: string; session_id: string; channel_id: string }
      | undefined;

    if (!thread) {
      throw new Error(`Thread '${threadId}' not found.`);
    }

    const rows = this.db
      .prepare(`
        SELECT id, session_id, channel_id, thread_id, parent_message_id,
               from_agent_id, from_instance_id, type, content, content_format,
               correlation_id, idempotency_key, metadata, created_at
        FROM messages
        WHERE thread_id = ?
        ORDER BY created_at ASC
      `)
      .all(threadId) as Array<{
      id: string;
      session_id: string;
      channel_id: string;
      thread_id: string;
      parent_message_id: string | null;
      from_agent_id: string;
      from_instance_id: string | null;
      type: MessageType;
      content: string;
      content_format: ContentFormat;
      correlation_id: string | null;
      idempotency_key: string | null;
      metadata: string | null;
      created_at: string;
    }>;

    const messages: Message[] = rows.map((r) => {
      const toRecipients = (
        this.db
          .prepare("SELECT agent_id FROM message_recipients WHERE message_id = ?")
          .all(r.id) as Array<{ agent_id: string }>
      ).map((rec) => rec.agent_id);

      return {
        id: r.id,
        sessionId: r.session_id,
        channelId: r.channel_id,
        threadId: r.thread_id,
        parentMessageId: r.parent_message_id || undefined,
        fromAgentId: r.from_agent_id,
        fromInstanceId: r.from_instance_id || undefined,
        toAgentIds: toRecipients,
        type: r.type,
        content: r.content,
        contentFormat: r.content_format,
        createdAt: r.created_at,
        correlationId: r.correlation_id || undefined,
        idempotencyKey: r.idempotency_key || undefined,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      };
    });

    return {
      threadId: thread.thread_id,
      sessionId: thread.session_id,
      channelId: thread.channel_id,
      messages,
    };
  }

  markMessageRead(messageId: string, agentId: string): { messageId: string; readAt: string } {
    const msg = this.db.prepare("SELECT id FROM messages WHERE id = ?").get(messageId);
    if (!msg) {
      throw new Error(`Message '${messageId}' not found.`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO message_reads (message_id, agent_id, read_at)
        VALUES (?, ?, ?)
        ON CONFLICT(message_id, agent_id) DO UPDATE SET read_at = excluded.read_at
      `)
      .run(messageId, agentId, now);

    return { messageId, readAt: now };
  }

  // -------------------------------------------------------------
  // Optional Task Coordination
  // -------------------------------------------------------------

  createTask(input: {
    sessionId: string;
    title: string;
    description?: string;
    assigneeId?: string;
    creatorId: string;
    metadata?: Record<string, unknown>;
  }): Task {
    const session = this.db
      .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
      .get(input.sessionId);
    if (!session) {
      throw new Error(`Session '${input.sessionId}' not found.`);
    }

    const taskId = `task_${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO tasks (
          task_id, session_id, title, description, assignee_id,
          creator_id, status, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
      `)
      .run(
        taskId,
        input.sessionId,
        input.title,
        input.description || null,
        input.assigneeId || null,
        input.creatorId,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        now
      );

    return {
      id: taskId,
      sessionId: input.sessionId,
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      creatorId: input.creatorId,
      status: "open",
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateTaskStatus(taskId: string, status: TaskStatus): Task {
    const task = this.getTask(taskId);
    const now = new Date().toISOString();

    this.db
      .prepare(`
        UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?
      `)
      .run(status, now, taskId);

    return {
      ...task,
      status,
      updatedAt: now,
    };
  }

  getTask(taskId: string): Task {
    const row = this.db
      .prepare(`
        SELECT task_id, session_id, title, description, assignee_id,
               creator_id, status, metadata, created_at, updated_at
        FROM tasks WHERE task_id = ?
      `)
      .get(taskId) as
      | {
          task_id: string;
          session_id: string;
          title: string;
          description: string | null;
          assignee_id: string | null;
          creator_id: string;
          status: TaskStatus;
          metadata: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      throw new Error(`Task '${taskId}' not found.`);
    }

    return {
      id: row.task_id,
      sessionId: row.session_id,
      title: row.title,
      description: row.description || undefined,
      assigneeId: row.assignee_id || undefined,
      creatorId: row.creator_id,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
