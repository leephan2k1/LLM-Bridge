# LLM Bridge — Local MCP Agent Communication Hub

A local-first Model Context Protocol (MCP) server enabling peer communication, code reviews, and work coordination between local LLM agents (such as Gemini in Antigravity and Claude Code / Claude desktop).

## Features

- **Local-first & simple**: Stores all communication in a local SQLite database (`local-agent-hub.db`) with zero external service dependencies.
- **Agent Identity**: Agents register their identity and capabilities (`register_agent`, `list_agents`).
- **Sessions & Channels**: Organize discussions by feature or task (`create_session`, `create_channel`, `list_sessions`, `list_channels`).
- **Asynchronous Messaging**:
  - `send_message`: Send direct messages or broadcast to a channel. Supports idempotency keys to prevent duplicates.
  - `read_inbox`: Pull unread or recent messages for an agent.
  - `reply_to_message`: Threaded replies linked to the original message.
  - `get_thread`: Retrieve entire conversation threads in chronological order.
  - `mark_message_read`: Mark incoming items as read.
- **Task Management**: Optional coordination tracking (`create_task`, `update_task_status`, `get_task`).
- **Stdio Transport Safe**: Structured JSON logging routed exclusively to `stderr` so stdio JSON-RPC remains clean.
- **MCP Resources & Prompts**:
  - Resources: `hub://agents`, `hub://sessions`
  - Prompt: `agent-review`

---

## Getting Started

### 1. Prerequisites
- Node.js >= 20 (tested with Node 24)
- npm

### 2. Installation & Build

```bash
npm install
npm run build
```

### 3. Run Tests

```bash
npm test
```

### 4. Running the Server

Start using tsx directly:
```bash
npm run dev
```

Or build and run the compiled binary:
```bash
npm run build
npm start
```

---

## MCP Client Configuration

### Connecting from Antigravity / Claude Code / Claude Desktop / Cursor

Add to your MCP configuration (e.g., `claude_desktop_config.json` or Antigravity MCP settings):

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "node",
      "args": ["/Users/leephan/Developer/LLM Bridge/dist/index.js"],
      "env": {
        "HUB_DB_PATH": "/Users/leephan/Developer/LLM Bridge/local-agent-hub.db",
        "HUB_LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## Available MCP Tools

| Tool | Description |
|---|---|
| `register_agent` | Register an agent identifier (e.g. `gemini-antigravity`, `claude-code`) |
| `list_agents` | List registered agents and last-seen timestamps |
| `create_session` | Create a new work context with defined participants |
| `list_sessions` | List available sessions and channels |
| `join_session` | Join an existing session |
| `create_channel` | Create a channel inside a session |
| `list_channels` | List channels of a session |
| `send_message` | Send a message to an agent or broadcast to a channel |
| `reply_to_message` | Reply to a message in the same thread |
| `read_inbox` | Retrieve unread/recent messages for an agent |
| `get_thread` | Retrieve chronological message history of a thread |
| `mark_message_read` | Mark a message as read |
| `create_task` | Create a task in a session |
| `update_task_status` | Update task status (`open`, `in_progress`, `completed`, etc.) |
| `get_task` | Get task details |
