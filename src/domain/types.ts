export type MessageType =
  | "message"
  | "question"
  | "review_request"
  | "review_result"
  | "task_update"
  | "handoff"
  | "system";

export type ContentFormat = "text" | "markdown" | "json";

export interface Agent {
  agentId: string;
  displayName: string;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
  lastSeen?: string;
}

export interface Session {
  sessionId: string;
  name: string;
  description?: string;
  createdAt: string;
  participants: string[];
  channels?: Channel[];
}

export interface Channel {
  sessionId: string;
  channelId: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  channelId: string;
  threadId: string;
  parentMessageId?: string;
  fromAgentId: string;
  fromInstanceId?: string;
  toAgentIds: string[];
  type: MessageType;
  content: string;
  contentFormat: ContentFormat;
  createdAt: string;
  correlationId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface InboxMessage extends Message {
  isRead: boolean;
  readAt?: string;
}

export type TaskStatus =
  | "open"
  | "accepted"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled";

export interface Task {
  id: string;
  sessionId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  creatorId: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
