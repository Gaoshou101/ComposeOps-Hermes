# ComposeOps Architecture

This document describes the architecture, data flow, and key design decisions of ComposeOps.

## Table of Contents

- [System Overview](#system-overview)
- [Architecture Diagram](#architecture-diagram)
- [Component Breakdown](#component-breakdown)
- [Data Flow](#data-flow)
- [Security Model](#security-model)
- [AI Agent Architecture](#ai-agent-architecture)
- [Design Decisions](#design-decisions)

## System Overview

ComposeOps is a single-page application (SPA) that provides a web-based management interface for Docker Compose projects. It consists of:

- **Frontend**: Vue 3 SPA with real-time updates
- **Backend**: Node.js 22 + Fastify REST API and WebSocket server
- **Storage**: SQLite database for configuration and history
- **Container Runtime**: Docker Engine accessed via socket and Dockerode

```
┌─────────────────────────────────────────────────────────────────┐
│                          User Browser                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Vue 3 Frontend (SPA)                                     │  │
│  │  - Router: vue-router                                     │  │
│  │  - State: Pinia stores                                    │  │
│  │  - UI: Tailwind CSS + Lucide icons                       │  │
│  │  - Terminal: Xterm.js                                     │  │
│  │  - Editor: Monaco Editor                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│         │                      │                     │           │
│      HTTP/REST              WebSocket              SSE           │
└─────────┼──────────────────────┼─────────────────────┼───────────┘
          │                      │                     │
┌─────────▼──────────────────────▼─────────────────────▼───────────┐
│                    ComposeOps Backend (Node.js)                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Fastify HTTP Server (Port 3001)                          │  │
│  │  - Static file serving (production mode)                  │  │
│  │  - REST API routes (/api/*)                               │  │
│  │  - WebSocket server (/ws)                                 │  │
│  │  - SSE endpoints (operations streaming)                   │  │
│  │  - Session management (cookie-based)                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│         │                      │                     │           │
│         ▼                      ▼                     ▼           │
│  ┌──────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │ SQLite   │  │   Dockerode Client   │  │   AI Services    │  │
│  │ Database │  │  (Docker Engine API) │  │ (Claude/OpenAI)  │  │
│  └──────────┘  └──────────────────────┘  └──────────────────┘  │
│      │                   │                         │            │
└──────┼───────────────────┼─────────────────────────┼────────────┘
       │                   │                         │
       ▼                   ▼                         ▼
┌────────────┐    ┌─────────────────┐      ┌──────────────┐
│  opsdash   │    │  Docker Socket  │      │  Internet    │
│   .db      │    │ /var/run/       │      │ (AI APIs +   │
│  (Volume)  │    │  docker.sock    │      │  Web Search) │
└────────────┘    └─────────────────┘      └──────────────┘
                          │
                          ▼
         ┌────────────────────────────────────┐
         │     Docker Compose Projects         │
         │  ┌──────────┐    ┌──────────┐      │
         │  │ Project A│    │ Project B│      │
         │  │ (3 svcs) │    │ (5 svcs) │      │
         │  └──────────┘    └──────────┘      │
         └────────────────────────────────────┘
```

## Component Breakdown

### Frontend (Vue 3 SPA)

**Technology Stack:**
- Vue 3.5 with Composition API and `<script setup>`
- Vue Router 4 for client-side routing
- Pinia for state management
- Tailwind CSS for styling
- Monaco Editor for YAML editing
- Xterm.js for terminal emulation
- Lucide Vue for icons

**Key Pages:**
- `/` - Service overview with health cards
- `/services/:project` - Service details and container management
- `/logs/:project/:service` - Real-time log viewer
- `/compose/:project` - Multi-file YAML editor with validation
- `/operations` - Operations history and audit trail
- `/ai` - AI diagnosis assistant
- `/agent` - AI Agent workflow automation
- `/monitor` - System metrics and trends
- `/events` - Alert center with prioritization
- `/settings` - Configuration and project management

**State Management:**
- SWR pattern with 12s TTL for API caching
- localStorage for UI preferences (filters, trends)
- Pinia stores for global state (auth, notifications)

### Backend (Node.js + Fastify)

**Core Modules:**

1. **Authentication** (`src/auth.js`)
   - Scrypt password hashing
   - Session-based auth with 30-day expiry
   - HttpOnly, SameSite=Strict cookies

2. **Docker Integration** (`src/docker.js`)
   - Dockerode client wrapper
   - Project discovery via container labels
   - Container lifecycle operations
   - Stats streaming (CPU, memory, network)

3. **Compose Operations** (`src/compose.js`)
   - Workspace container management (on-demand directory mounting)
   - Allowlisted operations: up, stop, restart, pull, ps
   - Real-time output streaming via SSE
   - Change impact preview (containers to recreate/restart)

4. **AI Services** (`src/ai/`)
   - `ai-service.js` - Claude/OpenAI integration
   - `agent.js` - 28-tool Agent orchestration
   - `ai-sessions.js` - Conversation history management
   - `ai-prompt-guard.js` - Safety checks

5. **Database** (`src/db.js`)
   - SQLite with better-sqlite3
   - Schema migrations
   - Tables: users, api_keys, ai_sessions, ai_messages, compose_backups, alert_events, operations_history

6. **WebSocket Server** (`src/websocket.js`)
   - Real-time event push (alerts, status changes)
   - Authenticated connections only

### Database Schema

**Core Tables:**

```sql
-- User authentication
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- AI API keys (encrypted)
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,  -- 'openai' or 'anthropic'
  api_key TEXT NOT NULL,
  base_url TEXT,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- AI conversation sessions
CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- 'diagnosis' or 'agent'
  project_name TEXT,
  service_name TEXT,
  title TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'user' or 'assistant'
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);

-- Compose file backups (last 20 per file)
CREATE TABLE compose_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Alert events
CREATE TABLE alert_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- 'container_exit', 'memory_alert', etc.
  priority TEXT NOT NULL,  -- 'low', 'medium', 'high', 'critical'
  title TEXT NOT NULL,
  message TEXT,
  source TEXT,  -- container ID or 'system'
  metadata TEXT,  -- JSON
  is_read INTEGER DEFAULT 0,
  is_muted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Operations audit log
CREATE TABLE operations_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  operation TEXT NOT NULL,  -- 'up', 'stop', 'restart', 'pull'
  status TEXT NOT NULL,  -- 'success', 'failed'
  output TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## Data Flow

### 1. Project Discovery Flow

```
Docker Engine
    │
    ├─ Container Labels
    │   - com.docker.compose.project
    │   - com.docker.compose.project.working_dir
    │   - myops.owner (optional)
    │
    ▼
Backend Dockerode
    │
    ├─ Group by project
    ├─ Extract metadata
    │
    ▼
SQLite (project_approvals table)
    │
    ├─ Check if project is managed
    ├─ Check if Compose access granted
    │
    ▼
REST API Response
    │
    ▼
Frontend (ServicesView)
```

### 2. Real-time Logs Flow

```
User clicks "View Logs"
    │
    ▼
Frontend opens /logs/:project/:service
    │
    ├─ Establish WebSocket connection
    │
    ▼
Backend validates:
    ├─ Is project managed?
    ├─ Does container exist?
    │
    ▼
Dockerode.getContainer(id).logs({
  follow: true,
  stdout: true,
  stderr: true,
  tail: 200
})
    │
    ├─ Stream stdout/stderr
    │
    ▼
WebSocket.send(chunk)
    │
    ▼
Frontend Xterm.js
    ├─ Parse ANSI codes
    ├─ Highlight ERROR/WARN
    ├─ Apply search filter
```

### 3. Compose Operation Flow (with Workspace Container)

```
User clicks "Start Service"
    │
    ▼
Frontend POST /api/compose/up
    │
    ├─ Body: { projectName, services }
    │
    ▼
Backend validates:
    ├─ Project managed + Compose access?
    ├─ Working dir in allowlist?
    │
    ▼
Workspace Manager
    │
    ├─ Check if workspace exists for project
    │   - Yes: reuse (if idle < 90s)
    │   - No: create new workspace container
    │
    ├─ docker run -d --rm \
    │     -v /var/run/docker.sock:/var/run/docker.sock \
    │     -v /project/path:/project/path \
    │     --workdir /project/path \
    │     stanly1997/opsdash:latest sleep 3600
    │
    ▼
Execute in workspace:
    docker exec <workspace> docker compose up -d <services>
    │
    ├─ Stream output via SSE
    │
    ▼
Frontend displays real-time output
    │
    ▼
Workspace idle timer (90s default)
    │
    ├─ No activity → docker rm -f <workspace>
```

### 4. AI Agent Workflow Flow

```
User: "Restart database with health check"
    │
    ▼
Frontend POST /api/ai/agent/execute
    │
    ▼
Backend AI Agent
    │
    ├─ Parse intent with LLM
    ├─ Generate execution plan
    │
    ▼
Plan Review
    │
    ├─ Risk classification (low/medium/high/critical)
    ├─ Tool confirmation required?
    │
    ▼
Frontend BatchConfirmModal
    │
    ├─ Show all steps
    ├─ User confirms each high-risk action
    │
    ▼
Backend executes tools sequentially
    │
    ├─ Tool: container_stop(db)
    ├─ Tool: edit_compose(healthcheck)
    ├─ Tool: container_start(db)
    │
    ▼
Store execution history
    │
    ▼
Frontend shows results + feedback form
```

## Security Model

### Defense in Depth

1. **Authentication Layer**
   - Mandatory login (scrypt-hashed password)
   - Session cookies: HttpOnly, SameSite=Strict, 30-day expiry
   - Origin validation for modification requests

2. **Authorization Layer**
   - Explicit project management approval required
   - Two-tier access: "Manage" (view/control) + "Compose" (edit/operations)
   - Operations limited to allowlisted commands

3. **File Access Layer**
   - Realpath validation (prevent path traversal)
   - Working directory must match Docker-reported label
   - File manifest cross-check with Docker API

4. **Workspace Isolation**
   - Per-project workspace containers
   - Only selected project directory mounted
   - Auto-cleanup on idle/deselect

5. **API Key Protection**
   - Stored encrypted in SQLite
   - Never included in settings export
   - Transmitted only over authenticated connections

### Threat Model

**Assumed Trust:**
- Single trusted administrator
- Localhost or VPN deployment
- Docker socket equivalent to root

**Protected Against:**
- Path traversal attacks
- Arbitrary command execution
- Unauthorized project access
- Session hijacking (HTTPS + SameSite)
- CSRF (Origin validation)

**Out of Scope:**
- Multi-tenant isolation (single-user design)
- Defense against compromised Docker daemon
- Protection against malicious container images

## AI Agent Architecture

### Tool Categories (28 Tools)

1. **Lifecycle** (6 tools)
   - container_start, container_stop, container_restart
   - service_scale, container_pause, container_unpause

2. **Configuration** (5 tools)
   - edit_compose, validate_compose
   - edit_env, add_label, remove_label

3. **Networking** (3 tools)
   - create_network, remove_network, inspect_network

4. **Volumes** (3 tools)
   - create_volume, remove_volume, inspect_volume

5. **Diagnostics** (4 tools)
   - container_logs, container_inspect
   - container_stats, health_check

6. **Security** (2 tools)
   - scan_vulnerabilities, audit_permissions

7. **Maintenance** (3 tools)
   - prune_images, prune_containers, prune_volumes

8. **Alerts** (2 tools)
   - set_alert_threshold, evaluate_alert

### Risk Classification

| Risk Level | Examples | Confirmation |
|-----------|----------|-------------|
| **Low** | container_inspect, container_logs | Auto-execute |
| **Medium** | container_start, service_scale | Single confirm |
| **High** | container_stop, edit_compose | Per-step confirm |
| **Critical** | prune_volumes, remove_network | Explicit confirm + warning |

### Agent Execution Flow

```
┌──────────────────────────────────────────────────────────┐
│ 1. User Intent                                           │
│    "Scale web service to 3 replicas and add healthcheck" │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 2. LLM Planning (Claude/GPT-4)                           │
│    - Decompose into tool calls                           │
│    - Determine execution order                           │
│    - Classify risk levels                                │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 3. Plan Review                                           │
│    [                                                     │
│      { tool: 'service_scale', risk: 'medium' },         │
│      { tool: 'edit_compose', risk: 'high' }             │
│    ]                                                     │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 4. User Confirmation (Frontend Modal)                    │
│    ☑ Scale web to 3 replicas                            │
│    ☑ Edit compose: add healthcheck                      │
│    [Confirm] [Cancel]                                    │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 5. Sequential Execution                                  │
│    ├─ service_scale(web, 3) ✓                           │
│    ├─ edit_compose(healthcheck) ✓                       │
│    └─ Store in operations_history                       │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ 6. Feedback Collection                                   │
│    - Success/failure status                              │
│    - User rating (optional)                              │
│    - Export capability                                   │
└──────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why SQLite?

**Pros:**
- Zero-config, embedded database
- ACID transactions
- File-based (easy backup/restore)
- Sufficient for single-user workload
- Better-sqlite3 performance

**Cons:**
- No concurrent write scaling (not needed for single user)
- File locks (mitigated by WAL mode)

**Decision:** SQLite fits the single-user, self-hosted use case perfectly. No need for PostgreSQL/MySQL overhead.

---

### Why Workspace Containers?

**Problem:** How to execute `docker compose` commands on arbitrary host directories without permanently mounting them into ComposeOps?

**Alternatives Considered:**

1. **Mount all project dirs permanently**
   - ❌ Security: exposes all projects
   - ❌ Requires restart on new projects

2. **Use host docker CLI via docker exec**
   - ❌ Doesn't work in container without host path mapping

3. **Workspace containers (chosen)**
   - ✅ On-demand directory mounting
   - ✅ Project-scoped isolation
   - ✅ Auto-cleanup on idle
   - ✅ No ComposeOps restart needed

**Implementation:**
```bash
# Create workspace for project /opt/myapp
docker run -d --rm --name opsdash-ws-myapp \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/myapp:/opt/myapp \
  --workdir /opt/myapp \
  stanly1997/opsdash:latest sleep 3600

# Execute compose command
docker exec opsdash-ws-myapp docker compose up -d

# Auto-cleanup after 90s idle
```

---

### Why SSE instead of WebSocket for operations?

**SSE (Server-Sent Events) for Compose operations:**
- ✅ Unidirectional (server → client)
- ✅ Auto-reconnect
- ✅ Works through HTTP proxies
- ✅ EventSource API built-in

**WebSocket for events and logs:**
- ✅ Bidirectional (needed for log pausing)
- ✅ Lower latency
- ✅ Binary frames (future)

**Decision:** Use the right tool for each job. SSE for streaming output, WebSocket for interactive features.

---

### Why Monaco Editor instead of CodeMirror?

**Monaco (VS Code's editor):**
- ✅ Full IntelliSense and autocomplete
- ✅ YAML language support out-of-box
- ✅ Minimap and diff view
- ✅ Used by VS Code (proven reliability)
- ❌ 596KB gzipped (mitigated by code splitting)

**CodeMirror 6:**
- ✅ Smaller bundle (150KB)
- ❌ YAML support requires plugins
- ❌ Less feature-complete

**Decision:** Monaco's features justify the bundle size for a dev tool. Users who edit Compose files expect VS Code-level editing experience.

---

### Why Not TypeScript?

**Current state:** Plain JavaScript with JSDoc comments

**Reasons:**
- ✅ Faster iteration during prototyping
- ✅ No build step for backend (Node.js 22 ESM)
- ✅ JSDoc provides type hints in VS Code
- ❌ No compile-time type checking

**Future:** TypeScript migration planned for v1.2 (backend first, then frontend).

---

## Performance Characteristics

### Metrics

- **Frontend bundle**: 3.5MB gzipped (Monaco Editor: 596KB, Vue vendor: 52KB)
- **First load**: ~1.2s (localhost, cold cache)
- **API latency**: <50ms (local Docker socket)
- **WebSocket latency**: <10ms (localhost)
- **Memory footprint**: ~80MB (backend), ~150MB (frontend in browser)

### Bottlenecks

1. **Docker API calls** - Mitigated by SWR caching (12s TTL)
2. **Monaco Editor lazy loading** - Route-level code splitting
3. **Log streaming** - Client-side buffering (max 5000 lines)

### Scalability

**Current limitations:**
- Single-user design (no multi-tenancy)
- SQLite write concurrency (not an issue for single user)
- Docker socket limited to one host

**Scaling options for future:**
- Docker Swarm/Kubernetes support (v2.0 roadmap)
- PostgreSQL for multi-user (if ever needed)
- Redis for distributed WebSocket (multi-instance)

---

## Deployment Considerations

### Recommended Setup

```
Internet
    │
    ├─ Tailscale (WireGuard VPN)
    │
    ▼
┌──────────────────┐
│  User Device     │
│  (Anywhere)      │
└──────────────────┘
    │
    │  Tailscale
    │  Mesh Network
    │
    ▼
┌──────────────────┐
│  Home Server     │
│  127.0.0.1:3001  │
│  ┌────────────┐  │
│  │ ComposeOps │  │
│  └────────────┘  │
└──────────────────┘
```

### Alternative: Reverse Proxy

```
Internet
    │
    ├─ HTTPS (443)
    │
    ▼
┌──────────────────┐
│  Nginx/Caddy     │
│  (Reverse Proxy) │
│  + TLS           │
│  + Auth (OAuth)  │
└──────────────────┘
    │
    │  HTTP
    │
    ▼
┌──────────────────┐
│  ComposeOps      │
│  127.0.0.1:3001  │
│  TRUST_PROXY=1   │
└──────────────────┘
```

---

## Related Documents

- [CONTRIBUTING.md](../../CONTRIBUTING.md) - Development setup
- [SECURITY.md](../../SECURITY.md) - Security policy
- [README.en.md](../../README.en.md) - User guide
