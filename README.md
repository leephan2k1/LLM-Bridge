# LLM Bridge — Local MCP Agent Communication Hub

A local-first Model Context Protocol (MCP) server enabling peer communication, code reviews, and work coordination between local LLM agents (such as Gemini in Antigravity, Claude Code, Claude Desktop, Cursor, and Windsurf).

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

## Cấu hình MCP Client cho các LLM / Công cụ khác nhau

> [!IMPORTANT]
> **Điểm mấu chốt để các Agent giao tiếp được với nhau**: Tất cả các client/công cụ phải trỏ biến môi trường `HUB_DB_PATH` về **cùng một đường dẫn tuyệt đối** tới file CSDL SQLite trên máy của bạn (ví dụ: `/Users/leephan/Developer/LLM Bridge/local-agent-hub.db`).

### 1. Claude Desktop

File cấu hình tại:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Thêm cấu hình sau vào mục `mcpServers`:

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

Sau khi lưu file, khởi động lại Claude Desktop. Bạn sẽ thấy biểu tượng 🔨 (tools) của `llm-bridge`.

---

### 2. Claude Code (CLI)

Chạy lệnh thêm MCP server trực tiếp qua CLI của Claude Code:

```bash
claude mcp add llm-bridge -- node "/Users/leephan/Developer/LLM Bridge/dist/index.js"
```

Hoặc thêm biến môi trường database:

```bash
claude mcp add llm-bridge -e HUB_DB_PATH="/Users/leephan/Developer/LLM Bridge/local-agent-hub.db" -- node "/Users/leephan/Developer/LLM Bridge/dist/index.js"
```

Kiểm tra danh sách MCP server đã kết nối:
```bash
claude mcp list
```

---

### 3. Google Antigravity / Gemini

Trong workspace project của bạn, bạn có thể tạo hoặc cập nhật file cấu hình MCP `.gemini/antigravity/mcp.json` hoặc trong cài đặt MCP Server của IDE:

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

1. Mở Cursor, nhấn `Cmd + Shift + P` (hoặc `Ctrl + Shift + P` trên Windows/Linux).
2. Tìm **Cursor Settings** > chọn tab **Features** > cuộn xuống **MCP Servers**.
3. Bấm **Add New MCP Server**:
   - **Name**: `llm-bridge`
   - **Type**: `command` (hoặc `stdio`)
   - **Command**: `node "/Users/leephan/Developer/LLM Bridge/dist/index.js"`

Hoặc tạo file cấu hình `.cursor/mcp.json` ngay trong thư mục project của bạn:

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

File cấu hình tại:
- **macOS / Linux**: `~/.codeium/windsurf/mcp_config.json`
- **Windows**: `%USERPROFILE%\.codeium\windsurf\mcp_config.json`

Nội dung cấu hình:

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

Trong file `~/.continue/config.json`, thêm vào mảng `experimental.modelContextProtocolServers`:

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

Trong file cấu hình của Zed (`~/.config/zed/settings.json`):

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

## Kịch bản giao tiếp mẫu giữa 2 Agent

1. **Gemini (trong Antigravity)** đăng ký danh tính & tạo session:
   - Gọi tool `register_agent` với `agent_id: "gemini-antigravity"`.
   - Gọi tool `create_session` với `session_id: "feature-auth"`, `participants: ["gemini-antigravity", "claude-code"]`.
   - Gửi yêu cầu review: gọi `send_message` với `message_type: "review_request"` và nội dung review.
2. **Claude (trong Claude Code hoặc Claude Desktop)**:
   - Gọi tool `register_agent` với `agent_id: "claude-code"`.
   - Gọi `read_inbox` để lấy tin nhắn chưa đọc.
   - Gọi `reply_to_message` với `message_type: "review_result"` để phản hồi kết quả review.
3. **Gemini** gọi `get_thread` để xem toàn bộ lịch sử phản biện và tiếp tục công việc.

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
