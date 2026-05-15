# A-Driver（同仓分目录）

本目录用于 **本地伴侣（Companion）** 中 **Relay（站点中转）** 能力的可运行实现，与现有网站代码解耦。架构总览见仓库根目录 `[docs/本地伴侣-存储与计算规范.md](../docs/本地伴侣-存储与计算规范.md)`。

## 目录

- `apps/local-bridge`：当前即 **Companion 宿主进程内的 Relay 实现载体**（WS 中转 + 本机 HTTP `capabilities`）
- `packages/protocol`：网站与中转之间的共享协议类型
- `docs`：需求、设计与 AI 提示词

## 本机 HTTP 能力宣告（Companion P0）

`local-bridge` 启动时默认在 `**127.0.0.1:18765`** 提供（与网站编排面对接）：

- `GET http://127.0.0.1:18765/v1/capabilities` — JSON：`protocolVersion`、已注册站点连接器列表、`storage`/`compute` 占位（未实现）
- `GET http://127.0.0.1:18765/v1/health` — 存活探测

环境变量：

- `**COMPANION_HTTP_PORT**`：端口；设为 `**0**` 关闭 HTTP 面（仅 WS / demo）。

## 快速开始

```bash
cd A-Driver
npm install
npm run typecheck
npm run test -w @a-driver/local-bridge
npm run dev
```

`npm run dev` 会启动 `@a-driver/local-bridge`。网站侧 `**connectorId: gemini-web**` 时：通过 bb-browser 打开 **[https://gemini.google.com/app](https://gemini.google.com/app)**（可用 `BRIDGE_GEMINI_URL` 覆盖），在已登录 Chrome 的 Quill 输入框发你的提示词并读模型回复；`**connectorId: bb-site`** 时走 `bb-browser site <route>`（如 `duckduckgo/search`）。Demo 无 WS 时用 `bb-site` 跑一条搜索任务。

## 运行前准备

- 本机可用 `npx`（Windows 会自动调用 `npx.cmd`）
- 安装并可执行 `bb-browser`（命令会自动通过 `npx -y bb-browser` 拉取）
- 若需要切换示例站点路由，设置环境变量：

```bash
set BB_BROWSER_SITE_ROUTE=zhihu/hot
```

当前示例把 `task.send_message.payload.text` 作为 `bb-browser site <route> <text>` 的查询词执行。

## 连接网站后端（WS）

设置以下环境变量后再启动：

```bash
set BRIDGE_SERVER_WS_URL=wss://your-domain/ws/bridge
set BRIDGE_DEVICE_ID=your-device-id
set BRIDGE_AUTH_TOKEN=your-device-session-token
set BB_BROWSER_SITE_ROUTE=wikipedia/summary
set BRIDGE_HEALTHCHECK_INTERVAL_MS=60000
```

说明：

- `BRIDGE_SERVER_WS_URL`：本地中转连接你网站后端的 WebSocket 地址
- `BRIDGE_DEVICE_ID`：设备标识（用于后端路由/鉴权）
- `BRIDGE_AUTH_TOKEN`：设备会话 token（会放入 `Authorization: Bearer ...`）
- `BB_BROWSER_SITE_ROUTE`：`bb-site` 连接器默认路由（`payload.threadId` 可覆盖）
- `BRIDGE_GEMINI_URL`：`gemini-web` 打开的首页，默认 `https://gemini.google.com/app`
- `BRIDGE_GEMINI_OPEN_MS` / `BRIDGE_GEMINI_POLL_MS` / `BRIDGE_GEMINI_REPLY_TIMEOUT_MS`：Gemini 页等待与轮询间隔（可选）
- `BRIDGE_HEALTHCHECK_INTERVAL_MS`：连接器健康检查间隔（毫秒，<=0 表示关闭）

未配置 `BRIDGE_SERVER_WS_URL` 时会进入 demo 模式并发送一条本地测试消息。

## 与后端联调（最小闭环）

后端（`server/auth-api.js`）已新增 bridge 路由：

- `GET /api/bridge/devices`：查看在线设备（管理员）
- `POST /api/bridge/tasks/send-message`：下发 `task.send_message`（管理员）
- `GET /api/bridge/tasks/:taskId/events`：查看任务事件（管理员）
- `WS /ws/bridge`：本地中转连接入口（默认要求 `Authorization: Bearer <sessionToken>`）

本地中转连接后，可通过后台下发任务到指定 `deviceId`，再从任务事件接口查看 `reply.delta` / `reply.completed` / `task.failed`。

### 传输 ACK 与 messageId

- 服务端下发的 `task.send_message` 自带 `messageId`；本地中转收到后会先上行 `transport.ack`。
- `POST /api/bridge/tasks/send-message` 可传可选字段 `messageId`；相同 `deviceId + messageId` 在窗口内第二次调用会得到 `deduped: true`。

### 一键冒烟（可选）

管理员登录后从浏览器复制 `ac_session` Cookie，然后：

```bash
set BRIDGE_BASE=http://127.0.0.1:9100
set BRIDGE_COOKIE=ac_session=你的值
set BRIDGE_DEVICE_ID=local-dev-device
node scripts/bridge-relay-smoke.mjs
```

（脚本在仓库根目录 `scripts/bridge-relay-smoke.mjs`。）