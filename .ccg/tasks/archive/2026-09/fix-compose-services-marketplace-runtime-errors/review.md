# 双模型审查记录

## 审查结论
antigravity 与 Claude 均提出 REQUEST_CHANGES，主要 Critical/Major 已修复并复验。

## 已修复
- 部署失败不再无条件 `closeDeploy()`；仅在 `result.ok=true` 时关闭并提示。
- 非内置模板不再暴露“部署”按钮，避免 `/ops/blueprints/deploy` 404。
- `useWebSocket` 的 `socket.onerror` 改为使用 `activeErrorHandler`，降级轮询立即生效。
- 服务页 WebSocket 实例改为 setup 顶层单例，避免 watcher/onMounted 双实例与生命周期违规。
- WS 连上后停止降级轮询；关闭连接时同步 `wsConnected=false`。
- 部署变量默认值回填兼容空字符串；对象式变量 schema 兼容非对象值。
- 部署运行中禁止关闭弹窗，遮罩关闭也受保护。

## 保留提示（非阻断）
- `client.js` JSON 畸形时回退字符串，避免破坏响应；调用方已有各自兜底。
- 前端 ESLint 仍存在历史 `no-empty` warning，未在本次引入。
- 部署后显式刷新市场统计与模板，项目列表由 SSE 前 `invalidateSwr('/projects')` 失效。

## 验证
- `npx eslint` 0 errors。
- `npx vitest run` 105/105 passed。
- `npm run build` 成功。
