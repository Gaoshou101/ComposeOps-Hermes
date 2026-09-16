# 双模型审查记录 — agent-drawer-and-activity-redesign

## 审查方式

- 前端/UI 侧:antigravity(`--backend antigravity`)+ Claude(`--backend claude`)双模型。
- 本轮 antigravity CLI 持续返回空响应/超时(5 分钟 print timeout,turn in progress),
  未能取回可用报告;改由 Claude 以「分主题小提示」方式逐点审查 + 人工交叉验证兜底。
- 所有结论都经过**可复现验证**(写入临时用例实跑),不采信未验证的推断。

## Claude 提出的问题与处置

| # | 提出者 | 结论 | 处置 |
|---|---|---|---|
| 1 | Claude | 「details 内代码围栏不渲染,会漏出裸反引号」 | **不成立**。实跑验证 `<details>` 内的 ```json 正常渲染为 `<pre>`。未改。 |
| 2 | Claude | 「detailsDepth 缺少平衡性保护,游离闭合标签会让深度卡死」 | **部分成立**。验证发现真正的触发条件是 `</details >`(带空白)未被正则匹配,导致后续围栏全部不再富内容化。**已修**(正则放宽 + 回归用例)。 |
| 3 | Claude | 「模块级 Map 缓存的 ref 生命周期长于组件,同 key 新实例会继承脏状态」 | **设计使然,非缺陷**。两个入口固定使用常量 channel;抽屉每次打开显式 `resetSession()`。同 channel 复用正是「工作台切页不丢会话」所需。 |
| 4 | Claude | 「reasoning 无上限会 OOM / 前端二次方渲染」 | **成立**。已修:后端 `MAX_REASONING_CHARS = 120000` 截断并追加省略提示;前端同阈值封顶,停止增长。 |

## 自查发现并修复的缺陷(审查之外)

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| 5 | `frontend/src/lib/agent-markdown.js` | `json` 围栏被 `js` 抢先匹配,渲染成 `language-js`,且正文多出 `on` 前缀 | **已修**:语言候选按长匹配优先,并区分「标准围栏」「粘连输出」两种形态;补回归用例。 |
| 6 | `frontend/src/lib/agent-markdown.js` | 满画布背景 `rect` 加描边 → 整张图多一圈外框 | **已修**:`isCanvasBackgroundRect` 判定后剥除描边;补回归用例。 |
| 7 | `frontend/src/lib/agent-markdown.js` | 新加的 `continue` 跳过 style 颜色清理,`style="fill:#fff"` 的底板会漏白 | **已修**:改为分支而非 continue;补回归用例。 |
| 8 | `frontend/src/composables/useAgentChat.js` | 中断/失败路径不清 `thinkingStreaming`,思考面板永远停在「思考中」 | **已修**:`finally` 统一复位。 |
| 9 | `frontend/src/views/AgentWorkflowView.vue` | 删除会话后执行动态残留无主「会话 #id」分组 | **已修**:`dropActivityForSessions`。 |
| 10 | `frontend/src/views/AgentWorkflowView.vue` | `.agent-mobile-session-btn { display:none }` 写在媒体查询之后,移动端按钮被永久隐藏 | **已修**:提高选择器特异性。 |
| 11 | `frontend/src/views/AgentWorkflowView.vue` | `onDeactivated` 静音订阅者 → 切页期间执行动态整段丢失 | **已修**:订阅者常驻,动态按会话分组累积。 |

## 验证

- `frontend`: `npx vitest run` → **133 passed**(`agent-markdown` 33 例、`useAgentChat` 6 例)
- `backend`: `DB_PATH=… npm test` → **127 passed**
- `frontend`: `npm run build` → 通过,无 warning
