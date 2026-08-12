# ComposeOps / OpsDash

轻量级单容器部署的 Web 运维管理平台 —— 纳管宿主机 Docker Compose 项目，按 `myops.owner` 标签分组，集成 AI 排错与资源监控。

## 技术栈

- **后端**：Node.js + Fastify + dockerode + ws + better-sqlite3
- **前端**：Vue 3 + Vite + Tailwind + Pinia + Monaco Editor + xterm.js
- **数据库**：SQLite（配置 / AI 对话历史）
- **通讯**：REST API + WebSocket

## 目录结构

```
ComposeOps/
├── backend/          # Fastify API server + WebSocket
│   └── src/
│       ├── routes/   # REST endpoints
│       ├── services/ # docker / ai / monitor
│       ├── lib/      # sqlite / utils
│       └── index.js
└── frontend/         # Vue 3 + Vite
```

## 开发

```bash
# 后端
cd backend && npm install && npm run dev

# 前端
cd frontend && npm install && npm run dev
```

## 功能模块

1. 全机 Docker Compose 服务扫描与分组管理（`myops.owner` 标签）
2. Compose 项目文件管理（Monaco 编辑器）+ 生命周期运维（up/down/restart/pull）
3. 实时日志流 + 容器 Web Shell（WebSocket + xterm.js）
4. 上下文感知 AI 运维助手（日志排错 / YAML 生成）
5. 宿主机 + 容器级资源监控
