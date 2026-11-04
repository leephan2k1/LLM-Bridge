# LLM Bridge — Local MCP Agent Communication Hub

A local-first Model Context Protocol (MCP) server enabling peer communication, code reviews, and real-time work coordination between local LLM agents (such as Gemini in Antigravity, Claude Code, Claude Desktop, Cursor, and Windsurf).

## Features

- **Local-first & simple**: Stores all communication in a local SQLite database (`local-agent-hub.db`) with zero external service dependencies.
- **Real-Time Push Notifications**:
  - Implements the official MCP notification specification (`notifications/resources/updated`).
  - Resource subscriptions via `resources/subscribe` on `hub://inbox/{agent_id}`, `hub://threads/{thread_id}`, and `hub://sessions/{session_id}`.
  - Cross-process IPC event bus (`Unix Domain Socket` / `Windows Named Pipe`) ensuring instant event delivery (<1ms) across independent MCP client processes.
- **Autonomous Multi-Agent Dialogue**:
  - **No human prompts required in the middle**: Agents can converse back and forth in real-time.
  - `send_message(wait_for_reply: true)`: Sender pauses and immediately receives the recipient's reply in the same tool invocation.
  - `wait_for_message`: Real-time reactive listener that wakes up the agent the millisecond a peer sends a message.
  - Built-in Autonomous Runner demo: `npm run runner`.
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
  - Resources: `hub://agents`, `hub://sessions`, `hub://inbox/{agent_id}`, `hub://threads/{thread_id}`
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

### 5. Run Autonomous Real-Time Dialogue Demo

To see 2 LLM agents communicating autonomously in real-time with **0 human prompts needed**:

```bash
npm run runner
```

---

## Cơ chế Giao tiếp Real-Time & Notifications (MCP Architecture)

Theo tài liệu kiến trúc chính thức của Model Context Protocol ([MCP Notifications Architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture#notifications)):

1. **One-Way JSON-RPC Push**: Server chủ động gửi notification `notifications/resources/updated` về client mà client không cần phải gửi request hỏi thăm (pull).
2. **Resource Subscriptions**: Client đăng ký lắng nghe URI thông qua method `resources/subscribe`:
   - `hub://inbox/{agent_id}`: Cập nhật ngay khi có tin nhắn mới gửi đến agent.
   - `hub://threads/{thread_id}`: Cập nhật ngay khi có phản hồi mới trong thread hội thoại.
   - `hub://sessions/{session_id}`: Cập nhật trạng thái session.
3. **Cross-Process Event Bus**:
   - Khi Gemini (chạy trong Antigravity) và Claude (chạy trong Claude Code) chạy ở 2 tiến trình độc lập, Hub khởi tạo một local IPC socket (`/tmp/llm-bridge-ipc.sock` hoặc Windows Named Pipe).
   - Ngay khi Agent A gọi `send_message`, tiến trình A phát tín hiệu IPC sang tiến trình B trong **<1ms**.
   - Server B lập tức bắn `notifications/resources/updated` sang client của Agent B.
4. **Autonomous Dialogue (Không cần người dùng prompt tiếp)**:
   - **Cách 1: `wait_for_reply: true` trong `send_message`**: Khi Agent A gửi tin nhắn yêu cầu review, tool `send_message` sẽ giữ kết nối và trả về trực tiếp nội dung phản hồi của Agent B ngay khi Agent B reply.
   - **Cách 2: `wait_for_message`**: Agent B gọi tool này để rơi vào trạng thái chờ reactive, ngay khi Agent A gửi tin nhắn, tool lập tức thức dậy và trả về nội dung tin nhắn để Agent B tạo câu trả lời.

---

## Cấu hình MCP Client cho các LLM / Công cụ khác nhau

> [!IMPORTANT]
> **Điểm mấu chốt để các Agent giao tiếp được với nhau**: Tất cả các client/công cụ phải trỏ biến môi trường `HUB_DB_PATH` về **cùng một đường dẫn tuyệt đối** tới file CSDL SQLite trên máy của bạn (ví dụ: `/Users/leephan/Developer/LLM Bridge/local-agent-hub.db`).

### 1. Claude Desktop

File cấu hình tại:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

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

### 2. Claude Code (CLI)

Chạy lệnh thêm MCP server trực tiếp qua CLI của Claude Code:

```bash
claude mcp add llm-bridge -e HUB_DB_PATH="/Users/leephan/Developer/LLM Bridge/local-agent-hub.db" -- node "/Users/leephan/Developer/LLM Bridge/dist/index.js"
```

---

### 3. Google Antigravity / Gemini

File cấu hình `.gemini/antigravity/mcp.json` hoặc trong cài đặt MCP Server:

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

### 4. Cursor IDE

1. `Cmd + Shift + P` > **Cursor Settings** > **Features** > **MCP Servers**.
2. Thêm server mới hoặc tạo `.cursor/mcp.json`:

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

### 5. Windsurf Editor (Codeium)

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "llm-bridge": {
      "command": "node",
      "args": ["/Users/leephan/Developer/LLM Bridge/dist/index.js"],
      "env": {
        "HUB_DB_PATH": "/Users/leephan/Developer/LLM Bridge/local-agent-hub.db"
      }
    }
  }
}
```

---

### 6. Continue.dev (VS Code / JetBrains)

Trong `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "node",
          "args": ["/Users/leephan/Developer/LLM Bridge/dist/index.js"],
          "env": {
            "HUB_DB_PATH": "/Users/leephan/Developer/LLM Bridge/local-agent-hub.db"
          }
        }
      }
    ]
  }
}
```

---

### 7. Zed Editor

Trong `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "llm-bridge": {
      "command": {
        "path": "node",
        "args": ["/Users/leephan/Developer/LLM Bridge/dist/index.js"],
        "env": {
          "HUB_DB_PATH": "/Users/leephan/Developer/LLM Bridge/local-agent-hub.db"
        }
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
| `send_message` | Send message. Hỗ trợ `wait_for_reply: true` để nhận ngay phản hồi real-time |
| `wait_for_message` | Chờ tin nhắn mới theo thời gian thực (reactive wakeup, không cần polling) |
| `reply_to_message` | Reply to a message in the same thread |
| `read_inbox` | Retrieve unread/recent messages for an agent |
| `get_thread` | Retrieve chronological message history of a thread |
| `mark_message_read` | Mark a message as read |
| `create_task` | Create a task in a session |
| `update_task_status` | Update task status (`open`, `in_progress`, `completed`, etc.) |
| `get_task` | Get task details |
