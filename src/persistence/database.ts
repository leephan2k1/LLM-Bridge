import Database from "better-sqlite3";
import { logger } from "../observability/logger.js";

export function initDatabase(dbPath: string): Database.Database {
  logger.info("Initializing SQLite database", { dbPath });
  const db = new Database(dbPath);

  // Enable foreign keys and WAL mode for better concurrency and durability
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      capabilities TEXT NOT NULL, -- JSON array of strings
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_instances (
      instance_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_participants (
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (session_id, agent_id),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channels (
      session_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, channel_id),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      parent_message_id TEXT,
      from_agent_id TEXT NOT NULL,
      from_instance_id TEXT,
      type TEXT NOT NULL DEFAULT 'message',
      content TEXT NOT NULL,
      content_format TEXT NOT NULL DEFAULT 'markdown',
      correlation_id TEXT,
      idempotency_key TEXT UNIQUE,
      metadata TEXT, -- JSON
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY (from_agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE,
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_recipients (
      message_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      PRIMARY KEY (message_id, agent_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (message_id, agent_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assignee_id TEXT,
      creator_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      metadata TEXT, -- JSON
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    -- Indexes for fast querying
    CREATE INDEX IF NOT EXISTS idx_messages_session_channel ON messages(session_id, channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_recipients_agent ON message_recipients(agent_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_message_reads_agent ON message_reads(agent_id, message_id);
  `);

  logger.info("SQLite schema initialized successfully");
  return db;
}

