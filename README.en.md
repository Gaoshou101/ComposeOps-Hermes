<div align="center">

# ComposeOps

**Lightweight Docker Compose Operations Dashboard for Personal Servers**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED.svg?logo=docker)](https://docs.docker.com/compose/)
[![CI](https://github.com/StanlySGY/ComposeOps/actions/workflows/ci.yml/badge.svg)](https://github.com/StanlySGY/ComposeOps/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/StanlySGY/ComposeOps?include_prereleases)](https://github.com/StanlySGY/ComposeOps/releases)

Auto-discover Compose projects, manage services, edit configs, stream logs, diagnose with AI, and monitor resources — all in a single web interface

[Features](#-features) • [Quick Start](#-quick-start) • [Security Model](#-security-model) • [Contributing](CONTRIBUTING.md) • [中文文档](README.md)

<img src="docs/screenshots/dashboard.png" alt="ComposeOps dashboard — AI ops decision center" width="900">
</div>

> **What it is**: a single-user ops dashboard for your own server. Docker socket access equals root; UI is currently Chinese-only (English UI is planned).
> **What it is not**: no multi-tenant or team support (use Portainer for that); not a PaaS — it does not take over your build/release pipeline (see Coolify or Komodo).
> **Where it stands**: among compose-panel tools, ComposeOps' differentiator is the **AI Ops Agent** — it doesn't just show state, it can investigate and act on your approval.

---

## ✨ Features

### 🚀 Core Workflow (day-to-day operations)

<table>
<tr>
<td width="50%">

**🎯 Project Management**
- 🔍 Auto-discover Compose projects (via container labels)
- 📁 Group by `myops.owner`, support favorites and notes
- 🎯 Explicit management: read-only by default, manual authorization for control
- 🔐 Two-tier permissions: Managed (container control) + Compose (config editing)

</td>
<td width="50%">

**✏️ Configuration Editing**
- ✏️ Multi-file YAML editor (Monaco Editor)
- ✅ Real-time syntax validation (depends_on / port conflicts / missing images)
- 💾 Auto-backup last 20 versions, diff and restore support
- 🔍 Preview containers to be recreated/restarted before saving

</td>
</tr>
<tr>
<td width="50%">

**📊 Real-time Monitoring**
- 📈 System metrics: CPU, memory, disk, network
- 🐳 Docker metrics: image/container/volume count, storage usage
- 💰 Cost estimate: vCPU + RAM allocation cost simulation
- ⚡ Health scores: service availability scoring

</td>
<td width="50%">

**📜 Logs & Terminal**
- 🔄 Live log streaming (SSE), auto-scroll, level filtering
- 🔍 Full-text search, highlight ERROR/WARN, export to file
- 💻 Web shell (xterm.js), restricted to managed containers
- 📦 Batch operations: multi-project parallel execution

</td>
</tr>
</table>

### 🤖 AI Ops Agent

Single chat entry (the standalone AI diagnosis page has been merged in), powered by a native tool-loop engine:

- 🛠️ **47 tools**: project discovery / lifecycle / scaling / config read-write & rollback / networks & volumes / security audit / diagnostic probes / maintenance / cron / long-term memory
- ⚠️ **Risk levels + step-by-step confirmation**: high-risk actions require explicit approval, fully audited
- 📎 **Log mounting**: pick container log lines as evidence attached to your message (untrusted-fence guarded)
- 🌐 **Web search**: optional toggle with cited sources
- 🧠 **Long-term memory**: remembers your ops preferences on request
- 🖼️ **Rich rendering**: markdown tables / embedded HTML / SVG diagrams, with in-page zoom
- 💬 **Tool traces**: request/execute/result status and duration for every tool call
- 📄 Global page-agent drawer with automatic page context; streaming output, session history, quick prompts

### 🔔 Alerts & Notifications

- **Multi-channel push**: Bark, Telegram, WeChat Work, SMTP, Generic Webhook
- **Trigger types**: Container exit, memory threshold, disk space, custom rules
- **Smart management**: Priority levels, read/mute status, WebSocket real-time push
- **Event persistence**: Alert history with full-text search

### 🛠️ Operations Tools

- **Resource management**: Images (prune unused), volumes (cleanup), networks (list/remove)
- **Batch operations**: Multi-project parallel execution with SSE streaming progress
- **Health checks**: Service availability monitoring with scoring
- **Backup & restore**: Config versioning with diff comparison
- **Volume backup**: tar.gz snapshots of named volumes via helper containers, with restore/download and cron scheduling
- **GitOps**: keep compose files in sync from a Git repo (polling + webhook trigger), with rollback history
- **Marketplace**: built-in blueprints + custom templates + AI-assisted app discovery
- **Scheduled jobs**: DB dumps, safe/deep Docker cleanup, image update checks, scheduled pulls, volume backups

### 🧩 Advanced Modules (optional, safe to ignore)

These modules target power users who want to codify their ops experience. The core workflow above works without them:

- 🛡️ **AI Inspection**: scheduled health checks across managed projects with diagnostic reports
- 📝 **Change Review / Auto-Rollback**: review Compose changes before they take effect; automatic rollback on anomalies
- 🗃️ **Asset Center (CMDB)**: unified host/project/container/volume/network asset model with dependency relations
- 🕸️ **Knowledge Graph / Topology**: realtime or CMDB-backed visualization of project dependencies
- 🔁 **Workflow Engine**: trigger / condition / agent / approval / action / verify node orchestration; the Agent can act as a workflow node
- 🎯 **Event Center**: alerts, inspections, deployments, rollbacks, Agent and GitOps unified into one event stream
- 💰 **Cost Analysis**: resource-based estimation (informative for personal servers)

---

## 🚀 Quick Start

### Prerequisites

- Docker 20.10+ & Docker Compose v2
- Linux/macOS/Windows (WSL2)
- 1GB RAM minimum

### Installation

**Option A: Pull the image (recommended)**

```bash
mkdir composeops && cd composeops
curl -fsSL https://raw.githubusercontent.com/StanlySGY/ComposeOps/main/docker-compose.yml -o docker-compose.yml
docker compose pull && docker compose up -d
```

> Images are published on Docker Hub as `composeops/opsdash` (tags: `latest`, major, full version). Behind a proxy or prefer building yourself? Use Option B — the Dockerfile ships with mirror defaults so `docker compose up -d --build` works out of the box.

**Option B: Build from source**

```bash
git clone https://github.com/StanlySGY/ComposeOps.git
cd ComposeOps
docker compose up -d --build
```

Open **http://<host-ip>:28765** in your browser (default mapping `0.0.0.0:28765 -> 3001`; change to `127.0.0.1:28765:3001` for localhost-only). First-time setup will prompt for an admin password (min 10 characters).

### Remote Access

ComposeOps manages Docker Engine via `/var/run/docker.sock` — **exposing port 3001 to the internet = granting root access to your server**. Use one of these secure access methods:

**Option 1: Tailscale** (Recommended - Zero-config VPN)
```bash
tailscale serve --bg http://127.0.0.1:28765
# Access via https://your-machine.your-tailnet.ts.net
```

**Option 2: Reverse Proxy** (Caddy/Nginx with HTTPS + authentication)
```yaml
# docker-compose.yml - add to environment:
TRUST_PROXY=1
```

⚠️ **Security Warning**: Never expose port 3001 directly to the public internet without authentication and HTTPS.

---

## 🔒 Security Model

### 🔐 Authentication & Authorization

- ✅ Scrypt password hashing (Node.js native crypto)
- ✅ Session-based authentication (30-day HttpOnly, SameSite=Strict cookies)
- ✅ API key management for programmatic access
- ✅ CSRF protection via Origin header validation

### 📂 File & Operation Isolation

- ✅ Workspace containers: on-demand mounting of project directories
- ✅ Auto-cleanup after operations (30s timeout)
- ✅ Read-only discovery mode by default
- ✅ Explicit management authorization required for write operations

### 🔑 API Key Protection

- ✅ AI provider keys stored in local SQLite (file permission 0600), never in browser
- ✅ Server-side proxy for all AI API calls; masked in UI responses
- ⚠️ The database file itself is not encrypted — keep host access under control

### ⚠️ Threat Model

**What we assume you trust:**
- Your Docker host and its file system
- Network between browser and ComposeOps (use Tailscale/HTTPS)
- The admin account holder

**What we protect against:**
- ✅ Accidental destructive operations (confirmation dialogs)
- ✅ Container escape via shell (restricted to managed containers)
- ✅ Unauthorized project access (explicit management required)
- ✅ Session hijacking (HttpOnly + SameSite cookies)

**Design boundaries (out of scope):**
- ❌ Multi-user RBAC (single admin by design)
- ❌ Protection against compromised Docker daemon
- ❌ Network segmentation between containers

---

## 📦 Project Management

### Permission Levels

| Permission Level | Description | Allowed Operations |
|-----------------|-------------|-------------------|
| **Managed** | Container control | Start/stop/restart, logs, terminal, AI diagnostics |
| **Compose** | Config editing & pulling | Edit YAML, create missing services, pull images |

### Workspace Container Mechanism

ComposeOps uses temporary workspace containers to access project directories safely:

```yaml
# Auto-created when editing configs for project "myapp"
services:
  composeops-workspace-myapp:
    image: alpine:latest
    volumes:
      - /path/to/myapp:/workspace:rw
    command: sleep 30
```

After operations complete, the workspace container is automatically removed. This ensures:
- ✅ Scoped access: only the target project directory is mounted
- ✅ Time-limited: auto-cleanup after 30 seconds
- ✅ Traceable: labeled with `myops.workspace=true`

---

## 📊 Metrics Guide

### Cost Estimation

The dashboard displays estimated monthly costs based on:
- **vCPU allocation**: $0.04 per vCPU per month
- **RAM allocation**: $0.005 per MB per month

**Note**: These are approximate values for cost awareness, not actual billing. Adjust rates in Settings if needed.

### Health Scores

Service health is scored 0-100 based on:
- **Running state** (50 points): Container is running
- **Health checks** (30 points): Docker health check passing
- **Recent restarts** (20 points): No restarts in last 24 hours

---

## 🛠️ Development & Testing

### Prerequisites

- Node.js 22+
- Docker 20.10+
- npm 10+

### Setup

```bash
# Install dependencies
npm run install:all

# Run tests
npm test                  # All tests
npm run test:backend      # Backend only
npm run test:frontend     # Frontend only

# Development mode
npm run dev:backend       # Backend on :3001
npm run dev:frontend      # Frontend on :5173 (proxies API to :3001)

# Production build
npm run build             # Outputs to frontend/dist
```

### Testing Commands

```bash
# Backend tests (Node.js test runner)
cd backend && npm test

# Frontend tests (Vitest)
cd frontend && npm test

# Type checking & linting
cd frontend && npm run build  # Vite build includes type checking
```

**Note**: No dedicated lint script — linting runs automatically during the build process via ESLint 9.

---

## 💾 Data Storage

All persistent data lives in a single SQLite database with file permission 0600:

```
backend/data/
├── opsdash.db            # Main database (auth, sessions, AI config & history, audit, backups)
└── volume-backups/       # Volume backup archives (overridable via backup.volume_dir)
```

Compose config backups (last 20 per project) are stored in the database and restorable from the UI.

**Backup recommendation**: regularly back up `backend/data/` (or the `opsdash-data` Docker volume in production) to prevent data loss.

---

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

**You are free to**:
- ✅ Use commercially
- ✅ Modify and distribute
- ✅ Use privately

**You must**:
- ✅ Include the original license and copyright notice

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting PRs.

**Quick links**:
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Architecture Documentation](docs/architecture/README.md)
- [Development Guide](CONTRIBUTING.md#development-guide)

---

## 🔗 Related Links

- [English Documentation](README.en.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Issue Templates](.github/ISSUE_TEMPLATE/)

---

<div align="center">

**Built with ❤️ · Designed for personal servers**

If this project helps you, please consider giving it a ⭐ Star

</div>
