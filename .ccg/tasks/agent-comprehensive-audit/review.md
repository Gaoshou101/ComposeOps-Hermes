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

---

## 第二轮(2026-09-15)— 富渲染 / 执行动态 / 国内构建

### 用户反馈
1. SVG 与 HTML 的渲染"有点差劲"(暗色界面里白底黑字、图被压扁或裁掉)
2. "右边的执行动态…很丑,也很无语"
3. 会话不能批量删除(已实现,复核确认可用)
4. `docker compose up -d --build` 在国内网络下必然失败(附完整报错)

### 一、SVG / HTML 富渲染重写 — `frontend/src/lib/agent-markdown.js`

根因是**只做了净化、没做主题化**:DOMPurify 放行 `style`/`fill`/`bgcolor` 之后,
模型输出的 `#fff` 背景、`black` 文本、`lightgray` 填充原样落到暗色页面上,于是出现
"一张白纸 + 黑字"的卡片;SVG 又带着模型写死的 `width/height`,窄栏里直接被截断。

在 `DOMPurify.sanitize` **之后**新增 DOM 后处理(`postProcessHtml`,走 `DOMParser` 的
`text/html` 模式,这样内联 `<svg>` 会进 SVG 命名空间,`querySelectorAll`/classList 都能用):

- `stripColorDeclarations()` — 剥掉颜色类声明(`color` / `background[-color|-image]` /
  `border*-color` / `fill` / `stroke` / `font-family` / `box-shadow` / `text-shadow`),
  **保留布局声明**(`width`/`height`/`text-align`/`padding`/`margin`…)。
  这一条同时解决 HTML 表格、`<div style>` 卡片和 SVG 三类白底问题。
- `rethemeSvg()` — 亮度感知重映射:浅色(lum≥0.6)统一到 `#1f2530`;纯黑形状给
  `fill:#262c37` + `stroke:#4b5563`;`text`/`tspan` 的 `fill`/`stroke` 一律删除交给 CSS。
- `makeSvgResponsive()` — 缺 `viewBox` 时用 `width/height` 合成;移除 svg 自身的
  `width/height`;补 `preserveAspectRatio="xMidYMid meet"` + `data-fluid="1"` + `role="img"` + `aria-label`。
- `rethemeTables()` — 剥 `bgcolor`/`border`,**用外层 `<div class="agent-table-wrap">` 承载主题样式**。
- `tagCodeLanguages()` — `pre[data-lang]` 给 CSS 出语言徽标。

配套 CSS(`style.css`):`.agent-table-wrap` 家族(表头/斑马纹/hover/caption)、
`pre[data-lang]::after` 语言徽标(右上角 `right:34px`,避让复制按钮)、
`svg[data-fluid="1"] { width:100%; height:auto; max-height:70vh }`(原来是 420px,高图必被裁)。

**踩过的坑(留档)**:用 Python 脚本批量重写这个文件时把正则里的全角冒号 `[::]` 弄丢,
导致 `agent-text.spec.js` 的 "compact table 修复" 用例失败;已改回。改这个文件请用 `apply_patch` 或核对字节。

### 二、执行动态面板卡片化 — `frontend/src/views/AgentWorkflowView.vue` + `style.css`

原来是一行一条的纯文字列表(标签 + chip + 时间),没有视觉锚点、长文本把时间轴撑爆。
改为**卡片式时间轴**:状态图标胶囊(按 running/done/failed/rejected 分别着色)、
标签 + 时间、工具/耗时 chip、长文本(>90 字符)折叠"展开/收起"、虚线空态卡("等待执行")。

### 三、Agent 抽屉补齐工作台能力 — `frontend/src/components/AgentDrawer.vue`

抽屉此前只有工具名与耗时。新增"参数与结果(N)"折叠块(逐工具展示脱敏 `paramsText` /
`error` / `summary`)与"思考过程"折叠块,与工作台对齐。

### 四、Docker 构建修复(用户报错的核心)— `Dockerfile` / `docker-compose.yml` / `DOCKER_BUILD_CN.md`

**实测根因**:
- 同一容器里 `deb.debian.org` 的 `InRelease` 有时 200,但 **12MB 的 `binary-amd64/Packages.gz` 必超时**;
  清华源 4 秒稳定下完 11.5MB。
- 裸 debian 镜像没有 `ca-certificates`,apt 源改 **https 会直接 Certificate verification failed** → 镜像源必须走 http。
- runtime 阶段原方案要装 `download.docker.com` 的 GPG key + `docker-ce-cli`,是最脆的一步。
- **镜像里 `git`/`ssh` 此前完全缺失**,而 `backend/src/services/gitops.js:56` 是
  `execFileSync('git', ...)` → 容器里 GitOps 直接 ENOENT(**真实功能缺陷,不是构建问题**)。

**修法**:
1. `ARG APT_MIRROR="mirrors.tuna.tsinghua.edu.cn"` 设为默认;apt 全部加
   `-o Acquire::Retries=5 -o Acquire::http::Timeout=30`;传 `APT_MIRROR=`(空)可强制回官方源。
2. backend-build **先试预编译**:`npm_config_better_sqlite3_binary_host=…npmmirror… npm ci`
   (不需要编译器,实测 6s 成功),失败才回退 `apt 装 python3 make g++ && npm ci --build-from-source`。
3. runtime **不再用 apt 装 docker**,改为 `COPY --from=docker:cli` 拷 `docker` /
   `docker-compose` / `docker-buildx` 三个二进制;apt 只装
   `ca-certificates curl gnupg git openssh-client`,末尾断言
   `docker --version && docker compose version && git --version && ssh -V`。
4. `docker-compose.yml` 的 `build.args.APT_MIRROR` 默认启用(端口 `0.0.0.0:28765:3001` 未动)。
5. `DOCKER_BUILD_CN.md` 重写为与新实现一致的中文文档。

### 第二轮验证证据
- `cd frontend && npx vitest run tests/agent-markdown.spec.js` → **24/24 通过**
- `cd frontend && npx vitest run` → **13 文件 / 120 用例全通过**
- `cd frontend && npm run build` → 成功,零 Warning
- `cd backend && DB_PATH=/tmp/x.db npm test` → **127/127 通过**
- `docker compose build` → **EXIT=0**(日志可见 `[build] better-sqlite3 预编译产物 OK`,runtime 只跑一次 apt)
- `docker run --rm --entrypoint sh composeops/opsdash:latest -c '…'` →
  `Docker version 29.8.0` / `Docker Compose version v5.5.1` / `git version 2.39.5` / `OpenSSH_9.2p1` / `better-sqlite3 OK`
- 用镜像实跑 `opsdash-smoke`(`127.0.0.1:3102`)→ `/health` 与 `/` 均 200,验证完即删容器
- 渲染可视化:headless Chromium 对 `renderAgentMarkdown` 输出截图,确认表格暗色主题、
  SVG 白底被清除且撑满宽度、`yaml` 语言徽标正常 —— 用户吐槽的两个渲染问题都已解决
