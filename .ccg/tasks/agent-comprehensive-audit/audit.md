# Agent 全方位审查(2026-09-14)

## 方法
逐层读源码,而不是只看界面:
- 后端事件出口 `backend/src/lib/agent-public-events.js` 是唯一把内部事件翻译成前端可见事件的关口。
- 前端数据流 `frontend/src/composables/useAgentChat.js` 决定消息对象最终形态。
- 渲染层 `AgentWorkflowView.vue` / `AgentDrawer.vue` / `AgentMarkdown.vue` / `style.css`。
- 对照 LLM 出口 `backend/src/services/ai.js` 与循环 `backend/src/services/agent/engine.js`。

## 发现的问题(按严重度)

### P0 — 功能声称存在但实际不生效

1. **工具卡片永远是空的。** 卡片模板读 `tool.params` / `tool.result`,但
   `trackTool()` 从不写入这两个字段,前端也永远收不到结果体(后端只透出
   `summary`/`durationMs`)。表现为:执行完的命令点开"参数与结果"什么都没有。
2. **"思考过程"折叠面板永远不显示。** `engine.js` 发了 `thinking` 事件,
   但 `toPublicAgentEvent()` 没有对应分支 → 直接 `return null` 被丢弃。
3. **"第 N 轮"永远渲染成"第  轮"。** 模板读 `event.traceRound`,后端从来没有
   这个字段;轮次信息在 `trace.metadata.loopCount` 里,而公开事件也没透出。
4. **Agent 抽屉的放大浮层永远是空白的。** `AgentDrawer.vue` 传的是
   `<AgentMarkdown :html="zoomContent">`,而组件只声明了 `content` prop,
   且把它当 Markdown 源再渲染一次(内容是已渲染的 HTML)。工作台用的是
   正确的 `v-html`,抽屉这条路径是坏的。
5. **"消息队列"和"发送"按钮互斥。** `useAgentChat` 已实现队列,但两个界面的
   发送按钮都带 `:disabled="running"`,执行中根本点不了 → 队列是死代码。
6. **"编辑用户消息"实际上不能编辑。** 点击铅笔立刻把原文重发,没有可编辑的
   中间态;用户没有任何机会修改内容。

### P1 — 设计完整性缺口

7. **点赞/点踩能力闲置。** 后端已有 `recordAgentFeedback()` 与
   `agent_plans.rating` 列,但没有任何路由或 UI 调用它;`done` 事件也不带
   `planId`,前端无从知道该写回哪条记录。
8. **中断后无法继续。** 中断只把文案追加到消息里,长任务误触中断后只能重跑。
9. **会话切换的状态清理是复制粘贴的。** `newSession` 与 `openSession` 各写一遍
   清理(漏了编辑态、搜索词、录音),新增状态字段时极易漏。
10. **触摸设备上操作栏不可达。** 复制/重生成/点赞等全部依赖 `:hover`。
11. **可访问性缺口。** 语音里只有部分按钮有 `aria-label`;消息区没有
    `role="log"`/`aria-live`;图标按钮对屏幕阅读器是匿名的。

## 本轮修复

P0 全部修复;P1 中 7/8/9/10/11 修复。详见 review.md。
