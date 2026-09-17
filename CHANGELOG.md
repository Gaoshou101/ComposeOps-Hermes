# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **统一资产模型 (CMDB)**: Host/Project/Container/Volume/Network 收敛为统一 `assets` 实体
  - 资产同步从 Docker 扫描重建,支持 `asset_relations` 依赖关系与拓扑查询
  - 新增 `/cmdb/*` API 与「资产中心」页面(`/cmdb`),作为知识图谱与事件中心的单一事实来源
- **统一事件中心 (Event Center 2.0)**: 告警/巡检/部署/回滚/Agent/GitOps/工作流全部收敛为 `event_records`
  - 新增 `/events/*` API 与「事件中心」页面(`/events`),支持按类型/级别/状态过滤与状态流转
  - 事件统计聚合,作为时间线的单一事实来源
- **工作流引擎 (Workflow Engine)**: 轻量编排引擎,节点类型 trigger/condition/agent/approval/action/verify
  - 新增 `/workflows/*` API 与「工作流中心」页面(`/workflows`)
  - 支持手动/定时/事件触发,approval 节点进入等待审批,Agent 作为工作流节点实现编排解耦
- **知识图谱升级**: 支持切换「实时数据 / 资产中心数据」两种数据源,直接读取 CMDB 统一资产模型

### Changed
- 数据库迁移扩展至 v9(统一资产模型 / 事件中心 / 工作流引擎)
- 侧边栏新增「资产中心」「事件中心」「工作流」入口

### Fixed
- Agent streaming corruption from per-chunk text sanitization (protocol stripping now stateful at the emission layer with prefix hold-back)
- Missing `stripAgentProtocol` import crashing the page-agent drawer on first token
- Flaky backend tests caused by concurrent SQLite access (tests now serialized)
- **国内网络下 `docker compose up -d --build` 必然失败**: 原 Dockerfile 依赖 `deb.debian.org`
  (12MB 的 `Packages.gz` 在国内常超时)与 `download.docker.com` 的 GPG key。现改为
  apt 默认走清华镜像(`ARG APT_MIRROR`,传空可回官方源)、`better-sqlite3` 优先走
  npmmirror 预编译产物(无需 python3/make/g++,整条 apt 分支可跳过)、
  docker CLI 与 compose 插件直接从官方 `docker:cli` 镜像 COPY 进来
  (不再访问 `download.docker.com`),并在构建期断言 `docker / docker compose / git / ssh` 全部可用
- **镜像里缺失 `git` / `ssh`**: `backend/src/services/gitops.js` 通过 `execFileSync('git', ...)`
  执行 clone/pull,容器内 GitOps 此前直接 ENOENT。runtime 阶段改装
  `ca-certificates curl gnupg git openssh-client`(体积远小于原来的 docker-ce-cli)

## [1.0.0] - 2026-09-04

### Added
- **Core Features**
  - Automatic Docker Compose project discovery via container labels
  - Project grouping by `myops.owner` label with favorites and notes
  - Real-time container logs with search, filtering, and ERROR/WARN highlighting
  - Multi-file Compose editor with YAML formatting and validation
  - **Visual Compose Editor**: Dual-mode editing (code/visual) for docker-compose files with service card view and form-based editing
  - Automatic backup (last 20 revisions) with line-by-line diff and restore
  - Change preview showing containers to be recreated/restarted before save
  - Web shell (sh/bash only) scoped to managed project containers
  - Container CPU, memory, network, and Docker storage metrics
  - Trend charts with localStorage persistence and alert threshold lines
  - Event center with alert prioritization, read/unread states, and muting
  - Operations history tracking with audit trail export
  - **InteractiveChart Component**: Multi-metric comparison with export functionality (Phase 2 completed)

- **AI Features**
  - AI diagnosis assistant with automatic context (Compose config + 200 lines logs)
  - Container read-only probe and internet search capabilities
  - Session-isolated context with conversation history
  - AI Agent workflow automation (31 tools: start/stop/scale/config/env/network/volume/security/diagnostics/alerts/scheduling/maintenance/metrics)
  - Risk-level classification with step-by-step confirmation
  - Multi-role collaboration (planner/executor/validator/incident_responder) with rollback capability
  - Real-time alert evaluation with execution history and feedback export
  - Streaming execution with live thought process display and step-by-step confirmation

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
