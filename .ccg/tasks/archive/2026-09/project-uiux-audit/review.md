# ComposeOps 项目审计

审计范围：`frontend/src`、`backend/src` 的页面、组件、Agent 会话链路、指标链路和关键 REST 接口。目标是发现用户可感知的 UI/UX、排版、功能逻辑和 Agent 聊天问题；本次不修改业务代码。

## 结论

项目功能面较完整，中文暗色工业风的基础组件、确认门、日志挂载、Compose 预览和多节点能力已经成形。当前最大问题不是功能数量，而是“数据源、接口模型、页面入口和视觉系统彼此不一致”。其中历史指标、Agent 执行历史和 Agent 诊断入口属于应优先修复的功能级问题；Compose 保存失败降级和测试节点产生持久化副作用属于操作安全问题。

## Critical / High

### H1. 历史指标页面展示模拟数据，且真实历史数据存在时间单位错位

- `frontend/src/views/ResourceMonitorView.vue:209-224` 用 `Math.random()` 生成 60 个趋势点，标题却是“历史指标”。`chartAnomalies` 在 `:226-229` 永远为空。
- 前端虽然有 `metricsApi.getHistoricalMetrics`（`frontend/src/api/client.js:357-374`），页面没有调用；后端也已经提供 `/metrics/historical` 和 `/metrics/anomalies`（`backend/src/routes/metrics.js:110-143`、`:183-226`）。
- 采集器在 `backend/src/services/metrics-collector.js:55` 写入毫秒时间戳，历史查询 schema 和统计逻辑在 `backend/src/routes/metrics.js:120-121`、`backend/src/services/metrics.js:267-275` 按秒查询，接通后仍可能查不到数据。
- 网络、磁盘的 `current` 是对象（`backend/src/services/agent-metrics.js:65-84`），但图表基线在 `:216-218` 直接参与数字运算，可能产生 `NaN`。

影响：用户看到的图和告警状态不可信，监控产品的核心承诺失效。应统一时间单位、改为真实历史序列、接入异常检测，并为网络/磁盘统一数值模型（速率或累计量只能选一种并明确单位）。

### H2. Compose 保存失败时可能绕过校验和变更预览

- `frontend/src/views/ComposeView.vue:561-579` 调用 `validateSemantics()` 后只检查 `semanticIssues`，没有区分“无问题”和“校验请求失败”。校验接口失败时可能继续进入保存流程。
- 同段 `:571-578` 在 `previewCompose` 失败后清空预览并直接 `confirmSave()`，等于在无法确认影响范围时照常保存。
- 可视化模式的删除服务在 `:729-733` 立即改写本地 YAML，没有撤销；删除虽尚未落盘，但用户只能依赖保存前预览发现影响。

影响：网络波动或后端校验异常时，可能绕过用户本应看到的风险提示。建议失败即阻断，提供“重试”和明确的“仍要保存”二次确认；预览不可用时不能静默降级为保存。

### H3. Agent 执行历史前后端数据模型不匹配

- 前端 `frontend/src/views/AgentExecutionHistoryView.vue:21-95` 将 `response.executions` 的每一项当作完整 plan，读取 `planId`、`message`、`steps`、`results`、`thoughts`。
- 后端 `backend/src/routes/agent.js:51-67` 无 `planId` 时返回 `{ plans, executions }`，其中 `executions` 是原始执行记录，字段形态是 `plan_id`、`tool_name` 等；完整 plan 在 `plans` 中。

影响：历史页会出现空标题、`undefined` 元数据，详情、结果和所谓“思维过程”无法可靠展示。应先定义一个稳定的审计 ViewModel，或前端分别渲染 `plans` 与 `executions`。产品文案也应把“思维过程”改成“执行轨迹/工具调用记录”，避免暗示暴露模型内部思维链。

### H4. 服务卡片的 AI 诊断入口断链

- `frontend/src/components/services/ServiceProjectCard.vue:90` 仍跳转到 `/ai?projectId=...&containerId=...&diagnose=1`。
- `frontend/src/router.js:10-12` 只把 `/ai` 重定向到 `/agent`；`frontend/src/views/AgentWorkflowView.vue:53-63` 没有读取这些 query，也没有自动打开诊断或挂载目标日志。

影响：用户点击“AI 诊断”后只得到普通新 Agent 页面，指定项目、容器和诊断意图丢失。应让 `/agent` 直接消费 query，创建初始上下文并自动打开诊断流程，或统一改用当前 Agent 的上下文 API。

### H5. 设置页“测试连接”实际会保存节点

- `frontend/src/views/SettingsView.vue:239-257` 的 `testHostConnection()` 调用 `saveTemporaryHost()`，而后者在 `:254-257` 调用持久化的 `api.saveHost()`。
- 对新节点而言，用户只点“测试连接”就会创建节点；对已有节点而言，测试未点击“保存节点”的编辑内容也可能先被写入。

影响：操作语义与实际副作用不一致，会产生孤儿节点或未确认配置。应增加只读 ping 接口，或让后端接受一次性连接配置而不写数据库。

## Warning

### W1. Agent 工作台和全局抽屉是两个独立会话

- `frontend/src/views/AgentWorkflowView.vue:63-77` 和 `frontend/src/components/AgentDrawer.vue:40-42` 各自调用 `useAgentChat()`。
- 抽屉长期挂载于 `frontend/src/App.vue:42、:59-62`，顶部入口可在任何页面打开（`frontend/src/components/AppHeader.vue:44`）。

用户容易认为这是同一个 Agent，却看不到另一侧的消息、日志挂载、来源、快捷指令和确认状态。应共享 session/store，把工作台和抽屉做成同一会话的两种容器视图，或明确区分“全局助手”和“工作台会话”。

### W2. 关闭 Agent 抽屉不会中断后台执行

`frontend/src/components/AgentDrawer.vue:47-51` 关闭时只调用 `closeAgent()`；`frontend/src/composables/useAgentConsole.js:99` 也只改变显示状态。执行和确认等待仍可能继续，最长等待由 `backend/src/services/agent/engine.js:406-424` 控制。用户关闭后既看不到后台状态，也不容易恢复确认。

应把“关闭视图”和“停止执行”分开提供，同时在后台执行时给出全局运行指示和重新打开入口；危险确认应显示目标项目、容器、动作、风险等级、影响范围和可回滚性。

### W3. Agent 历史默认截断但无提示和加载更多

后端 `backend/src/routes/ai.js:133-146` 默认最多返回 100 条、上限 200 条，前端 `frontend/src/api/client.js:201` 未传 limit，`frontend/src/views/AgentWorkflowView.vue:135` 直接覆盖消息列表。长会话会静默丢失上下文，用户无法判断历史是否完整。

建议使用分页/游标或“加载更早消息”，并在截断时显示明确提示。

### W4. Agent 页面上下文依赖 DOM 快照，性能和准确性都有风险

`frontend/src/composables/useAgentConsole.js:37-57` 从 `.app-main.innerText` 和全部表单字段构造上下文，` :77-83、:107-113` 通过 MutationObserver 监听整个页面子树。虽然有敏感字段过滤，但 DOM 文案不是稳定的业务数据契约，实时日志/监控页面也会频繁触发布局、截断和 JSON 序列化。

建议各页面提供结构化 context provider，仅传项目、节点、选中容器、状态和用户显式挂载的日志；DOM 快照只作为兜底。

### W5. 监控告警功能未接入异常检测，错误大量静默

`frontend/src/views/ResourceMonitorView.vue:263-321` 只加载指标和告警规则，没有调用已有 `metricsApi.detectAnomalies()`；加载项目、告警、创建和删除告警的错误多为空 `catch` 或只写 console。` :298` 还用 `!alertForm.threshold` 判定阈值，0 会被当作无效且没有范围/单位校验；网络和磁盘告警在 `:102` 统一显示 `B`，但后端返回的是累计字节而非速率。

用户无法区分“没有异常”和“请求失败”，也难以判断告警单位。应提供 loading/error/empty/retry 三态，接入异常检测，并明确累计量、速率和时间窗口。

### W6. 响应式布局通过隐藏信息解决空间问题

`frontend/src/views/AgentWorkflowView.vue:163` 在宽度小于 1180 时直接隐藏 inspector，移动端也没有抽屉或折叠入口；`frontend/src/views/ResourceMonitorView.vue:39` 固定四列指标卡，`:16` 固定项目/容器两列；告警弹窗 `:426-434` 没有内部滚动和移动端约束。GitOps 弹窗在 `frontend/src/views/GitOpsView.vue:112、:218` 使用较大的圆角和固定 `80vh` 桌面布局。

这会让中小屏用户丢失上下文、执行动态和长期记忆，而不是获得可替代的访问路径。应把 inspector 改成可打开的 bottom sheet/drawer，所有指标和筛选控件在窄屏改为单列或横向滚动，并统一弹层最大高度、内部滚动和底部操作区。

## UI/UX 与排版专项

1. 设计系统分裂：全局 `frontend/src/style.css:154-205` 的按钮、surface 和圆角 token，与 Resource Monitor 的局部覆盖（`frontend/src/views/ResourceMonitorView.vue:324-435`）以及 GitOps 的独立 CSS（`frontend/src/views/GitOpsView.vue:1-112`）不一致。全局主按钮偏蓝，监控页改成 emerald 渐变，GitOps 使用 sky；同一个运维动作在不同页面有不同视觉权重。
2. 运维控制台的 pill 和大圆角偏多：GitOps 大量 `rounded-full/rounded-3xl`，Marketplace 也将按钮、筛选、统计卡独立成圆角体系（`frontend/src/views/MarketplaceView.vue:567-673`）。这更像营销型应用，降低表格和高密度操作界面的扫描效率。
3. Marketplace 的创建、查看、部署、AI 发现弹窗是另一套 modal/button/input，未复用公共组件；模板卡片操作密集，窄屏容易出现按钮换行和视觉主次不清。
4. 市场页 `isDeployableTemplate()`（`frontend/src/views/MarketplaceView.vue:442-445`）只允许内置模板部署，社区和自定义模板只能查看/编辑/删除。若这是安全限制，应在卡片上明确“仅供参考/需先导入”；否则用户会把“模板市场”理解为所有模板可部署。
5. 文案和单位不够一致：如 Resource Monitor 标题“历史指标”配“实时”描述；Agent 历史使用“思维过程”；各页时间格式有 `toLocaleString()`、手工追加 `Z` 等多种方式。
6. 无障碍和交互发现性不足：指标卡是 `div @click`（`ResourceMonitorView.vue:40-42`），键盘不可操作；刷新告警按钮 `:88-90` 无 `aria-label/title`；图标按钮和普通关闭按钮语义不统一，未见统一 `:focus-visible` 策略，也未见 `prefers-reduced-motion` 处理。
7. 多处 `v-html` 产生维护和安全审计负担：Agent、日志和诊断渲染依赖 HTML（例如 `frontend/src/views/AgentWorkflowView.vue:33`、`frontend/src/components/logs/LogLine.vue:11`、`frontend/src/components/services/AIDiagnosisModal.vue:8`）。Agent Markdown 虽有清洗，但应把清洗边界、链接策略和日志高亮统一成单一组件，并清理 lint warning。

## 建议改造顺序

1. 先修 H1-H5：真实指标与单位、Compose 保存阻断、Agent 历史 ViewModel、诊断 query、只读节点测试。
2. 统一 Agent 状态模型：一个 session/store，消息、工具轨迹、确认门、错误重试、停止执行和日志挂载都共享；工作台与抽屉仅是不同布局。
3. 把所有异步页面补齐 loading/error/empty/retry，消灭静默 catch；对长历史采用分页/游标。
4. 抽取公共 Design Tokens、Button、Modal、Tabs、EmptyState、Risk/Status Badge，逐页移除局部硬编码颜色和圆角。
5. 做桌面 1440px、平板 1024px、移动 390px 的 Playwright 截图、键盘遍历和真实 SSE/确认门回归；重点检查滚动容器、弹窗底部操作区、Inspector 替代入口和长 Markdown 表格。

## 验证状态

- 前端 build：通过。
- 前端 Vitest：12 个文件、96 个测试通过。
- 后端测试：120 个测试通过；运行时需 `--test-concurrency=1`。
- 前端 lint：0 errors，54 warnings，主要是空 `catch`、未使用变量和 `v-html`。
- 未完成真实浏览器截图/Lighthouse：当前环境没有可用的 Chrome/Chromium，Playwright 报错为找不到 `/opt/google/chrome/chrome`。因此遮挡、实际滚动和真实 SSE 视觉行为仍需在有浏览器的环境补测。
- 外部双模型审查未产出可用报告：Antigravity 被 OAuth 阻塞，Claude wrapper 返回 status 1；本记录结论来自本地代码审计和现有测试。
