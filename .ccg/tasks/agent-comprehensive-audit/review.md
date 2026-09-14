# Review — Agent 全方位审查与深度改进

## 审查方法
从"唯一事件出口"向内读:`agent-public-events.js` 决定前端能看到什么 →
`useAgentChat.js` 决定消息对象形态 → Vue 模板决定渲染。任何一环缺字段,
上层组件就是死代码。这次正是靠这条链路一次性挖出 6 个 P0。

## 修复清单

### P0 — 声称可用但实际不生效

1. **工具卡片空壳** → 后端 `tool_requested` 透出脱敏 `paramsText`(≤600 字符),
   `tool_result` 增加 `error` 字段与失败摘要回退;前端 `trackTool()` 写入
   `paramsText/summary/error`,卡片现在能真正展开参数与结果。
2. **思考过程面板永空** → `toPublicAgentEvent` 补 `thinking` 分支(原先 `return null` 丢弃)。
3. **"第 N 轮"渲染成空白** → `loop_iteration` trace 携带 `metadata.loopCount`,
   公开事件映射为 `round`,模板改读 `event.round`。
4. **抽屉放大浮层全白** → 该处误用 `<AgentMarkdown :html>`,而组件只认 `content`
   且会二次渲染;改为直接 `v-html="zoomContent"`(内容本已是净化后的 HTML)。
5. **消息队列是死代码** → 两个界面的发送按钮此前 `:disabled="running"`,
   执行中根本点不了。现在执行中可发送,按钮文案变为"排队发送/排队",
   底部提示显示已排队条数。
6. **"编辑消息"不能编辑** → 点击铅笔立即重发原文。现在进入编辑态:
   原文载入输入框 + 顶部提示条 + 可取消,发送时才重跑。

### P1 — 设计完整性与一致性

7. **点赞/点踩打通闭环** → 新增 `POST /agent/feedback`,前端消息操作栏加 👍/👎,
   只在后端透出 `planId` 时显示(`done` 事件新增 `planId`)。
8. **中断可继续** → `interrupted` 标记落到消息上,渲染"继续执行"按钮,
   以"从中断处继续、不重复已完成步骤"的指令续跑。
9. **会话切换状态清理去重** → 抽出 `resetViewState()`,统一清理执行动态/
   挂载日志/编辑态/搜索词/录音,`newSession`、`openSession`、`onDeactivated` 共用。
10. **触摸设备可达性** → `@media (hover: none)` 下操作栏改为常驻可见且静态排布;
    `@media (pointer: coarse)` 给图标按钮 34px 最小命中区。
11. **屏幕阅读器** → 消息区加 `role="log" aria-live="polite"`,会话/搜索/语音/
    消息操作等图标按钮补 `aria-label`,`aria-pressed` 标记录音态。

### 审查中额外发现并修复的真实缺陷

12. **`addAiMessage` 返回错误的 id。** 会话行不存在时,函数在写 `ai_sessions`
    之后才取 `last_insert_rowid()`,返回的是**会话行 rowid** 而不是消息 rowid。
    新功能(按消息 id 截断历史)完全依赖这个返回值,故改为插入后立即取。
13. **编辑/重发会让前后端历史分叉。** 前端 `splice` 删气泡,后端 `ai_history`
    仍留着旧轮次,重开会话看到重复内容。新增
    `POST /ai/history/truncate` + `truncateAiHistoryFrom()`,前端记录每条用户消息的
    `persistedId`(实时事件 `session_meta` 回填,历史恢复时从 DB 带上),
    编辑与重新生成都先截断再删本地;截断失败则中止并提示,不做静默降级。
14. **`truncateAiHistoryFrom` 边界。** `fromId <= 0` 会匹配全部行(等价清空会话),
    已加 `fromId <= 0` 守卫并补测试。

### 审查方式说明
双模型审查本轮不可用:antigravity 报区域不支持 Code Assist,
codeagent-wrapper 调用 claude 退出 status 1(直连 `claude -p` 可用但 wrapper 链路失败)。
按证据自审完成,并把上面 12/13/14 三个只有读源码才会暴露的问题一并修掉。

## 验证证据
- `cd frontend && npm run build` → 成功,零 Warning
- `cd frontend && npx vitest run` → 12 文件 / 96 用例通过
- `cd frontend && npm run lint` → 0 error(40 个历史 warning)
- `cd backend && DB_PATH=/tmp/x.db npm test` → **127** 用例通过(新增 5 个:
  feedback 3 个、截断历史 1 个、反馈路由鉴权 1 个)
- 运行时:后端启动于 :3001,新构建的 chunk 已含"排队发送/继续执行/思考过程/
  搜索消息/语音输入";`/ai/agent/feedback` 与 `/ai/history/truncate` 未登录返回 401
  (证明路由已注册且受认证保护)

## 结论
P0 全部修复,P1 中 7–11 修复,并额外修掉 3 个持久化层面的真实缺陷。可以推送。
