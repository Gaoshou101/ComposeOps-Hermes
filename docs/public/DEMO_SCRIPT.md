# ComposeOps Demo Script

## 相关文档

- WHY_COMPOSEOPS：`docs/public/WHY_COMPOSEOPS.md`
- FAQ：`docs/public/FAQ.md`
- Redis 升级案例：`docs/public/USE_CASE_REDIS.md`
- PostgreSQL 故障恢复案例：`docs/public/USE_CASE_POSTGRESQL.md`

## 目标

用 45~60 秒展示：

用户一句话 → Agent 分析 → 审批 → 执行 → 验证

## 场景

Redis 镜像升级

## 分镜

### 1. 打开 Agent（5 秒）

展示：
- 服务列表
- Redis 正在运行

旁白：

“ComposeOps 不只是管理 Docker，它可以让 Agent 参与运维。”

---

### 2. 用户输入（5 秒）

输入：

升级 Redis 到最新稳定版本

---

### 3. Agent 分析（10 秒）

展示：

- 读取 Compose 配置
- 识别 Redis 服务
- 检查当前镜像版本
- 生成执行计划

Agent 输出：

- 修改镜像标签
- 拉取镜像
- 重建容器
- 验证健康状态

---

### 4. Approval Gate（8 秒）

展示确认门：

高风险操作：
- Pull Image
- Recreate Container

用户点击：

批准执行

强调：

“AI 不会直接修改生产环境。”

---

### 5. 自动执行（10 秒）

展示工具轨迹：

- compose.pull
- compose.up
- health.check

实时显示执行状态。

---

### 6. 验证结果（8 秒）

Agent 输出：

升级成功

Redis:
- Running
- Healthy

镜像版本已更新

---

## 结束页

ComposeOps

AI-Powered Docker Compose Operations Workspace

Analyze → Approve → Execute → Verify
