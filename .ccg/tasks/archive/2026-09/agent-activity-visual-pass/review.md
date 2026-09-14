# Review — Agent SVG 渲染与执行动态视觉升级

## 变更范围
- `frontend/src/style.css` (+72/-10)
- `frontend/src/views/AgentWorkflowView.vue` (+33/-10)

## 双模型审查
- antigravity: 失败(Gemini 区域不可用,账户不支持 Code Assist)
- claude (codeagent-wrapper): 进程退出 status 1(网络/OAuth 不稳定)
- **降级为自审**,记录如下

## 自审发现 + 处置

### Critical: 无

### Warning (已修复)
1. **trace 事件与 tool_* 事件双发** — `engine.js` 中 `publishTrace('tool_executing',...)` 和 `onEvent({type:'tool_executing'})` 同时触发,会导致同一工具步骤在时间轴出现两次。**修复**: onEventExtra 中 trace 分支跳过 tool_* phase,只保留 loop_started/loop_iteration/loop_completed/interrupted。
2. **prev.status 副作用语义** — 原逻辑 `prev.status === 'running' && item.status !== 'running' → prev.status='done'` 会把任何非 running 事件到达时的 running 步骤都标 done,即使事件本身是 failed。**修复**: `prev.status = item.status`,让 prev 跟随当前事件的真实状态,语义更准确(失败会传染到对应 running 步骤,这是正确的)。

### Info
1. SVG 去除 `min-width: 680px` 后,小图标类 SVG 不会再被强制撑大 — 气泡内不再横向溢出;超宽复杂图表仍可通过 `.rich-block { overflow-x: auto }` 横向滚动 + 点击放大浮层查看完整尺寸。
2. `.rich-zoom-card` 改 `display: grid; place-items: center` — SVG 在放大浮层里水平+垂直居中,视觉更接近 Claude/豆包的放大预览。
3. 时间轴最后一项通过 `:last-child::before { display: none }` 隐藏竖线,选择器稳健(不依赖类名)。
4. 新增 `clearActivity()` 提供清空按钮,满足"想从头看一遍"的场景。
5. activity 数组上限 200 条,避免长时间运行后内存膨胀。
6. 状态色: running=cyan + pulse 动画、done=emerald、failed=rose、rejected=amber — 与全站 emerald 状态色 + cyan 品牌色一致。

## 验证
- `npm run lint`: 0 errors (40 warnings 全是历史遗留)
- `npx vitest run`: 96/96 通过
- `npm run build`: 零 Warning,10.27s 完成
- `cd backend && DB_PATH=/tmp/ccg-activity.db npm test`: 122/122 通过

## 结论
可以合并推送。视觉层面: SVG 现在能在气泡里正确自适应,放大浮层有现代居中布局;执行动态从无结构的纯文本堆叠升级为带时间戳/状态点/耗时 chip 的时间轴,接近主流 AI Agent 产品的信息层级。
