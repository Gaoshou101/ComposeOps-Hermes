# 双模型审查要点(agent-drawer-and-activity-redesign)

审查对象:`git diff`(未提交变更)。

1. `frontend/src/composables/useAgentChat.js`
   从"模块级共享单例"改为"按 channel 隔离的多实例"。
   - 是否有遗漏的共享状态、跨 channel 泄漏;
   - 事件派发是否仍能到达正确的订阅者;
   - token 节流缓冲是否可能把 A channel 的分片写进 B channel 的消息。

2. `frontend/src/lib/agent-markdown.js`
   富内容渲染重构。
   - `renderableCodeBlocks` 单遍扫描的 details 深度跟踪边界(大小写/嵌套/未闭合);
   - `wrapFullscreenBlocks` 改 DOM 后是否仍可能重复包裹或渲染源码 details 内的内容;
   - `isCanvasBackgroundRect` 是否会误伤正常形状。

3. `backend/src/lib/agent-public-events.js` + `backend/src/services/agent/engine.js`
   reasoning 流式透传、`tool_executing` 参数透出。
   - 脱敏是否覆盖到位、reasoning 是否会无限增长、截断是否合理。

4. `frontend/src/views/AgentWorkflowView.vue`
   执行动态按 session + turn 分组折叠。
   - computed 复杂度、分组 key 稳定性、会话删除后的残留、自动展开逻辑是否互相打架。

5. 回归风险:keep-alive 缓存、SSE 中断、`done` 事件清理、测试覆盖是否足够。

输出要求:Critical / Warning / Info 分级,每条给出 `文件:行号` + 问题 + 建议修法,只报真实问题。
