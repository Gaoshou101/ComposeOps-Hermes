<div align="center">

# ComposeOps

**轻量级 Docker Compose 运维面板，专为个人服务器设计**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED.svg?logo=docker)](https://docs.docker.com/compose/)

自动发现 Compose 项目，集成服务控制、配置编辑、实时日志、AI 诊断和资源监控于单一 Web 界面

[功能特性](#功能特性) • [快速开始](#快速开始) • [安全模型](#安全模型) • [开发指南](CONTRIBUTING.md) • [English](README.en.md)

</div>

---

## ✨ 功能特性

### 🚀 核心能力

<table>
<tr>
<td width="50%">

**项目管理**
- 🔍 自动发现 Compose 项目（基于容器标签）
- 📁 按 `myops.owner` 分组，支持收藏和备注
- 🎯 显式纳管：默认只读，手动授权后开放控制
- 🔐 双级权限：纳管（容器控制）+ Compose（配置编辑）

</td>
<td width="50%">

**配置编辑**
- ✏️ 多文件 YAML 编辑器（Monaco Editor）
- ✅ 实时语法校验（depends_on / 端口冲突 / 缺失镜像）
- 💾 自动备份最近 20 份，支持 diff 和恢复
- 🔍 保存前预览将重建/重启的容器

</td>
</tr>
<tr>
<td>

**实时监控**
- 📊 容器 CPU、内存、网络、存储指标
- 📈 趋势图表（localStorage 持久化）
- 🔔 告警阈值配置与实时推送
- 💓 服务健康状态卡片

</td>
<td>

**日志与终端**
- 📜 实时日志流（ERROR/WARN 过滤与高亮）
- 🔎 搜索、暂停、下载、关键字着色
- 🖥️ Web Shell（sh/bash，项目作用域）
- 🚨 异常退出日志自动归档

</td>
</tr>
</table>

### 🤖 AI 增强

<table>
<tr>
<td width="50%">

**诊断助手**
- 🩺 自动附加 Compose 配置 + 最近 200 行日志
- 🔍 容器只读探针 + 联网检索
- 💬 会话隔离上下文，支持历史回溯

</td>
<td width="50%">

**AI Agent 工作流**
- 🎭 自然语言规划运维任务
- 🛠️ **28 个工具**：启停/扩容/配置/网络/卷/安全审计/诊断/维护
- ⚠️ 风险分级（低/中/高/极高）+ 逐步确认
- 📋 执行历史、审计日志、反馈导出

</td>
</tr>
</table>

### 🔔 告警与通知

- **多渠道推送**：Bark / Telegram / 企业微信 / SMTP / Webhook
- **告警类型**：容器退出 / 内存阈值 / Docker 存储告警
- **事件中心**：优先级、已读/静默状态、WebSocket 实时推送

### 🧹 运维工具

- ⏰ 定时拉取镜像并提示更新
- 🗑️ Docker 清理预览（未使用镜像/缓存/卷）
- 📦 Compose 模板库（PostgreSQL / Redis / Nginx / 健康检查）
- 📋 操作历史与审计日志

---

## 🚀 快速开始

### 前置要求

- Docker Engine 20.10+
- Docker Compose v2

### 一键部署

```bash
# 克隆仓库
git clone https://github.com/StanlySGY/ComposeOps.git
cd ComposeOps

# 启动服务
docker compose up -d --build
```

打开浏览器访问 **http://127.0.0.1:3001**

首次访问需设置管理员密码（最少 10 个字符），之后使用 Session Cookie 登录。

### 远程访问（推荐 Tailscale）

默认仅绑定 `127.0.0.1`，不暴露到局域网。需要远程访问时：

```bash
# 方式 1: Tailscale（推荐）
tailscale serve --bg http://127.0.0.1:3001

# 方式 2: 反向代理（Caddy/Nginx + HTTPS）
# 设置环境变量: TRUST_PROXY=1
```

⚠️ **安全提示**：不要直接将 `3001` 端口暴露到公网。

---

## 🔒 安全模型

### 认证与授权

- ✅ Scrypt 密码哈希（Node.js 原生）
- ✅ 30 天 Session（HttpOnly + SameSite=Strict）
- ✅ REST + WebSocket 统一认证
- ✅ Origin 校验（防 CSRF）

### 文件与操作隔离

- ✅ Realpath 校验（防路径穿越）
- ✅ Docker 文件清单交叉验证
- ✅ 白名单操作（up/stop/restart/pull/ps）
- ✅ 项目级工作容器（按需挂载目录）

### API Key 保护

- ✅ SQLite 加密存储
- ✅ 配置导出时自动脱敏
- ✅ 仅通过认证连接传输

### 威胁模型

**假设信任**：单用户管理员 + 本地/VPN 部署 + Docker Socket 等价 root

**防护范围**：路径穿越 / 任意命令执行 / 未授权项目访问 / Session 劫持

**设计边界**：不支持多租户隔离，Docker Daemon 妥协即全局妥协

详见 [SECURITY.md](SECURITY.md)

---

## 📦 项目纳管

### 发现与授权

打开"设置 → 项目纳管"，每个自动发现的项目有两个独立开关：

| 权限级别 | 说明 | 允许的操作 |
|---------|------|-----------|
| **纳管** | 现有容器控制 | 启动/停止/重启、日志、终端、AI 诊断 |
| **Compose** | 配置编辑与拉取 | 编辑 YAML、创建缺失服务、拉取镜像 |

### 工作容器机制

勾选 **Compose** 后，ComposeOps 按需创建短生命周期工作容器：

```yaml
# 自动创建的临时容器（项目作用域）
docker run -d --rm --name opsdash-ws-myapp \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/myapp:/opt/myapp \
  --workdir /opt/myapp \
  composeops/opsdash:latest sleep 3600
```

- **复用策略**：90 秒内连续操作无需重建
- **自动清理**：空闲后销毁，取消勾选时立即清理
- **配置调整**：
  - `COMPOSEOPS_WORKSPACE_IDLE_MS`：空闲保留时间（默认 90000 毫秒）
  - `COMPOSEOPS_WORKSPACE_CACHE_MAX`：最多缓存项目数（默认 8）

### 业务标签分组

在业务 Compose 文件中添加归类标签：

```yaml
services:
  web:
    labels:
      myops.owner: Personal  # 在面板中按此分组
```

---

## 📊 指标说明

**容器化部署下的指标范围**：

- **环境 CPU/内存/网络**：ComposeOps 自身容器的命名空间数据
- **容器级指标**：来自 Docker Stats API
- **存储数据**：来自 Docker System DF

> 需要真实宿主机指标？建议单独部署 [node-exporter](https://github.com/prometheus/node_exporter)，而非向 ComposeOps 挂载完整 `/proc` 和 `/sys`。

---

## 🛠️ 开发与测试

### 聚合脚本（推荐）

在仓库根目录一次完成前后端操作：

```bash
npm run install:all   # 安装 backend + frontend 依赖
npm test              # 后端 + 前端全量测试
npm run lint          # ESLint 代码检查
npm run dev:backend   # 后端开发服务器（3001）
npm run dev:frontend  # 前端开发服务器（5173，自动代理 API）
npm run build         # 构建前端生产版本
```

### 独立子目录操作

```bash
# 后端
cd backend
npm install
npm test
npm run dev

# 前端
cd frontend
npm install
npm run dev          # 自动代理 /api 和 /ws 到 3001
npm run build
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 🗂️ 数据存储

- **SQLite 数据库**：`backend/data/opsdash.db`
- **Docker 卷持久化**：`opsdash-data`（生产部署）
- **不应提交到 Git**：`*.db`、`*.db-wal`、`*.db-shm`、`.env`、`dist/`

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [架构文档](docs/architecture/README.md)

---

## 🔗 相关链接

- [English Documentation](README.en.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Issue Templates](.github/ISSUE_TEMPLATE/)

---

<div align="center">

**由 ❤️ 打造 · 专为个人服务器设计**

如果这个项目帮到了你，欢迎 ⭐ Star 支持

</div>
