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

## Docker 部署（推荐）

整个面板用一条命令拉起：

```bash
# 1. 设置你本机存放 compose 项目的目录（OpsDash 要纳管的那批）
export COMPOSE_PROJECTS_DIR=/home/sgy/compose-projects

# 2. 构建并启动
docker compose up -d --build

# 3. 打开 http://localhost:3001
```

镜像为多阶段构建：前端 Vite 产物 + 后端 Node 运行时（内含 `docker` CLI 与 compose v2 插件）合入单容器，由后端 Fastify 以静态 SPA 形式托管（`SERVE_FRONTEND=1`）。

### 关键挂载说明

- **`/var/run/docker.sock`** —— 容器内 dockerode / `docker compose` CLI 通过它与宿主机 Docker 引擎通信（非 privileged，仅 socket）。
- **`${COMPOSE_PROJECTS_DIR}`** —— 你的 compose 项目目录，**以相同路径**挂进容器。OpsDash 按 `com.docker.compose.project.working_dir` 标签分组，该标签值是宿主机路径；要让容器内的文件编辑/生命周期操作生效，宿主机路径必须原样可达，故采用同路径挂载。`ALLOWED_ROOT` 同步指向该路径，后端 `denyIfRestricted` 据此放行。
- **`opsdash-data` 命名卷** —— 挂到 `/app/backend/data`，持久化 SQLite。AI 配置（含 API Key）与对话历史都存在这里，重建镜像不丢失。**API Key 仅在 Settings 页录入、存入 SQLite，绝不出现在 env 或镜像中。**

> ℹ️ 配置 AI：启动后进入 **设置** 页填写 Base URL / API Key / 模型，保存即写入 SQLite 卷。

### 已知限制（容器化监控）

- `df`-based 宿主机磁盘统计（过滤 `/`、`/var/lib/docker`）在容器内反映的是**容器的挂载视图**而非宿主机真实磁盘；`os.cpus()` / `os.totalmem()` / `/proc/net/dev` 同理受容器命名空间影响。容器级指标（dockerode `.stats()`）不受影响。若需精确宿主机数据，可额外挂载 `/proc`、`/sys` 并使用 host network —— 默认配置仅做最小化 socket 挂载。

## 功能模块

1. 全机 Docker Compose 服务扫描与分组管理（`myops.owner` 标签）
2. Compose 项目文件管理（Monaco 编辑器）+ 生命周期运维（up/down/restart/pull）
3. 实时日志流 + 容器 Web Shell（WebSocket + xterm.js）
4. 上下文感知 AI 运维助手（日志排错 / YAML 生成）
5. 宿主机 + 容器级资源监控
