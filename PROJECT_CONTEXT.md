# 📌 ComposeOps - PROJECT_CONTEXT.md
> **上次更新时间**:2026-09-12 (Asia/Shanghai)
> **当前版本/阶段**:v1.1 - AI Agent 单页化与数据保护(Tool Loop 单通道 / 数据卷备份 / GitOps webhook / 市场AI找应用 / 流式与视觉打磨)已交付

## 1. 核心概述 (Executive Summary)
- **项目目标**:单用户 Docker Compose 运维控制台(工作区名 `ComposeOps`,镜像/容器沿用旧名 `OpsDash`)。通过 Docker Socket 自动发现带 `com.docker.compose.project` 标签的 Compose 项目,以"先发现、后显式纳管"的权限模型提供服务启停、Compose 配置编辑、环境变量文件族管理、实时日志、容器终端、数据卷备份、GitOps 同步、应用市场、定时任务、多 Docker 节点纳管、资源监控与 AI 运维 Agent 能力。
- **技术栈**:前端 Vue 3 + Vite 5 + Pinia + Vue Router(hash)+ Tailwind + lucide-vue-next + Monaco + xterm + marked/DOMPurify;后端 Fastify 4 + @fastify/websocket + better-sqlite3 + dockerode(+docker-modem 原生 SSH)+ ssh2 + tar-stream + yaml;测试 Vitest 3(前端)/ node --test(后端,必须 `--test-concurrency=1`)。
- **核心架构约定**:REST 前缀 `/api/v1`(路由按域拆分 `backend/src/routes/`);SSE 用于 Compose 操作、env 应用、Agent 执行流与指标;WebSocket(`/ws/logs`、`/ws/exec`、`/ws/jobs`、`/ws/aggregated-logs`、`/ws/events`);前端 `views / components / stores / composables / lib / api`;弹层 `useEscapeKey` 栈 + z-index 阶梯(modal > drawer > event > command);路由层 keep-alive 白名单(流式/轮询页排除)+ 空闲 chunk 预取 + page-fade 过渡。
- **AI 架构**:单页 Agent(`/agent`,原 `/ai` 已 301)。执行通道唯一:`POST /ai/agent/execute-stream`(Tool Loop,SSE)+ `/ai/agent/approve` 确认门;`/ai/diagnose` 保留给日志页诊断弹窗;`/ai/chat`、`/ai/exec` 已删除。协议剥离只在 `ai.js` 发射层(全量有状态 + 前缀持回),前端 token 原样追加(120ms 节流);聊天逻辑共享于 `useAgentChat.js`(滚动跟随/atBottom、工具轨迹、富内容放大浮层);富渲染 `agent-markdown.js`(marked + DOMPurify 白名单,svg/table 富内容代码块启发式渲染 + 源码折叠 + 放大包裹)。
- **字节一致副本**:`backend/src/lib/dotenv.js` ⇄ `frontend/src/lib/dotenv.js`;`backend/src/lib/agent-protocol-core.js` ⇄ `frontend/src/lib/agent-protocol-core.js`(两侧 sync 测试兜底)。

## 2. 当前状态快照 (Current Status)
- **已交付的完整能力面**(细节见 README.md 与 CHANGELOG.md):
  - 项目纳管/挂载模型、多宿主(Local/TCP/SSH)、Compose 多文件编辑(Monaco + 语义校验 + 变更预览 + 20 份备份/回滚)、env 文件族(`GET /projects/:id/env/files`,`*.env`/`.env.example`)。
  - AI 运维 Agent:47 工具注册表(按域拆 `services/tools/`)、四档权限门、动态风险、确认门(10 分钟兜底)、审计落库、日志挂载(`attachedLogs` 不可信定界块)、长期记忆、联网检索、富渲染与放大浮层、工具轨迹、页面 Agent 抽屉(`useAgentConsole` 关闭时不做页面快照)。
  - 数据保护:Compose 备份(20 份/diff/回滚)、**数据卷备份**(`services/volume-backup.js` helper 容器 tar,cron 类型 `volume-backup`,目录 `backup.volume_dir`,每卷 20 份)、数据库 Dump、保留策略(`pruneAiData`,setting `retention.ai_days` 默认 90 天,metrics-collector 每日触发)。
  - GitOps(轮询 + webhook `POST /gitops/webhook/:id`,token=`gitops.webhook_token`,app.js auth 豁免)、应用市场(蓝图 + 自定义模板 + AI 找应用 `POST /marketplace/templates/ai-discover`,只出草稿)、定时任务(5 段 cron 解析,JSON 持久化)、告警通知(Bark/Telegram/企微/邮件/Webhook)、操作审计、多渠道事件中心。
  - 基础设施:登录锁定(5 次/15 分钟)、Cookie SameSite=Strict、CSP(含 img-src https)、SWR 缓存、骨架屏、日志虚拟滚动、键盘导航(j/k + `?` 帮助)、Cmd+K 命令面板。
- **测试基线**:后端 119/119(`cd backend && DB_PATH=/tmp/x.db npm test`)、前端 94/94(`cd frontend && npx vitest run`)、`npm --prefix frontend run build` 零 Warning;CI(.github/workflows/ci.yml)= 双端 lint + test + build。

## 3. 已知取舍与候选改进 (Next Ideas)
- [x] 卷备份:远程宿主已支持 helper cat 流式下载;bind mount 仍不纳入。
- [ ] Agent 执行动态可进一步展示工具结果摘要(当前仅名称/耗时);日志挂载面板可记住上次选择。
- [x] 通知渠道分组:当前通知为单渠道模型(type 单选),分组的前提是多渠道并存——需先把通知升级为多渠道列表再做分组,暂缓。
- [ ] 告警防抖改状态变化触发。
- [ ] 远程节点 Compose/env 编辑经 SSH 通道(当前 403 guard)。
- [ ] 成本分析疑超前:已降权至系统组,观察使用率再定去留。
- [ ] 登录锁定为内存 Map(重启清零);数据库文件未加密(权限 0600)。

## 4. 关键操作备忘
- 后端单测必须串行:`DB_PATH=/tmp/x.db npm test`(package.json 已带 `--test-concurrency=1`),并发会多进程抢同一 DB 偶发失败。
- 前后端共享代码改动须同步两份副本并跑 sync 测试;`dotenv.js` 同理(无测试,人工对齐)。
- 真机冒烟模板:拷贝 `backend/data/opsdash.db` 副本 + scrypt 重置密码 → `ENABLE_SHELL=1 SERVE_FRONTEND=1 PORT=3101 DB_PATH=<副本> node src/index.js`。
