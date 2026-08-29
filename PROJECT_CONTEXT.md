# 📌 ComposeOps - PROJECT_CONTEXT.md
> **上次更新时间**:2026-08-29 09:55 (Asia/Shanghai)
> **当前版本/阶段**:v0.3 - 三大高级运维功能(一键 AI 诊断 / 多节点纳管 / 容器实时监控)已交付

## 1. 核心概述 (Executive Summary)
- **项目目标**:单用户 Docker Compose 运维控制台(工作区名 `ComposeOps`,镜像/容器沿用旧名 `OpsDash`)。通过 Docker Socket 自动发现带 `com.docker.compose.project` 标签的 Compose 项目,以"先发现、后显式纳管"的权限模型提供项目启停、Compose 配置编辑、环境变量管理、实时日志、容器终端、AI 排错、批量任务、多 Docker 节点纳管与资源监控等能力。
- **技术栈**:前端 Vue 3 + Vite 5 + Pinia + Vue Router(hash 模式)+ Tailwind CSS + lucide-vue-next + Monaco Editor + xterm.js;后端 Fastify 4 + @fastify/websocket + better-sqlite3 + dockerode(+docker-modem 原生 SSH)+ ssh2 + tar-stream + yaml;单测 Vitest 3(node 侧 `node --test`)。
- **核心架构约定**:后端 REST 前缀 `/api/v1`(业务路由按域拆分在 `backend/src/routes/`),SSE(`text/event-stream`)用于 Compose 操作与环境变量应用、AI 诊断与指标流,WebSocket(`/ws/logs`、`/ws/exec`、`/ws/jobs`)用于实时日志/终端/批量任务;前端按 `views / components/services / components/common / stores / composables / lib / api` 组织;弹层统一走 `useEscapeKey` 栈 + z-index 阶梯;AI 对话与诊断走独立 `routes/ai.js` + `services/ai.js`(OpenAI 兼容接口)。

## 2. 当前开发进度 (Current Status)
- **已完成功能 (Completed)**:
  - 设计 Token 规范化与 UI 重构:统一 emerald 状态色族、z-index 阶梯(内容 z-0 → Tab/Sidebar z-40 → Header z-45 → EventCenter z-50 → 抽屉面板 z-[51] → Modal 背板 z-[55] → Cmd+K z-[60] → Toast z-[70])、全局 ToastContainer 与 Vue Transition。
  - `useEscapeKey` 多层弹窗栈:权重 `modal > drawer > event > command`,按 Esc 只关最顶层面板,`lockBody` 计数锁滚动,路由切换自动清场。
  - 项目纳管/挂载模型(容器控制模式 vs Compose 直连/按需 workspace 容器)、Compose 备份/恢复、批量后台任务(`background-jobs` + WS 推送)、审计操作历史、通知告警(Bark/Telegram/企微/邮件/Webhook)、镜像更新检查与 Docker 维护清理、AI 对话助手。
  - 项目环境变量(`.env`):`GET/PUT /api/v1/projects/:id/env` 与 `POST /:id/env/apply`,解析/序列化/校验工具库、原子写 + 时间戳备份、`docker compose up -d --force-recreate` 应用并通过 SSE 实时回传,前端 `ProjectEnvModal` 表格/Raw 双模 + 敏感变量脱敏 + `useEscapeKey`。
  - 三大高级运维功能(commit `a9081e5`):一键 AI 诊断(增强 `/ai/diagnose` 支持 rawLogs/failedCommand/exitCode/envKeys 脱敏,`AIDiagnosisModal` 流式展示 + 复制命令 + 跳转编辑器,入口在操作输出抽屉/日志页/操作中心);多节点管理(Local/TCP/SSH CRUD + 连通检测 + `DOCKER_HOST` 子进程切换,`HostSwitcher` 全局切换 + Settings 节点 Tab + Cmd+K `Switch Node` 指令,切换广播 `composeops:host-changed` 各页联动刷新);容器实时监控(`GET /projects/:id/stats/stream` SSE,`SparklineChart.vue` 轻量 SVG 双线,卡片展开行胶囊读数 + `/monitor` 表格趋势线,CPU≥85%/MEM≥90% 告警色)。
- **开发中/刚刚完成的部分 (Recent)**:
  - 本轮创建 `AGENTS.md`(环境与操作备忘)与 `PROJECT_CONTEXT.md`(本文档),作为可持续维护的会话交接载体。
  - 最近提交 `a9081e5`(三大功能,34 文件 +1457/-94)、`12201ce`(环境变量,12 文件 +832/-12),工作区干净无未提交改动。

## 3. 下一步任务清单 (Next Action Items)
- [ ] **紧急/首要任务**:对三大新功能做一次真机/容器内实测——特别是多节点 SSH/TCP 连接的 `ping` 与切换(`DOCKER_HOST` 子进程是否真正连通)、`stats/stream` 在远程节点下的指标拉取、AI 诊断在无 Docker 环境下的降级路径;开发环境可用 `node backend/src/index.js`(`SERVE_FRONTEND=1 PORT=3001 ENABLE_SHELL=1`)验证。
- [ ] **后续规划**:
  - [ ] 远程节点下 Compose 配置编辑/环境变量目前被 403 guard 拦截,可规划经 SSH 通道的远程文件读写(基于既有 workspace 或 dockerode exec)。
  - [ ] 指标流增加丢线重连与断点续采;Sparkline 支持 hover 查看具体数值。
  - [ ] AI 诊断结果落库/历史;诊断结论一键生成修复命令并直接触发 Compose 操作。
  - [ ] 批量任务支持"失败自动暂停/重试";节点健康状态周期性探测与告警。

## 4. 关键上下文与决策记录 (Crucial Context & Decisions)
- **核心业务逻辑/陷阱**:
  - 权限模型:自动发现 → 显式"纳管"(容器控制)→ 再显式勾选 Compose 目录(可编辑)。远程节点下 `scanner` 强制 `editable=false` 降级容器控制模式,Compose/env 路由由 `requireEditable`/`assertEnvAccess` 返回 403。
  - 敏感识别正则(前后端必须一致):`/(SECRET|TOKEN|PASSWORD|PASSWD|\bPASS\b|(?:API|PRIVATE|ACCESS|SECRET|AUTH|SIGNING)[_-]?KEY)/i`;前端 `src/lib/dotenv.js` 与后端 `backend/src/lib/dotenv.js` 必须字节一致(改一处同步另一处)。
  - 多模态文件读写:宿主机直挂(`project.mounted`)走 `compose-runner.js` 直接 spawn;否则走 workspace 容器(`compose-workspace.js`,tar 归档读写 + 空闲 90s 回收)。
  - 节点连接:`docker-modem@5` 原生支持 `ssh://`(ssh2 已在依赖树),因此 SSH 节点直接用 dockerode 客户端,不自行实现远程 shell;compose 子进程则注入 `DOCKER_HOST` 环境变量切换。
  - SSE 端点(env/apply、actions、stats/stream、ai/diagnose)都必须处理客户端断开(`reply.raw.on('close')`)清理子进程/定时器,防止资源泄漏。
  - 端口映射 `0.0.0.0:28765:3001` 是用户明确配置,勿改回。
- **架构/技术决策 (ADR)**:
  - 选择 "先发现后纳管" 而非自动授权:避免容器化下面板自身暴露全部主机权限。
  - 远程节点只支持容器级操作(up/restart/stop/ps),Compose/Env 编辑在远程节点返回 403——这是安全边界,不要移除。
  - 节点凭据(SSH 密码/私钥、TLS 证书)明文存 settings 表,前端返回掩码;目前是单用户面板,如需更强安全可评估加密落盘。
  - 指标不做重型图表库,`SparklineChart` 用原生 SVG path(20-30 点),保持轻量。
  - `git push origin main` 的 HTTPS 在沙箱握手失败,SSH 地址沙箱 DNS 解析失败,均需提升权限执行;commit 需 `sandbox_permissions=require_escalated`。
- **重要配置/环境变量**:
  - 后端:`PORT`(默认 3001)、`HOST`、`SERVE_FRONTEND=1`(静态托管前端 dist)、`ENABLE_SHELL=1`(开启容器 Web Shell)、`DB_PATH`、`COMPOSE_BIN`、`COMPOSEOPS_WORKSPACE_IDLE_MS/CACHE_MAX`、`DISABLE_BACKGROUND_JOBS=1`。
  - AI:`ai.base_url`、`ai.api_key`、`ai.model`(存 settings 表,数据库 `backend/data/opsdash.db`)。
  - 前端构建:`chunkSizeWarningLimit: 3000`、`manualChunks`(monaco-editor / xterm / vue-vendor)。
  - 无敏感 Key 在本文件中;API Key 等仅存运行库 settings,不入库 Git。

## 5. 新 AI 会话启动指南 (Prompt for Next Agent)
> 阅读 `PROJECT_CONTEXT.md`(本文档)与根目录 `AGENTS.md` 后,按以下要点开始工作:
> 1. 先 `git status` / `git log --oneline -5` 确认工作区与最近提交,不要臆造未提交改动。
> 2. 需要修改文件时,先定位既有服务层/路由/组件风格(可参照 `backend/src/services/project-env.js`、`frontend/src/components/services/ProjectEnvModal.vue`、`AIDiagnosisModal.vue`),保持中文文案、emerald 色系、z-index 阶梯与 `useEscapeKey` 用法。
> 3. 改动后端 `lib/dotenv.js` 或节点/SSH 相关逻辑时,同步检查前端对应 `src/lib/dotenv.js` 与单测。
> 4. 验证标准:前端 `npm run build` 零 Warning、`npx vitest run` 全绿;后端 `DB_PATH=/tmp/x.db node --test test/*.test.js` 全绿。
> 5. 提交时使用中文结构化 Message(标题 + `-` 分节),commit/push 需提升权限(沙箱 `.git` 只读)。
> 6. 完成任务后更新本文档的「上次更新时间 / Current Status / 下一步任务」三段,并把新改动摘要同步进 `AGENTS.md`(若有)。如需推送,明确询问或直接执行(沿用已批准 `["git","push"]`)。
