# ComposeOps 环境与操作备忘

单用户 Docker Compose 运维台(工作区名 `ComposeOps`,镜像/容器有时沿用旧名 `OpsDash`)。所有 UI 文案为中文,暗色工业风 + emerald 状态色系。

## 基本状态
- Monorepo:`frontend/`(Vue 3 + Vite 5 + Pinia + Tailwind + lucide-vue-next + monaco + xterm)与 `backend/`(Fastify + better-sqlite3 + dockerode + ssh2)。
- 前端 hash router(`/services /compose /logs /shell /ai /monitor /operations /settings`);后端 REST 前缀 `/api/v1`。
- 向量/弹层 z-index 阶梯:`z-0` 内容 → `z-40` Tab/Sidebar → `z-45` Header → `z-50` EventCenter → `z-[51]` 抽屉面板 → `z-[55]` Modal 背板 → `z-[60]` Cmd+K → `z-[70]` Toast。
- 弹层 Esc 统一由 `frontend/src/composables/useEscapeKey.js` 管理(modal > drawer > event > command,`lockBody` 计数锁滚动)。
- 端口映射 `0.0.0.0:28765:3001` 为用户明确配置,勿改。
- 敏感识别正则:`/(SECRET|TOKEN|PASSWORD|PASSWD|\bPASS\b|(?:API|PRIVATE|ACCESS|SECRET|AUTH|SIGNING)[_-]?KEY)/i`。
- 镜像必须保持字节一致:`backend/src/lib/dotenv.js` ⇄ `frontend/src/lib/dotenv.js`;`backend/src/lib/agent-protocol-core.js` ⇄ `frontend/src/lib/agent-protocol-core.js`(改一处就同步另一处,两侧 sync 测试会比对字节兜底)。

## AI Agent
- 执行路径收敛为 Tool Loop 单通道:`POST /ai/agent/execute-stream`(SSE)+ `POST /ai/agent/approve` 确认门;早期 plan/execute/confirm/feedback/export 等规划管线端点已删除,勿再引用。
- 会话历史单一通道:后端从 DB 读,前端不回传 `history`;token 分片由后端发射层保证干净,前端**原样追加,禁止逐分片清洗**(会吃掉分片边界空白,导致 Markdown 表格/代码块粘连)。
- 前端聊天逻辑在 `frontend/src/composables/useAgentChat.js`(工作台与全局抽屉共用);页面上下文采集在 `useAgentConsole.js`(抽屉关闭时不做快照)。
- 路由层:`router.js` 的 `preloadRouteChunks()` 在空闲时预取全部 chunk;App.vue 对 14 个无流式/轮询的页面做 keep-alive(**新增流式/定时轮询页面时务必排除**,否则 interval/ws 在后台保活泄漏);页面切换走 `page-fade` 过渡。

## 常用命令
- 前端构建: `cd frontend && npm run build`(零 Warning;`chunkSizeWarningLimit: 3000`)
- 前端单测: `cd frontend && npx vitest run`
- 后端单测: `cd backend && DB_PATH=/tmp/x.db npm test`(必须 `--test-concurrency=1`,并发会多进程抢同一 DB 偶发失败)
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
