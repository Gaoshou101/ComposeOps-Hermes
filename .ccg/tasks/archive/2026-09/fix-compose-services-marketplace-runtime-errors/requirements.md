# 修复 Compose 服务空状态、应用市场部署、运行时 d is not a function

## 问题
1. 服务页进入即显示“暂未发现 Compose 项目”。当前实现只从容器 label 发现项目,
   面板自身/旧式 `docker run` 项目无法发现，且首次加载可能因 WS 未触发 refresh。
2. 应用市场只能看：MarketplaceView 仅有查看/收藏/自定义模板，没有部署动作。
   后端已有 `/ops/blueprints/deploy` 与前端 `streamBlueprintDeploy`，需要接入。
3. 某些页面显示“页面组件异常:d is not a function”，至少来自 MarketplaceView
   `template.id.startsWith` 对无 id 项直接调用，以及 APIClient GET 非 JSON
   响应缺少回退导致调用处把文本当对象取字段。
