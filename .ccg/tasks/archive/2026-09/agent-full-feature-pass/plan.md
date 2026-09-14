# Agent 全量功能 + 高颜值 UI 升级 Plan

## 阶段划分

### Phase 1 — 聊天交互基础 (高价值低成本)
1. 消息排队 (Message Queue)
2. 重新生成 (Regenerate)
3. 编辑用户消息 (Edit & Resend)
4. 复制代码块按钮 (Copy Code Block)
5. Token 用量显示 (Token Usage)

### Phase 2 — 执行可视化增强 (高价值中成本)
6. Thinking 折叠面板 (Collapsible Thinking)
7. 工具调用卡片化 (Tool Call Cards)
8. 中断后继续 (Resume After Interrupt)
9. 快捷键 (Keyboard Shortcuts: Cmd+K / Cmd+Enter / Esc)

### Phase 3 — 高颜值 UI (视觉提升)
10. 消息气泡优化 (渐变 + 阴影 + 微动画)
11. Streaming 打字机效果增强 (光标闪烁 + 逐字出现)
12. 加载骨架屏 (Skeleton for assistant message)
13. 空状态插画 (Empty State with Icon + Animation)
14. 消息操作悬浮栏 (Hover Action Bar: 复制/重新生成/编辑/删除)

### Phase 4 — 长期能力 (架构改动)
15. 多模型切换 (Model Switcher)
16. 语音输入 (Voice Input via Web Speech API)

## 当前状态

Phase 1 开始。

## 验收标准

- 前端构建零 Warning
- 前端单测 96 通过
- 后端单测 122 通过
- 所有新功能在 http://localhost:3001 可验证
