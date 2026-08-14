# ComposeOps

面向个人服务器的 Docker Compose 运维台。自动发现 Compose 项目，把服务控制、配置编辑、实时日志、容器终端、AI 排错、资源监控和日常维护集中在一个单用户 Web 界面中。

## 功能

- 按 `myops.owner` 标签分组，收藏项目并添加个人备注
- 固定白名单的 `up/down/restart/pull/ps` 操作与实时输出
- 多 Compose 文件编辑、YAML 格式化、`docker compose config` 校验
- 保存前自动备份，保留最近 20 份，可比较和恢复
- 容器实时日志：stdout/stderr、搜索、暂停、下载
- 受项目边界约束的 Web Shell（仅 `sh` / `bash`）
- AI 运维诊断：自动附加 Compose 配置和最近 200 行日志
- 容器 CPU、内存、网络和 Docker 存储用量
- Bark、Telegram、企业微信、SMTP 邮件与通用 Webhook 通知
- 容器退出、内存和 Docker 空间告警
- 定时拉取镜像并提示更新
- 未使用镜像、构建缓存、停止容器和卷的预览/确认清理
- 操作历史、界面偏好与脱敏配置导入/导出
- 自动挂载向导：汇总 Docker Compose 标签中的宿主机目录，生成精确 bind 配置、可选父目录合并方案和重建命令

## 快速开始

```bash
docker compose up -d --build
```

打开 <http://127.0.0.1:3001>。首次进入会要求设置至少 10 个字符的管理员密码，之后使用 HttpOnly Session Cookie 登录。

默认只发布到宿主机回环地址，不会暴露给局域网。需要远程访问时推荐使用 Tailscale：

```bash
tailscale serve --bg http://127.0.0.1:3001
```

也可以使用带 HTTPS 的 Caddy/Nginx 反向代理。不要把 `3001` 端口直接暴露到公网。
反向代理负责 TLS 时请设置 `TRUST_PROXY=1`，以便服务端正确识别 HTTPS 并为 Session Cookie 增加 `Secure`。

## 纳管项目

项目发现只需要 Docker Socket。要编辑配置或执行生命周期操作，还需要把目标项目目录以相同路径挂入 ComposeOps：

```yaml
services:
  opsdash:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /home/user/apps:/home/user/apps
      - /opt/services:/opt/services
      - opsdash-data:/app/backend/data
```

没有挂载的项目仍会显示，但保持只读。后端从 Docker Compose Labels 建立项目注册表；浏览器只提交项目 ID 和固定动作，不能提交任意宿主机路径或命令参数。

服务分散在不同目录时，打开“设置 → 目录挂载”，ComposeOps 会自动列出所有未挂载项目并生成可复制的 `services.opsdash.volumes` 配置。默认方案逐个挂载精确项目目录；只有多个项目处在同一个安全的直接父目录时，界面才会额外显示父目录合并建议，并明确提示权限会扩大。向导不会自动修改宿主机文件或动态创建高权限辅助容器。

应用新增挂载后需要重新创建 ComposeOps（普通 restart 不会改变容器挂载）：

```bash
docker compose up -d --force-recreate opsdash
```

可在业务 Compose 文件中添加归类标签：

```yaml
services:
  web:
    labels:
      myops.owner: Personal
```

## 安全模型

- 单管理员密码使用 Node.js `scrypt` 哈希存储
- 30 天服务端 Session，Cookie 为 HttpOnly、SameSite=Strict
- REST 与 WebSocket 都要求认证
- 修改请求校验浏览器 Origin
- Compose 文件使用 `realpath` 和 Docker 上报文件清单校验
- Compose 操作没有任意参数入口
- Web Shell 只允许进入当前发现项目中的容器
- API Key 保存在持久化 SQLite 中，导出时不会包含

Docker Socket 本身等价于宿主机高权限。即使有登录，也应只在可信个人设备、回环地址或 VPN 内使用。

## 通知与维护

在“设置”中可以配置：

- Bark 服务地址
- Telegram Bot Token 与 Chat ID
- 企业微信机器人 Webhook
- SMTP 邮件服务器
- 任意 JSON Webhook

镜像自动检查会执行 pull，但不会自动重启容器。Docker 清理要求输入 `PRUNE`；未使用卷默认不勾选。

## 指标范围

默认容器化部署下，页面中的“环境 CPU/内存/网络”是 ComposeOps 容器命名空间数据，不冒充宿主机指标。容器级指标来自 Docker Stats；存储数据来自 Docker System DF。

如需真正的宿主机指标，建议单独部署 node-exporter，而不是向 ComposeOps 额外挂载完整 `/proc` 和 `/sys`。

## 开发与测试

```bash
cd backend
npm install
npm test
npm run dev

cd ../frontend
npm install
npm run dev
```

前端开发服务器运行在 `5173`，自动代理 `/api` 和 `/ws` 到 `3001`。

## 数据

SQLite 默认位于 `backend/data/opsdash.db`，Docker 部署使用 `opsdash-data` 卷持久化。数据库、WAL、SHM、构建产物和 `.env` 均不应提交到 Git。
