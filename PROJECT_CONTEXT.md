# 📌 ComposeOps - PROJECT_CONTEXT.md
> **上次更新时间**:2026-08-31 20:05 (Asia/Shanghai)
> **当前版本/阶段**:v0.8 - AI 排障 3 步闭环(日志上下文联动 / 容器只读探针 / 联网检索 Grounding)已交付

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
  - 四大高级运维功能(commit `a182fac`):镜像更新雷达(`backend/src/services/image-updater.js` Registry Digest 对比 + 1h TTL 缓存,`GET /projects/:id/updates` + `POST /updates/check-all`;平滑升级自动备份 compose/.env → pull → up -d → 15s 健康轮询 + 一键回滚;前端 `ProjectUpgradeModal` + 卡片 Update Available 徽章);Docker 磁盘可视化清理 Hub(`backend/src/services/docker-storage.js` `docker system df` 解析,`GET /ops/storage/df` + `POST /ops/storage/prune` safe/volumes/builder/all 深度清理需 PRUNE 确认;前端 `StoragePruneModal` 分段进度条 + Settings 维护 Tab 磁盘占用条);应用模板市场(`backend/src/data/blueprints.json` 17 个内置模板,`backend/src/services/app-blueprints.js` 渲染 Compose/Env + 部署直达 `/projects/<name>` 或 workspace 回退,`GET/POST /ops/blueprints` SSE 任务流;前端 `BlueprintsView` + `BlueprintDeployModal` 表单/预览,侧边栏「应用市场」+ Cmd+K `App Store:` 指令);多渠道宕机告警(`backend/src/services/health-alerter.js` 60s 巡检 exit/OOM/unhealthy/crashloop + 10min/容器防抖 + 8 行尾日志,Telegram/Bark/企微/邮件/Webhook,事件配置 `/ops/notifications/events` GET/PUT;前端 Settings 通知 Tab 触发事件勾选)。
  - 五大极致体验功能(commit `4611c7a`)
  - **AI 排障 3 步闭环(本次)**:① Log-Context Inspector(`AiView.vue` 右侧日志抽屉,等级过滤/关键字检索/复选框多选/一键全选异常行,选中的日志行注入 Prompt 并显示「已挂载 N 条异常日志堆栈」);② 容器只读探针(`POST /api/v1/ai/exec`,白名单只读命令 env/ps/netstat/curl/cat/tail/ls/df/free 等,非 TTY 一次性 exec,返回 stdout/exitCode/durationMs,输出截断 20KB;AI 回复中的 ```bash 代码块自动抽取为可执行卡片,结果回显并自动追加一轮 AI 分析);③ 联网检索 Grounding(`searchWeb` DuckDuckGo Instant Answer + HTML 回退,零 Key 8s 超时,`/chat` 与 `/diagnose` 支持 `webSearch`,done 后发送 `sources` 帧,前端渲染来源引用徽章)。另修复 `/ai/diagnose` 的 TDZ 顺序 bug(webSearch 分支引用未声明 logs),新增 `POST /api/v1/ai/logs`(复用 `readContainerLogs` demux 读取逻辑)供日志检查器拉取上下文。
  - 五大极致体验功能(commit `4611c7a`):WebUI 智能雷达(`backend/src/services/project-ports.js` 纯函数过滤数据端口 + 典型 Web 端口排序,`GET /api/v1/projects/:id/webui` 生成直达链接,前端 `WebUiLauncher.vue` 胶囊/多端口下拉);多容器聚合日志(`/ws/aggregated-logs` 按行分流打标,`LogLine.vue` 容器色泡/级别标记/JSON 折叠/错误高亮,`LogsView.vue` 容器多选、级别/正则过滤、向上滚暂停自动滚动胶囊);数据库一键 Dump(`backend/src/services/db-dumper.js` 自动探测 Postgres/MySQL/MariaDB/Redis/Mongo,从 `.env` 提取凭据,dockerode exec 流式 gzip 直下 + 本地留存 `data/backups/db/`,`DbDumpModal.vue`);可视化 Cron 调度器(自研轻量 5 段 cron 解析器 `cron-scheduler.js`,JSON 持久化 `data/cron-jobs.json`,预设备份/清理/镜像检查模板,失败走通知渠道告警,`CronTasksView.vue` 任务列表+历史+可视化周期选择);全局 Vim 键盘流(`useKeyboardNavigation.js`:j/k 移动、o/Enter 展开、l/e/c/r/w 动作,输入框/编辑器聚焦自动禁用;App.vue 全局监听 `?` 弹出 `CheatSheetModal.vue`)。
  - 视觉质感与性能专项(commit `66f0e9e`,本轮):SWR 秒开缓存(`frontend/src/api/client.js` 内存 SWR,GET 12s TTL 即时返回 + 后台 revalidate,写请求自动失效 `/projects /hosts /personal/ /ops/ /cron`,导出 `invalidateSwr`;`services`/`hosts` store 已有数据静默刷新不白屏);Shimmer 骨架屏(`Skeleton.vue` 新增 `cards`/`table` variant,`.skeleton-card` 边框内微光流动,ServicesView/MonitorView 首载占位防 CLS);大日志虚拟滚动(`LogsView.vue` 固定 24px 行高 + 30 行 overscan 窗口渲染,总行数撑滚动高度,`@scroll` 同步窗口,自动滚底/暂停恢复逻辑保持);视觉与微交互升阶(`style.css`:`.card`/`.modal`/`.drawer`/`.command-dialog`/`.event-panel`/`.host-dropdown` 加 `backdrop-blur` 与内嵌高光 `inset 0 1px 0 rgba(255,255,255,.05)`,`.btn`/`.icon-btn`/`.metric-tile` 加 `active:scale` 按压反馈,`.data-table td`/`.count-badge` 用 `font-mono tabular-nums`,`.modal` 改 `backdrop-blur-[2px]`)。
  - 新增路由:`/cron`(定时任务页,侧边栏「扩展」组);新增 API:`/api/v1/cron`(CRUD + run + history)、`/api/v1/projects/:id/webui`、`/api/v1/projects/:id/db-dump`(GET 列容器 / POST 流式下载)、`/ws/aggregated-logs`(多容器聚合日志流)。
  - UI 视觉质感升阶专项(commit 待定,本轮):全站去系统 Emoji,新增 `frontend/src/lib/blueprintIcons.js` 将 17 个应用模板 Emoji 映射为 Lucide 矢量图标(`blueprints.json` icon 字段同步改为 lucide 名称);Header 精简 Logo 与状态胶囊(`status-pill` 极暗微透质感 + `.status-ping` 2px 柔和呼吸光晕,HostSwitcher 同步);空状态重塑(AiView 无对话时居中 AI 引导面板 + 3 个预设胶囊 + `ai-composer` 悬浮底栏快捷键提示;ShellView 未连接时 macOS 三色点终端占位;CronTasksView 推荐预设卡片一键预填);监控指标卡(`StatCard` 内嵌 20 点 Sparkline 趋势与色调点)与容器表格灰度进度条/等宽数字;OperationsView 审计列表改为低干扰状态胶囊(`ops-status-ok/fail`)与项目/操作微高亮标签;统一 `.card`/`.panel-card`/`.table-wrap` 内嵌高光 `inset 0 1px 0 rgba(255,255,255,0.06)`、边框收敛 `surface-800/80`。
- **开发中/刚刚完成的部分 (Recent)**:
  - 本轮(AI 排障 3 步闭环)已实现并验证:`AiView.vue` 全面重写(日志上下文检查器 + 只读探针卡片 + 联网检索开关/引用徽章),后端新增 `POST /api/v1/ai/exec`(只读命令白名单)与 `POST /api/v1/ai/logs`(复用 demux 日志读取),`/chat` 与 `/diagnose` 支持 `webSearch`(searchWeb 零 Key DuckDuckGo),并修复 `/ai/diagnose` 的 TDZ 顺序 bug。
  - 验证结果:`npx vitest run` 21/21 全绿;`npm run build` 零 Warning;后端 `node --test` 42/42 全绿。
  - 最近提交:`4611c7a`(五大功能)、`66f0e9e`(UI/UX 与性能专项)、UI 视觉升阶 `style:` commit、`f242243`(df 容错 + AI 模型列表)、`9f69ed6`(日志页卡死修复);本轮 AI 排障工作流 commit 即将提交。

## 3. 下一步任务清单 (Next Action Items)
- [ ] **紧急/首要任务**:在容器/真机实测 AI 排障 3 步闭环:① `/ai` 页选项目/容器后日志检查器能拉取上下文并勾选注入;② 开启「联网检索」后提问,回复底部出现来源引用徽章;③ AI 回复含 ```bash 只读命令时出现「在容器中执行」卡片,点击回显 Exit Code/耗时并可追问。同时回归既有 UI/UX 专项:页面切换 0ms 秒开、5000+ 行日志滚动流畅、弹层模糊与按压反馈。
- [ ] **后续规划**:
  - [ ] 远程节点下 Compose 配置编辑/环境变量目前被 403 guard 拦截,可规划经 SSH 通道的远程文件读写。
  - [ ] 镜像更新检测缓存过期可加后台定时任务自动刷新;升级回滚支持多版本快照列表。
  - [ ] 蓝图模板支持自定义 Git 源/私有镜像;部署前端口冲突自动检测提示。
  - [ ] 告警防抖改为基于状态变化的事件触发(而非纯轮询),并支持通知渠道分组(如 OOM 只发紧急渠道)。
  - [ ] 日志虚拟滚动可进一步做:行内容超长时按需截断渲染、JSON 折叠行高估算优化(当前估高 24px 与 JSON 展开有轻微偏差)。

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
  - 镜像更新检测:优先走 Docker Registry API 比对 Digest,不 `docker pull` 探活(避免动本地镜像);结果 1h TTL 缓存防 Registry Rate Limit;升级前备份 `docker-compose.yml` + `.env`。
  - 磁盘清理:`safe` 只清理悬空镜像/退出容器/未用构建缓存;`volumes/all` 深度清理需 `PRUNE` 二次确认,孤儿卷清理有红字风险提示。
  - 蓝图部署目录固定 `/projects/<name>`(容器内可达),直写失败自动回退 workspace 容器模式;部署同样走 SSE 任务流。
  - 告警巡检 60s 轮询 + 单容器 10min 防抖;`health-alerter` 由 `index.js` 启停,`ops.js` 提供事件配置读写(`/ops/notifications/events`)。
  - 定时任务:未引入 `cron-parser` 依赖(网络受限),自研轻量 5 段 cron 解析(`parseField` 支持 `*`/范围/步进),数据 JSON 持久化于 `backend/data/cron-jobs.json`(已加入 .gitignore)。
  - DB Dump:通过 dockerode exec 在容器内执行 `pg_dump/mysqldump/mongodump/redis-cli`,凭据优先自动从 `.env` 提取;输出经 docker log demux + gzip 分流到浏览器响应与本地 `data/backups/db/`(已 gitignore)。
  - 聚合日志:WS 端点按行打标(containerName/type/ts),前端 `LogLine` 用稳定哈希给容器分配色板;`@wheel` 向上滚动暂停自动滚动(带胶囊恢复)。
  - 键盘流:`useKeyboardNavigation` 仅服务页启用方向键,输入框/编辑器聚焦自动短路;`?` 由 `App.vue` 全局监听并弹 CheatSheet,`useEscapeKey` 以 `command` 层关闭。
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
