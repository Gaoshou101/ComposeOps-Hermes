# PostgreSQL 故障恢复案例

## 场景

PostgreSQL 容器启动失败，业务无法连接数据库。

用户希望快速定位原因并恢复服务。

---

## 用户目标

修复 PostgreSQL 启动失败问题。

## Agent 分析

用户输入：

> PostgreSQL 无法启动，帮我排查

Agent 自动执行：

- 获取容器状态
- 分析启动日志
- 检查 Compose 配置
- 检查环境变量
- 生成修复建议

常见发现：

- 配置错误
- 环境变量缺失
- 数据目录挂载异常
- 镜像版本不兼容

---

## 故障诊断

Agent 汇总关键证据：

- 容器退出码
- 最近错误日志
- 健康检查状态
- 相关配置片段

并给出原因分析与修复建议。

---

## Approval Gate

如果修复方案涉及：

- 修改配置
- 重建容器
- 回滚版本

ComposeOps 会要求用户审批。

所有高风险操作均保留人工确认。

---

## 自动修复

工具轨迹示例：

- logs.read
- compose.read
- compose.edit
- compose.up
- health.check

执行过程实时可见。

---

## 验证恢复

修复完成后自动验证：

- PostgreSQL Running
- Health Check 正常
- 数据库端口可连接
- 日志无持续错误

最终结果：

✅ 服务恢复

---

## 为什么重要

传统运维通常需要：

查看日志 → 搜索问题 → 修改配置 → 重启验证

ComposeOps 将这些步骤整合到统一工作流中：

发现问题 → 分析原因 → 请求审批 → 执行修复 → 验证恢复

帮助用户更快完成故障处理。

---

## 延伸阅读

- Demo Script：`docs/public/DEMO_SCRIPT.md`
- Roadmap：`docs/public/ROADMAP.md`
- Release Checklist：`docs/public/RELEASE_CHECKLIST.md`