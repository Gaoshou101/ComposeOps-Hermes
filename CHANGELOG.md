# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Visual Compose Editor**: Dual-mode editing (code/visual) for docker-compose files
  - Service card view showing name, image, ports, volumes, environment variables, restart policy
  - Form-based service editor (ServiceEditor.vue) for adding/editing services without writing YAML
  - Bidirectional synchronization between YAML content and visual service representation
  - Add, edit, and delete services through intuitive UI
- **Docker Run Converter**: Convert `docker run` commands to docker-compose YAML format
  - Dedicated converter view at `/converter` route
  - Parses complex docker run commands with port mappings, volumes, environment variables, networks
  - One-click copy to clipboard for generated YAML
  - Integration with compose editor via custom events
- **Container Terminal Component**: Terminal emulator using xterm.js
  - WebSocket-based terminal connection to containers
  - Fit addon for responsive terminal sizing
  - Ready for integration into container detail pages
- Open source foundation documentation (README.en.md, LICENSE, CONTRIBUTING.md)
- Security policy (SECURITY.md) with best practices and vulnerability reporting
- GitHub issue templates (bug report, feature request, question)
- Code of Conduct (Contributor Covenant 2.1)
- Architecture documentation (docs/architecture/README.md) with component breakdown, data flow diagrams, security model, AI Agent architecture, and design decisions
- CI/CD workflows: automated testing, linting, Docker builds on push/PR
- Release automation workflow: multi-arch Docker images (amd64/arm64) with GitHub releases
- Dependabot configuration for automated dependency updates (weekly schedule, grouped updates)
- ESLint 9 flat config for frontend with Vue 3 + Composition API enforcement
- Prettier configuration for consistent code formatting

### Changed
- Compose editor (ComposeView.vue) now supports toggling between Monaco code editor and visual service list view
- Added xterm.js and xterm-addon-fit dependencies to frontend package.json

## [1.0.0] - 2026-09-04

### Added
- **Core Features**
  - Automatic Docker Compose project discovery via container labels
  - Project grouping by `myops.owner` label with favorites and notes
  - Real-time container logs with search, filtering, and ERROR/WARN highlighting
  - Multi-file Compose editor with YAML formatting and validation
  - Automatic backup (last 20 revisions) with line-by-line diff and restore
  - Change preview showing containers to be recreated/restarted before save
  - Web shell (sh/bash only) scoped to managed project containers
  - Container CPU, memory, network, and Docker storage metrics
  - Trend charts with localStorage persistence and alert threshold lines
  - Event center with alert prioritization, read/unread states, and muting
  - Operations history tracking with audit trail export

- **AI Features**
  - AI diagnosis assistant with automatic context (Compose config + 200 lines logs)
  - Container read-only probe and internet search capabilities
  - Session-isolated context with conversation history
  - AI Agent workflow automation (28 tools: start/stop/scale/config/env/network/volume/security/diagnostics/alerts/scheduling/maintenance/metrics)
  - Risk-level classification with step-by-step confirmation
  - Multi-role collaboration with rollback capability
  - Real-time alert evaluation with execution history and feedback export

- **Monitoring & Alerts**
  - Service cards with status timestamps and Compose dependency visualization
  - Environment variable preview (sensitive values masked)
  - Health score calculation on overview page
  - WebSocket real-time event push
  - Notification channels: Bark, Telegram, WeCom, SMTP email, generic webhooks
  - Alert types: container exit, memory threshold, Docker storage threshold

- **Operations**
  - Allowlisted Compose operations: up/stop/restart/pull/ps with real-time output
  - Template insertion for common services (PostgreSQL, Redis, Nginx, healthchecks)
  - Scheduled image pull with update notifications
  - Docker cleanup preview: unused images, build cache, stopped containers, volumes
  - Explicit project management: auto-discovery with manual approval required
  - Project-scoped Compose workspace containers (on-demand directory mounting)

- **Security**
  - Single admin authentication with scrypt password hashing
  - 30-day server-side sessions with HttpOnly, SameSite=Strict cookies
  - REST and WebSocket authentication enforcement
  - Origin validation for modification requests
  - Realpath and Docker-reported file manifest validation for Compose files
  - API key storage in SQLite (excluded from settings export)
  - Managed project access control (logs, shell, AI restricted to approved projects)

- **Development**
  - Backend: Node.js 22 + Fastify + Dockerode + better-sqlite3
  - Frontend: Vue 3 + Vite + Tailwind CSS + Xterm.js + Monaco Editor
  - Test suite: 59 passing tests (Vitest for frontend, Node.js test runner for backend)
  - Real-time features: SSE streaming, WebSocket
  - SWR caching pattern with 12s TTL

### Changed
- Default port binding to `0.0.0.0:28765` (was 127.0.0.1:3001 in early versions)
- Workspace container idle time configurable via `COMPOSEOPS_WORKSPACE_IDLE_MS` (default 90s)
- Maximum cached workspace containers via `COMPOSEOPS_WORKSPACE_CACHE_MAX` (default 8)

### Security
- Docker socket access equivalent to root (documented in SECURITY.md)
- Recommend localhost-only deployment with Tailscale or reverse proxy for remote access
- HTTPS/TLS enforcement via reverse proxy with `TRUST_PROXY=1` flag
- Single-user design (not suitable for multi-tenant deployments)

## [0.x.x] - Pre-release

Early development versions (not publicly released).

---

## Release Notes

### [1.0.0] - Initial Open Source Release

ComposeOps 1.0.0 is the first production-ready release, designed for personal server administrators who want a lightweight Docker Compose management panel with AI-powered automation.

**Key Highlights:**
- ⚡ **Lightweight**: 3.5MB gzipped frontend build
- 🤖 **AI-First**: Native Claude/OpenAI integration for diagnostics and workflow automation
- 🔒 **Security-Focused**: Explicit project approval, scoped operations, audit trail
- 📊 **Real-time**: SSE streaming, WebSocket push, live metrics
- 🧪 **Well-tested**: 59 tests covering core functionality

**Migration from 0.x:**
No breaking changes. Existing SQLite databases are compatible.

**Known Limitations:**
- Single-user only (no multi-tenant support)
- No built-in 2FA (use reverse proxy authentication)
- English UI via i18n not yet implemented (planned for v1.1)

**Getting Started:**
See [README.en.md](./README.en.md) for installation and [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup.

---

[Unreleased]: https://github.com/YourUsername/ComposeOps/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/YourUsername/ComposeOps/releases/tag/v1.0.0
