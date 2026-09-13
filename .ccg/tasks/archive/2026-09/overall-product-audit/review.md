# ComposeOps 整体产品审计报告

审计日期：2026-09-13

范围：前端路由与页面、全局布局与视觉体系、Agent 工作台/抽屉、会话管理、Docker/Compose 运维流程、GitOps、监控告警、实时连接和后端边界。

结论：项目已经具备完整的单用户 Docker Compose 运维闭环，Agent、纳管项目、批量操作、日志、终端、GitOps、监控和操作记录之间也有较好的基础连接。但当前更像“功能已经铺开、体验和边界还没有完全收敛”的运维工具。优先修复实时资源泄漏和后端边界问题，再统一导航与视觉系统，最后集中打磨 Agent 的信息层级和失败恢复，收益最高。

## 优先级总览

| 优先级 | 问题 | 影响 |
| --- | --- | --- |
| P0 | GitOps 参数进入 shell 字符串 | 可能造成命令注入、任意路径/命令执行 |
| P0 | 指标与告警接口不验证纳管项目归属 | 可绕过“只能操作纳管项目”的产品边界 |
| P1 | keep-alive 缓存实时页面 | 切页后 WebSocket、轮询、SSE 仍运行，造成重复刷新和资源泄漏 |
| P1 | GitOps“部署”文案与实际同步行为不一致 | 用户会误以为代码已经发布到服务 |
| P1 | 批量/流式操作的取消、失败、确认语义不完整 | 高风险操作难以预期和恢复 |
| P1 | Agent 工作台与抽屉共享执行状态但没有展示端生命周期 | 隐藏页面继续更新，用户难判断当前会话和执行归属 |
| P1 | 移动端导航及 Agent 三栏布局不适合高频使用 | 功能难发现，聊天有效高度不足 |
| P2 | 页面视觉体系、组件、排版基线不统一 | 产品像多个原型拼接，降低信任和扫描效率 |
| P2 | 错误状态、重试入口、危险操作确认不统一 | 请求失败时容易被误解为空数据或操作未生效 |
| P2 | Agent 工具轨迹和确认信息密度偏高 | 长会话难读，执行风险信息不够结构化 |
| P3 | 会话批量删除已有但发现性和恢复体验仍可提高 | 能完成操作，但不够像成熟的 iOS 式列表管理 |

## P0：先修复安全与边界

### 1. GitOps 使用字符串拼接执行 shell 命令

证据：[gitops.js](/home/sgy/workspace/ComposeOps/backend/src/services/gitops.js:157)、[gitops.js](/home/sgy/workspace/ComposeOps/backend/src/services/gitops.js:165)、[gitops.js](/home/sgy/workspace/ComposeOps/backend/src/services/gitops.js:168)、[gitops.js](/home/sgy/workspace/ComposeOps/backend/src/services/gitops.js:210)、[gitops.js](/home/sgy/workspace/ComposeOps/backend/src/services/gitops.js:241)。`url`、`branch`、`localPath`、`commitHash` 和 `sshKey` 被插入反引号命令。单用户管理员部署不能消除这个风险，因为配置来源、Webhook 或被盗管理员会话仍可能进入这些字段。

建议：使用 `spawnFile`/`execFile` 参数数组；`branch` 只允许明确的 Git ref 字符集，commit 只允许完整或短 SHA；`localPath` 限制在专用 GitOps 根目录并做 `realpath` 校验；SSH key 通过环境变量传递但不要拼进命令字符串；关闭 `StrictHostKeyChecking=no`，改为可配置的 known_hosts。同步、回滚都应记录实际 commit 和操作者。

### 2. 指标和告警接口绕过纳管项目边界

证据：[metrics.js](/home/sgy/workspace/ComposeOps/backend/src/routes/metrics.js:16)、[metrics.js](/home/sgy/workspace/ComposeOps/backend/src/routes/metrics.js:45)、[agent-metrics.js](/home/sgy/workspace/ComposeOps/backend/src/services/agent-metrics.js:17)、[agent-metrics.js](/home/sgy/workspace/ComposeOps/backend/src/services/agent-metrics.js:169)。接口直接接受任意容器 ID/名称并调用 Docker；前端虽只展示纳管项目，但 API 本身没有强制同一边界。历史指标、统计、异常检测和告警配置也应覆盖同样规则。

建议：抽出统一的 `resolveManagedContainer(containerIdOrName, activeHost)`，在每个指标路由入口解析项目归属、节点归属和容器状态；未纳管、非当前节点或不存在的对象统一返回 403/404。告警规则保存归属的 `projectId`、`hostId` 和稳定容器 ID，避免容器重建或重名后指向错误目标。补充越权集成测试。

## P1：修复实时行为与高风险操作体验

### 3. keep-alive 缓存了仍有实时连接的页面

证据：[App.vue](/home/sgy/workspace/ComposeOps/frontend/src/App.vue:53)。`ServicesView` 在[ServicesView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/ServicesView.vue:232)建立 WebSocket、降级轮询和任务轮询；`OperationsView` 在[OperationsView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/OperationsView.vue:195)使用后台任务 SSE。它们主要依赖 `onUnmounted` 清理，而 keep-alive 切页不会卸载。`CronTasksView` 也应按同一规则复查。

用户影响：切换页面后后台仍在拉取数据，返回时可能出现重复订阅、旧数据覆盖新数据、任务输出持续积累和不必要的 CPU/网络消耗。

建议：短期将所有持有 WebSocket、SSE、interval 或长轮询的页面移出 keep-alive；或使用 `onActivated/onDeactivated` 成对启动和清理，并为每次连接增加唯一 token，防止旧回调写入新状态。为页面切换、浏览器后台、节点切换分别写生命周期测试。

### 4. 批量操作确认按风险分支不一致

证据：[ServicesView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/ServicesView.vue:178)。批量 `stop/restart` 有确认，但 `up/pull` 没有同等确认。`up` 可能重建容器，`pull` 会产生网络访问、镜像变更和后续版本漂移；对用户而言它们同样不是无副作用操作。

建议：按风险统一确认：读取类不确认，镜像拉取/重建/停止/重启/删除必须确认。确认内容显示项目数、服务数、当前节点、是否会中断服务、是否可回滚。高风险按钮带动作名，例如“拉取镜像并更新 6 个项目”，不要只写“确认”。

### 5. 流式 Compose 操作缺少前端取消控制器

证据：[client.js](/home/sgy/workspace/ComposeOps/frontend/src/api/client.js:252)、[ServicesView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/ServicesView.vue:114)。`streamComposeControl` 没有接收 `AbortSignal`，页面离开时无法明确中断请求，只能依赖后端察觉连接关闭。用户也无法知道“离开页面后任务继续”还是“离开即取消”。

建议：API 统一接收 `signal` 和超时；页面销毁/停用时 abort；界面明确提供“取消本次操作”与“转入后台任务”两个语义。取消后后端子进程、任务状态和操作记录要有明确的 `interrupted` 结果，不能只表现为普通失败。

### 6. 操作中心失败时可能显示为空表格

证据：[OperationsView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/OperationsView.vue:164)。`load()` 请求失败后只进入 `finally`，没有错误状态、错误文案或重试按钮。网络错误、后端异常和确实没有记录在 UI 上不可区分。

建议：增加 `error` 状态、带原因的错误空状态和“重试”按钮；保留上一次成功数据并标记“数据更新时间”，不要在刷新失败时直接呈现空列表。

### 7. GitOps 当前是同步仓库，不是部署服务

证据：[GitOpsView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/GitOpsView.vue:7)、[gitops.js](/home/sgy/workspace/ComposeOps/backend/src/services/gitops.js:162)、[gitops.js](/home/sgy/workspace/ComposeOps/backend/src/services/gitops.js:177)。后端流程是 clone/fetch/reset 并记录 commit，没有看到同步后调用 Compose 部署。页面文案“基于提交部署服务”因此会产生错误预期。

建议：二选一并在产品上说清楚：若只做仓库同步，改为“同步仓库”；若要做部署，增加显式的同步后预览、变更 diff、确认门、执行输出、健康检查、失败回滚和部署记录。Webhook 默认只触发同步或生成待确认任务，不应隐式重建生产服务。

### 8. Agent 工作台和抽屉的共享回调没有展示端生命周期

证据：[useAgentChat.js](/home/sgy/workspace/ComposeOps/frontend/src/composables/useAgentChat.js:22)、[useAgentChat.js](/home/sgy/workspace/ComposeOps/frontend/src/composables/useAgentChat.js:226)、[AgentWorkflowView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/AgentWorkflowView.vue:73)、[AgentDrawer.vue](/home/sgy/workspace/ComposeOps/frontend/src/components/AgentDrawer.vue:42)。两处共用会话和执行状态，但工作台缓存后仍可能保留 subscriber；抽屉执行时隐藏页面也会更新 activity。用户从抽屉切回工作台时，还可能面对与当前显示端不一致的滚动或上下文状态。

建议：把 Agent 执行状态与展示状态分层：执行只存在一个共享 store，展示端通过 `activeSurface` 或订阅计数决定是否更新 UI；工作台用 `onActivated/onDeactivated` 注册/注销视图订阅。头部明确显示“工作台/抽屉正在查看同一会话”，切换展示端时保持消息、确认门和活动时间线一致。

## P1/P2：移动端和 Agent 体验

### 9. 移动端导航发现成本高

证据：[AppSidebar.vue](/home/sgy/workspace/ComposeOps/frontend/src/components/AppSidebar.vue:28)。当前运行、排障、扩展、系统共约 16 个入口，移动端全部压缩成横向底部 Tab。用户必须横向滑动才能发现后面的功能，也缺少“当前工作流”的层级感。

建议：移动端底部只保留“概览、项目、日志、Agent、更多”五项；其余放入“更多”抽屉，保留分组和搜索。桌面侧栏可展开分组，但默认突出当前节点、当前项目和待处理任务。导航数量不应成为用户记忆产品结构的负担。

### 10. Agent 移动端把会话列表堆到聊天上方

证据：[AgentWorkflowView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/AgentWorkflowView.vue:185)。三栏在小屏纵向堆叠，会话列表先占据高度，聊天区和输入区变得很短；同时会话列表、上下文、执行动态的层级在移动端不再适合连续对话。

建议：移动端默认只展示聊天；会话列表通过顶部按钮打开抽屉或 bottom sheet，上下文和执行动态折叠到“详情”。输入框应使用固定底部 composer，适配键盘和安全区域，消息区只保留必要的滚动空间。

### 11. Agent 的工具轨迹、确认门和失败恢复还不够结构化

当前界面已经有工具 chip、执行动态和确认卡，这是正确方向，但长回复中工具轨迹横向堆叠，用户需要在正文、右侧动态和确认卡之间来回找状态。确认卡只突出“确认执行”，没有统一展示目标项目、容器、影响范围、可逆性和预计停机时间。

建议：每条工具调用默认折叠，显示“正在读取 / 等待确认 / 执行中 / 已完成 / 失败 / 已中断”之一；展开后展示参数、耗时和输出。确认按钮使用具体动作名，失败后提供“重试、复制错误、打开日志、发送到诊断”。长会话可按工具轨迹折叠，必要时再考虑虚拟化。

### 12. 会话批量删除已经实现，但还可以更像成熟列表管理

证据：[AgentWorkflowView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/AgentWorkflowView.vue:15)、[AgentWorkflowView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/AgentWorkflowView.vue:33)、[AgentWorkflowView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/AgentWorkflowView.vue:158)。目前支持全选当前筛选列表、批量删除确认和 `clearAiSessions` 调用，因此“只能一个一个删除”已经不是当前代码状态。

仍建议优化：移动端提供进入“编辑/选择模式”的入口，选中后使用固定底部操作栏；显示选中数量和筛选范围；正在执行时明确禁用并解释原因；批量接口返回逐项结果，部分失败时保留未删除项并支持重试；删除后提供短暂撤销或至少显示删除范围。会话列表还可增加置顶、按项目过滤、最后活动时间、未读/执行中标识。

## P2：视觉、排版和组件一致性

### 13. 多个页面仍是旧视觉体系

重点证据：[GitOpsView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/GitOpsView.vue:1)、[MarketplaceView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/MarketplaceView.vue:1)、[ResourceMonitorView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/ResourceMonitorView.vue:369)、[CostAnalysisView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/CostAnalysisView.vue:337)。这些页面大量使用 `rounded-full`、`rounded-3xl`、自定义 slate/zinc 颜色、独立 modal/按钮样式和手写 SVG；成本页面还使用 emoji 图标。它们与项目既有的暗色工业运维基线、紧凑卡片和 lucide 图标不一致。

建议先建立并强制使用一组 token：背景层级、边框、文本层级、状态色、间距、圆角、阴影、控件高度和焦点环。页面统一使用 `page-title/page-subtitle/page-actions/card/btn/input/EmptyState/ConfirmDialog` 等已有基础组件，保留最多 2-3 个圆角等级。页面 section 使用无框布局，卡片只用于重复条目、表单和确实需要框定的工具。

### 14. 排版尺度与页面密度不统一

证据：[CostAnalysisView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/CostAnalysisView.vue:363) 使用 `clamp()` 让标题字号随视口变化，和其他运维页面的固定排版基线不同；不同页面的标题、表格、筛选器和卡片间距也不一致。

建议：标题字号保持固定阶梯，移动端通过换行、布局和间距解决，而不是按视口缩放字体；统一页面头部高度、控件最小高度、表头/正文行高和数字字体；金额、资源量、时间等数字右对齐并统一小数位。这样更利于值班场景快速扫描。

### 15. 原生 confirm/alert 和散落 v-html 破坏交互一致性

原生弹窗证据：[GitOpsView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/GitOpsView.vue:388)、[GitOpsView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/GitOpsView.vue:431)、[CronTasksView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/CronTasksView.vue:200)、[AgentWorkflowView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/AgentWorkflowView.vue:174)。`v-html` 主要出现在[AgentWorkflowView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/AgentWorkflowView.vue:26)、[AgentDrawer.vue](/home/sgy/workspace/ComposeOps/frontend/src/components/AgentDrawer.vue:14)、[LogLine.vue](/home/sgy/workspace/ComposeOps/frontend/src/components/logs/LogLine.vue:11)和[AIDiagnosisModal.vue](/home/sgy/workspace/ComposeOps/frontend/src/components/services/AIDiagnosisModal.vue:8)。虽然已有 Markdown 净化逻辑，但散落渲染会让安全策略、链接协议、SVG/HTML 处理和 lint 告警难以维护。

建议所有危险操作统一 `ConfirmDialog`，支持具体影响、busy、焦点回收、Esc 和键盘确认；集中封装 `SafeMarkdown`/`SafeHtml` 渲染组件，统一净化和链接策略，并增加 XSS、协议残片、代码块和表格的测试。

### 16. 节点切换后的历史监控上下文不够明确

`HostSwitcher` 会广播 `composeops:host-changed`，服务页和实时监控会刷新；[ResourceMonitorView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/ResourceMonitorView.vue:124)至[ResourceMonitorView.vue](/home/sgy/workspace/ComposeOps/frontend/src/views/ResourceMonitorView.vue:361)未见同等明确的节点切换刷新处理。切换节点后继续查看旧容器的历史数据，容易造成误判。

建议：监控页面显示当前节点名称和数据时间窗；收到节点切换事件后清空项目/容器选择、停止旧请求并刷新；若历史数据跨节点保留，查询条件必须显式带 `hostId`，图表不得混合不同宿主机数据。

## 建议的实施顺序

1. 修复 GitOps 的参数化进程调用、路径/ref 校验和审计记录；为指标/告警/历史数据统一增加纳管项目与节点归属校验。
2. 清理实时页面 keep-alive，补齐 AbortController、SSE/WebSocket 关闭、节点切换和页面停用测试。
3. 统一所有危险操作确认、操作中心错误状态和批量任务的取消/部分失败结果。
4. 重做移动端信息架构：五项底部导航、Agent 会话抽屉、固定 composer、上下文 bottom sheet。
5. 建立视觉 token 和基础组件迁移清单，优先处理 GitOps、市场、监控和成本页面。
6. 深化 Agent：折叠工具轨迹、结构化确认门、失败恢复、会话筛选/置顶/批量选择模式。

## 验证记录与剩余风险

已通过：

- `cd frontend && npm run build`
- `cd frontend && npx vitest run`：12 个测试文件，96 项通过
- `cd backend && DB_PATH=/tmp/composeops-audit.db npm test`：122 项通过
- `cd backend && npm run lint`：0 error，33 个既有 warning
- `cd frontend && npm run lint`：0 error，51 个 warning

尚未覆盖：Playwright 截图与真实交互、GitOps 参数注入专项测试、指标越权集成测试、keep-alive 切页后的 WebSocket/SSE 生命周期测试。上述测试缺口不改变静态审计结论，但在修复 P0/P1 前应补齐。

外部审查：按项目流程尝试并行调用 Antigravity 与 Claude；Antigravity OAuth 超时，Claude wrapper 返回 status 1，均未提供报告。本报告结论来自本地代码、静态分析和上述测试结果。
