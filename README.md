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
# 1.（可选）挂载你想在面板里编辑的 compose 项目目录，见下方说明
#    不挂载也能用：所有 compose 项目照样被自动发现、只读列出

# 2. 构建并启动
docker compose up -d --build

# 3. 打开 http://localhost:3001
```

镜像为多阶段构建：前端 Vite 产物 + 后端 Node 运行时（内含 `docker` CLI 与 compose v2 插件）合入单容器，由后端 Fastify 以静态 SPA 形式托管（`SERVE_FRONTEND=1`）。

### 服务发现：全自动，零配置

OpsDash 通过 Docker socket 列出宿主机所有容器，按 `com.docker.compose.project` 标签分组、`myops.owner` 归类。**不需要指定任何目录**——挂上 `/var/run/docker.sock` 这一项就够了，所有 compose 项目（含它们的 compose 文件路径）都会被自动发现并列出来。

### 编辑与生命周期：按需挂载目录

发现是自动的，但**编辑 compose 文件 / 执行 up/down/restart 需要该项目的目录在容器里可达**。因为容器化下，宿主机路径只在 bind-mount 进来后才存在。

- **没挂载的项目**：照样显示在总览页，但「编辑 / up / down」按钮置灰，提示"compose 文件未挂载进容器，不可编辑"。
- **想编辑哪些项目，就挂哪些目录**——在 `docker-compose.yml` 的 `volumes` 下加一行 `/宿主机路径:/宿主机路径`（**两侧同路径**，这样 `com.docker.compose.project.working_dir` 标签里的宿主机路径才能在容器内原样命中）。

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  # 想编辑哪些 compose 项目目录，就挂哪些（两侧同路径）
  - /home/sgy/compose-projects:/home/sgy/compose-projects
  - /opt/app:/opt/app
  - opsdash-data:/app/backend/data
```

安全：后端只放行 Docker 自己上报的 compose 项目路径（即标签里的 `working_dir`），编辑器碰不到 SQLite 里的 API Key 等无关文件。`ALLOWED_ROOT` 是可选的高级覆盖，通常不用设。

### 关键挂载说明

- **`/var/run/docker.sock`** —— 容器内 dockerode / `docker compose` CLI 通过它与宿主机 Docker 引擎通信（非 privileged，仅 socket）。这一项就足以让面板**发现**所有 compose 项目。
- **`/宿主机路径:/宿主机路径`**（可选，同路径）—— 把你的 compose 项目目录挂进容器，让对应项目的「编辑 / 生命周期」可用。挂多少个都行，挂了的可编辑、没挂的只读。
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
