import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HubService } from "../domain/services/hub-service.js";
import type { HubConfig } from "../config/index.js";
import type { MessageType, TaskStatus } from "../domain/types.js";

export function createMcpServer(hub: HubService, config: HubConfig): McpServer {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion,
  });

  // -------------------------------------------------------------
  // Tool: register_agent
  // -------------------------------------------------------------
  server.tool(
    "register_agent",
    "Register a logical agent or client instance in the hub",
    {
      agent_id: z.string().describe("Unique identifier for the agent, e.g. 'gemini-antigravity' or 'claude-code'"),
      display_name: z.string().optional().describe("Human-readable name for the agent"),
      capabilities: z.array(z.string()).optional().describe("List of capabilities, e.g. ['coding', 'review', 'planning']"),
      client_instance_id: z.string().optional().describe("Optional client instance identifier"),
    },
    async (args) => {
      try {
        const result = hub.registerAgent({
          agentId: args.agent_id,
          displayName: args.display_name,
          capabilities: args.capabilities,
          clientInstanceId: args.client_instance_id,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to register agent: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: list_agents
  // -------------------------------------------------------------
  server.tool(
    "list_agents",
    "List all registered agents and their last-seen timestamps",
    {},
    async () => {
      try {
        const agents = hub.listAgents();
        return {
          content: [{ type: "text", text: JSON.stringify(agents, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list agents: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: create_session
  // -------------------------------------------------------------
  server.tool(
    "create_session",
    "Create a new communication session/workspace for agents",
    {
      session_id: z.string().describe("Unique session identifier, e.g. 'feature-auth-123'"),
      name: z.string().describe("Human-readable session name"),
      description: z.string().optional().describe("Optional session description"),
      participants: z.array(z.string()).describe("Agent IDs participating in this session"),
    },
    async (args) => {
      try {
        const session = hub.createSession({
          sessionId: args.session_id,
          name: args.name,
          description: args.description,
          participants: args.participants,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to create session: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: join_session
  // -------------------------------------------------------------
  server.tool(
    "join_session",
    "Join an existing session as a participant agent",
    {
      session_id: z.string().describe("Session identifier"),
      agent_id: z.string().describe("Agent ID to add to session"),
    },
    async (args) => {
      try {
        hub.joinSession(args.session_id, args.agent_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, sessionId: args.session_id, agentId: args.agent_id }),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to join session: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: list_sessions
  // -------------------------------------------------------------
  server.tool(
    "list_sessions",
    "List sessions, channels, and participants available locally",
    {
      agent_id: z.string().optional().describe("Filter sessions by participant agent ID"),
    },
    async (args) => {
      try {
        const sessions = hub.listSessions(args.agent_id);
        return {
          content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list sessions: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: create_channel
  // -------------------------------------------------------------
  server.tool(
    "create_channel",
    "Create a named communication channel inside a session",
    {
      session_id: z.string().describe("Session identifier"),
      channel_id: z.string().describe("Channel identifier, e.g. 'architecture-review'"),
      name: z.string().optional().describe("Human-readable channel name"),
      description: z.string().optional().describe("Channel description"),
    },
    async (args) => {
      try {
        const channel = hub.createChannel(
          args.session_id,
          args.channel_id,
          args.name,
          args.description
        );
        return {
          content: [{ type: "text", text: JSON.stringify(channel, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to create channel: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: list_channels
  // -------------------------------------------------------------
  server.tool(
    "list_channels",
    "List all channels within a given session",
    {
      session_id: z.string().describe("Session identifier"),
    },
    async (args) => {
      try {
        const channels = hub.listChannels(args.session_id);
        return {
          content: [{ type: "text", text: JSON.stringify(channels, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list channels: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: send_message
  // -------------------------------------------------------------
  server.tool(
    "send_message",
    "Send a message to another agent or broadcast to a channel within a session",
    {
      session_id: z.string().describe("Session identifier"),
      channel_id: z.string().describe("Channel identifier, e.g. 'general' or 'architecture-review'"),
      from_agent_id: z.string().describe("Sender agent ID"),
      to: z.union([z.string(), z.array(z.string())]).describe("Recipient agent ID, list of IDs, or '*' for channel broadcast"),
      thread_id: z.string().optional().describe("Optional thread ID for continuing an existing thread"),
      message_type: z
        .enum(["message", "question", "review_request", "review_result", "task_update", "handoff", "system"])
        .optional()
        .describe("Type of message (defaults to 'message')"),
      content: z.string().describe("Content of the message (Markdown supported)"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Optional structured metadata"),
      idempotency_key: z.string().optional().describe("Unique client-generated key to prevent duplicate sends"),
    },
    async (args) => {
      try {
        const result = hub.sendMessage({
          sessionId: args.session_id,
          channelId: args.channel_id,
          fromAgentId: args.from_agent_id,
          to: args.to,
          threadId: args.thread_id,
          messageType: args.message_type as MessageType | undefined,
          content: args.content,
          metadata: args.metadata,
          idempotencyKey: args.idempotency_key,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to send message: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: reply_to_message
  // -------------------------------------------------------------
  server.tool(
    "reply_to_message",
    "Reply to a specific message in its thread",
    {
      message_id: z.string().describe("ID of the message being replied to"),
      from_agent_id: z.string().describe("Sender agent ID"),
      content: z.string().describe("Content of the reply message"),
      message_type: z
        .enum(["message", "question", "review_request", "review_result", "task_update", "handoff", "system"])
        .optional()
        .describe("Type of message (defaults to 'message')"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Optional structured metadata"),
    },
    async (args) => {
      try {
        const result = hub.replyToMessage({
          messageId: args.message_id,
          fromAgentId: args.from_agent_id,
          content: args.content,
          messageType: args.message_type as MessageType | undefined,
          metadata: args.metadata,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to reply to message: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: read_inbox
  // -------------------------------------------------------------
  server.tool(
    "read_inbox",
    "Read incoming messages for a specific agent",
    {
      agent_id: z.string().describe("Agent ID whose inbox to check"),
      session_id: z.string().optional().describe("Optional session filter"),
      channel_id: z.string().optional().describe("Optional channel filter"),
      limit: z.number().optional().describe("Maximum messages to retrieve (1-100, default 20)"),
      cursor: z.string().optional().describe("Pagination cursor (ISO timestamp)"),
      unread_only: z.boolean().optional().describe("Return only unread messages if true"),
    },
    async (args) => {
      try {
        const inbox = hub.readInbox({
          agentId: args.agent_id,
          sessionId: args.session_id,
          channelId: args.channel_id,
          limit: args.limit,
          cursor: args.cursor,
          unreadOnly: args.unread_only,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(inbox, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read inbox: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: get_thread
  // -------------------------------------------------------------
  server.tool(
    "get_thread",
    "Retrieve all messages in a conversation thread in chronological order",
    {
      thread_id: z.string().describe("Thread identifier"),
    },
    async (args) => {
      try {
        const thread = hub.getThread(args.thread_id);
        return {
          content: [{ type: "text", text: JSON.stringify(thread, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get thread: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: mark_message_read
  // -------------------------------------------------------------
  server.tool(
    "mark_message_read",
    "Mark a message as read by an agent",
    {
      message_id: z.string().describe("Message identifier"),
      agent_id: z.string().describe("Agent identifier"),
    },
    async (args) => {
      try {
        const result = hub.markMessageRead(args.message_id, args.agent_id);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to mark message read: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: create_task
  // -------------------------------------------------------------
  server.tool(
    "create_task",
    "Create a coordinated task within a session",
    {
      session_id: z.string().describe("Session identifier"),
      title: z.string().describe("Task title"),
      description: z.string().optional().describe("Task description"),
      assignee_id: z.string().optional().describe("Assignee agent ID"),
      creator_id: z.string().describe("Creator agent ID"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Optional task metadata"),
    },
    async (args) => {
      try {
        const task = hub.createTask({
          sessionId: args.session_id,
          title: args.title,
          description: args.description,
          assigneeId: args.assignee_id,
          creatorId: args.creator_id,
          metadata: args.metadata,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to create task: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: update_task_status
  // -------------------------------------------------------------
  server.tool(
    "update_task_status",
    "Update the status of a coordinated task",
    {
      task_id: z.string().describe("Task identifier"),
      status: z
        .enum(["open", "accepted", "in_progress", "blocked", "completed", "cancelled"])
        .describe("New task status"),
    },
    async (args) => {
      try {
        const updated = hub.updateTaskStatus(args.task_id, args.status as TaskStatus);
        return {
          content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to update task status: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // Tool: get_task
  // -------------------------------------------------------------
  server.tool(
    "get_task",
    "Retrieve details of a coordinated task",
    {
      task_id: z.string().describe("Task identifier"),
    },
    async (args) => {
      try {
        const task = hub.getTask(args.task_id);
        return {
          content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get task: ${(err as Error).message}` }],
        };
      }
    }
  );

  // -------------------------------------------------------------
  // MCP Resources
  // -------------------------------------------------------------
  server.resource(
    "agents",
    "hub://agents",
    async () => {
      const agents = hub.listAgents();
      return {
        contents: [
          {
            uri: "hub://agents",
            mimeType: "application/json",
            text: JSON.stringify(agents, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    "sessions",
    "hub://sessions",
    async () => {
      const sessions = hub.listSessions();
      return {
        contents: [
          {
            uri: "hub://sessions",
            mimeType: "application/json",
            text: JSON.stringify(sessions, null, 2),
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------
  // MCP Prompts
  // -------------------------------------------------------------
  server.prompt(
    "agent-review",
    "Structured code or design review prompt for peer agents",
    {
      request_details: z.string().describe("Details of what needs to be reviewed"),
      scope: z.string().optional().describe("Scope or file references for the review"),
    },
    async ({ request_details, scope }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "You are requested to perform a structured peer review.",
                `Scope / Files: ${scope || "See request details"}`,
                `Details: ${request_details}`,
                "",
                "Please format your review response with:",
                "1. Summary of findings (High, Medium, Low severity)",
                "2. Concrete recommendations or code fixes",
                "3. Any questions or unresolved assumptions",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  return server;
}

