# ComposeOps

<div align="center">

**AI-Powered Docker Compose Operations Dashboard**

Lightweight · Real-time · Self-hosted

[中文文档](./README.md) | [Demo](#-screenshots) | [Quick Start](#-quick-start)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)](https://hub.docker.com/r/composeops/opsdash)

</div>

---

## ✨ Features

### 🎯 Core Management
- **Auto-discovery**: Automatically finds all Docker Compose projects on the host
- **Unified Dashboard**: Manage services, logs, configs, and resources in one place
- **Real-time Operations**: Start/stop/restart with live streaming output
- **Configuration Editor**: Edit Compose files with YAML validation and semantic checks
- **Version Control**: Auto-backup (20 versions), diff comparison, one-click rollback

### 🤖 AI-Powered Automation
- **AI Agent Workflow**: Natural language → automated operations (28 tools)
  - Service lifecycle (start/stop/restart/scale)
  - Configuration management (env vars, volumes, networks)
  - Security audit & health checks
  - Alert management & scheduled tasks
- **AI Diagnostics**: Automatic context attachment (configs + logs + container probes)
- **Multi-role Collaboration**: Planning, execution, monitoring with rollback capability
- **Risk Assessment**: 4-level risk system (low/medium/high/critical) with step-by-step confirmation

### 📊 Monitoring & Observability
- **Real-time Metrics**: CPU, memory, network, and Docker storage usage
- **Live Logs**: Streaming logs with search, filtering (ERROR/WARN), and smart highlighting
- **Event Center**: Alert persistence, WebSocket push, anomaly detection
- **Batch Operations**: Multi-project actions with SSE streaming progress

### 🔔 Alerts & Notifications
- **Multi-channel**: Bark, Telegram, WeChat Work, SMTP, Generic Webhook
- **Triggers**: Container exit, memory threshold, disk space
- **Smart Suppression**: Priority levels and read/mute status

### 🔒 Security
- **Explicit Project Management**: Discovered projects require manual approval for operations
- **Scoped Access**: Per-project directory mounting with auto-cleanup
- **Web Shell**: Restricted to managed containers only
- **Session Security**: HttpOnly cookies, CSRF protection, Origin validation

---

## 🚀 Quick Start

### Prerequisites
- Docker 20.10+ & Docker Compose v2
- Linux/macOS/Windows (WSL2)
- 1GB RAM minimum

### One-Command Deploy

```bash
git clone https://github.com/YourUsername/ComposeOps.git
cd ComposeOps
docker compose up -d --build
```

Open <http://localhost:3001> in your browser. First-time setup will prompt for an admin password (min 10 characters).

### Remote Access (Recommended)

**Option 1: Tailscale** (Zero-config VPN)
```bash
tailscale serve --bg http://127.0.0.1:3001
```

**Option 2: Reverse Proxy** (Caddy/Nginx with HTTPS)
```bash
# Set TRUST_PROXY=1 in docker-compose.yml environment
# Configure your reverse proxy to forward to 127.0.0.1:3001
```

⚠️ **Never expose port 3001 directly to the public internet** — Docker socket access = root privileges.

---

## 📸 Screenshots

<details>
<summary><b>Dashboard Overview</b></summary>

![Dashboard](docs/screenshots/dashboard.png)
*Service status, health scores, and quick actions*

</details>

<details>
<summary><b>AI Agent Workflow</b></summary>

![AI Agent](docs/screenshots/agent-workflow.png)
*Natural language → automated multi-step operations*

</details>

<details>
<summary><b>Real-time Logs</b></summary>

![Logs](docs/screenshots/logs-view.png)
*Live streaming logs with smart filtering and highlighting*

</details>

<details>
<summary><b>Configuration Editor</b></summary>

![Editor](docs/screenshots/config-editor.png)
*YAML editing with validation and change preview*

</details>

---

## 📖 Documentation

- [Installation Guide](docs/installation.md)
- [Project Management](docs/project-management.md)
- [AI Agent Usage](docs/ai-agent.md)
- [API Reference](docs/api.md)
- [Development Guide](docs/development.md)
- [Security Best Practices](docs/security.md)

---

## 🏗️ Architecture

```
┌─────────────────┐
│   Vue 3 SPA     │  Frontend: Vite + Tailwind CSS
│   (Port 5173)   │  State: SWR caching (12s TTL)
└────────┬────────┘  Real-time: SSE streaming
         │
    HTTP + WS
         │
┌────────┴────────┐
│  Fastify API    │  Backend: Node.js 22 + Fastify
│   (Port 3001)   │  Database: SQLite3
└────────┬────────┘  Container: Dockerode
         │
   Docker Socket
         │
┌────────┴────────┐
│  Docker Engine  │  Compose projects on host
└─────────────────┘
```

**Key Technologies:**
- **Frontend**: Vue 3 Composition API, Vite, Tailwind CSS, SWR caching
- **Backend**: Node.js 22 ESM, Fastify, Dockerode, better-sqlite3
- **Real-time**: Server-Sent Events (SSE), WebSocket
- **Testing**: Vitest (59 tests), Node.js test runner

---

## 🛠️ Development

### Prerequisites
- Node.js 22+
- Docker 20.10+
- npm 10+

### Setup

```bash
# Install all dependencies (frontend + backend)
npm run install:all

# Run tests
npm test

# Development mode
npm run dev:backend   # Backend on :3001
npm run dev:frontend  # Frontend on :5173 (proxies to :3001)

# Build for production
npm run build
```

### Project Structure

```
ComposeOps/
├── backend/              # Fastify API server
│   ├── src/
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Business logic
│   │   ├── db/          # SQLite schema
│   │   └── index.js     # Entry point
│   └── test/            # Backend tests
├── frontend/            # Vue 3 SPA
│   ├── src/
│   │   ├── views/       # Page components
│   │   ├── components/  # Reusable components
│   │   ├── api/         # API client + SWR
│   │   └── stores/      # State management
│   └── tests/           # Vitest tests
├── docker-compose.yml   # Deployment config
├── Dockerfile           # Multi-stage build
└── docs/                # Documentation
```

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with conventional commits (`feat:`, `fix:`, `docs:`)
6. Push and create a Pull Request

### Areas for Contribution

- 🌍 **i18n**: Add translations (currently Chinese only)
- 📝 **Documentation**: Improve guides and examples
- 🧪 **Testing**: Increase test coverage
- 🎨 **UI/UX**: Enhance design and accessibility
- 🔌 **Integrations**: Add notification channels or monitoring systems

---

## 🗺️ Roadmap

### v1.1 (Q4 2026)
- [ ] Multi-language support (i18n)
- [ ] Agent Marketplace (installable plugins)
- [ ] Prometheus/Grafana integration
- [ ] Migration tool from Portainer/Rancher

### v1.2 (Q1 2027)
- [ ] Multi-user support with RBAC
- [ ] Audit log export (CSV/JSON)
- [ ] Kubernetes support
- [ ] Mobile-responsive UI

---

## 🆚 Comparison

| Feature | ComposeOps | Portainer | Rancher | Lazydocker |
|---------|------------|-----------|---------|------------|
| **Lightweight** | ✅ 3.5MB build | ❌ 200MB+ | ❌ 500MB+ | ✅ 10MB |
| **AI Agent** | ✅ 28 tools | ❌ | ❌ | ❌ |
| **Batch Ops** | ✅ SSE streaming | ✅ | ✅ | ❌ |
| **Cost Analysis** | ✅ | ❌ | ✅ | ❌ |
| **Self-hosted** | ✅ | ✅ | ✅ | ✅ |
| **Learning Curve** | Low | Medium | High | Low |

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

### What This Means

✅ **You can:**
- Use commercially
- Modify and distribute
- Use privately
- Sublicense

❌ **You must:**
- Include the original license and copyright notice
- State changes made to the code

❌ **No warranty:** The software is provided "as is" without liability

---

## 🙏 Acknowledgments

- **Docker** for the containerization platform
- **Vue.js** team for the reactive framework
- **Fastify** for the performant web server
- **Anthropic** for Claude AI integration
- **Community** for feedback and contributions

---

## 📬 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/YourUsername/ComposeOps/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YourUsername/ComposeOps/discussions)
- **Email**: your-email@example.com

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=YourUsername/ComposeOps&type=Date)](https://star-history.com/#YourUsername/ComposeOps&Date)

---

<div align="center">

**If you find ComposeOps useful, please consider giving it a ⭐️!**

Made with ❤️ by the ComposeOps team

</div>
