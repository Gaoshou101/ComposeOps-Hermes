# 实施计划

## Layer 1：数据与后端契约

- 扩展 `backend/src/lib/db.js`，提供事务化的批量会话删除。
- 扩展 `backend/src/routes/ai.js` 与 `frontend/src/api/client.js`，增加批量删除接口/调用，限制 ID 数量、类型和上限。
- 增加 Docker 节点一次性 ping 路由，前端测试连接改走该路由。
- 修正指标历史查询的时间单位兼容策略，并补充数值序列所需字段。

## Layer 2：前端工作流

- 改造 `useAgentChat.js` 为模块级共享会话状态，工作台与抽屉复用同一流。
- Agent 工作台增加会话选择工具栏、全选/批量删除、选中态和确认弹窗。
- 消费诊断 query；修复执行历史展示 plan + execution 轨迹。
- 修正 ResourceMonitor 的真实历史、异常、单位和错误状态。
- 修正 Compose 保存失败安全门、节点测试副作用、移动端布局。

## Layer 3：验证与交付

- 先跑前端单测、后端单测和语法检查，再跑前端 build/lint。
- 检查 `git diff`，双模型审查变更；Critical 必须修复后复审。
- 更新任务 review.md，归档 `.ccg/tasks`，提交并推送 `origin/main`。
