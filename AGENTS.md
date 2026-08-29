# ComposeOps 环境与操作备忘

单用户 Docker Compose 运维台(工作区名 `ComposeOps`,镜像/容器有时沿用旧名 `OpsDash`)。所有 UI 文案为中文,暗色工业风 + emerald 状态色系。

## 基本状态
- Monorepo:`frontend/`(Vue 3 + Vite 5 + Pinia + Tailwind + lucide-vue-next + monaco + xterm)与 `backend/`(Fastify + better-sqlite3 + dockerode + ssh2)。
- 前端 hash router(`/services /compose /logs /shell /ai /monitor /operations /settings`);后端 REST 前缀 `/api/v1`。
- 向量/弹层 z-index 阶梯:`z-0` 内容 → `z-40` Tab/Sidebar → `z-45` Header → `z-50` EventCenter → `z-[51]` 抽屉面板 → `z-[55]` Modal 背板 → `z-[60]` Cmd+K → `z-[70]` Toast。
- 弹层 Esc 统一由 `frontend/src/composables/useEscapeKey.js` 管理(modal > drawer > event > command,`lockBody` 计数锁滚动)。
- 端口映射 `0.0.0.0:28765:3001` 为用户明确配置,勿改。
- 敏感识别正则:`/(SECRET|TOKEN|PASSWORD|PASSWD|\bPASS\b|(?:API|PRIVATE|ACCESS|SECRET|AUTH|SIGNING)[_-]?KEY)/i`。
- 镜像必须保持字节一致:`backend/src/lib/dotenv.js` ⇄ `frontend/src/lib/dotenv.js`(改一处就同步另一处)。

## 常用命令
- 前端构建: `cd frontend && npm run build`(零 Warning;`chunkSizeWarningLimit: 3000`)
- 前端单测: `cd frontend && npx vitest run`
- 后端单测: `cd backend && DB_PATH=/tmp/x.db node --test test/*.test.js`
- 后端语法: `node --check <file>`
- 完整启动: `node backend/src/index.js`(`SERVE_FRONTEND=1 PORT=3001 ENABLE_SHELL=1`)

## 多节点 Docker 宿主
- `backend/src/services/docker-hosts.js` 管理 Local/TCP/SSH 节点;活跃节点通过 `setSetting('docker.active_host')` 持久化。
- 远程节点(TCP/SSH)下 `scanner` 自动把项目降级为容器控制模式(`editable=false`),Compose/env 编辑路由会被 403 guard 拦截;`compose-runner` 通过 `DOCKER_HOST` 环境变量在子进程内切换节点。
- 切换节点后前端广播 `composeops:host-changed`,各页面监听触发刷新。

## Git 操作经验
- 沙箱内 `.git` 只读:commit 需 `sandbox_permissions=require_escalated`,`prefix_rule:["git","commit","-m"]` 已批准。
- `git push origin main` HTTPS 在沙箱握手失败;直接提升权限走已批准 `["git","push"]` 即可成功;SSH 地址 `git@github.com:StanlySGY/ComposeOps.git` 沙箱内 DNS 解析失败,需同样提升权限。
- 提交信息用中文结构话术(标题 + `-` 分节)。
