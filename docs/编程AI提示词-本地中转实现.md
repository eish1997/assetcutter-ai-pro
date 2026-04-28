# 给编程 AI 的提示词（本地伴侣 · 站点中转 Relay 插件）

> 用法：把下面模板复制给编程 AI。方括号内容按你的项目实际替换。  
> **架构结论**：**本地伴侣（Companion）为主程序**；原「本地中转」为其中的 **Relay（站点中转）插件**，与存储、计算等并列。总规范见 `docs/本地伴侣-存储与计算规范.md`，Relay 专篇见 `docs/本地中转应用开发文档.md`。

## 提示词模板

你是资深全栈工程师，请在当前仓库实现 **本地伴侣内的「站点中转（Relay）」插件（多站点）** 的 MVP（若当前仓库仅有 `A-Driver/local-bridge` 骨架，可先作为 **Relay 插件的可运行子工程**，后续迁入 `plugins/relay` 目录结构）。  
目标：让用户在我们的网站输入消息后，由用户电脑上的 **Companion（含 Relay 插件）** 把消息发送到目标网站（如 Gemini），并将回复回传到我们的网站。

### 一、项目背景（必须理解）

- **宿主 + 插件**：Companion 为宿主；Relay 内仍采用「通用核心 + 站点连接器」架构。
- `bb-sites` 是默认适配器来源，但不能假设永远可用。
- 必须保留私有 override 能力，支持社区适配器失效时快速兜底。
- 本期优先 [Windows/跨平台]。

### 二、本次实现范围（严格按此执行）

1. 实现 Relay 插件（或过渡期的 local-bridge）基础骨架：
  - `transport`：与云端 WSS 通信（鉴权、心跳、重连、ACK）
  - `orchestrator`：任务队列（超时、重试、并发）
  - `plugin-runtime`：连接器加载、选择、生命周期
2. 定义统一 connector 接口，并实现至少 1 个示例 connector（如 `gemini-web`）。
3. 打通消息链路：
  - 网站下发 `task.send_message`
  - 本地执行发送
  - 回传 `reply.delta` / `reply.completed`
4. 增加错误分类与可观测性：
  - 未登录站点、连接断开、适配器异常、超时
5. 输出可运行说明与验证步骤。

### 三、明确非目标（不要超范围）

- 不要实现“所有站点支持”
- 不要实现 UI 大改
- 不要引入与当前任务无关的重构

### 四、硬性约束

- 安全：本地服务仅监听 `127.0.0.1`；云端通信必须 TLS
- 解耦：禁止把站点选择器硬编码到通用核心
- 可回滚：适配器更新失败必须可回退到上一版本
- 日志：每个任务必须有 `taskId` 全链路日志
- 代码：优先小步提交、可测试、可追踪

### 五、建议目录（可微调，但需等价）

```text
[project-root]/
  apps/local-bridge/
    src/
      core/
        transport/
        orchestrator/
        plugin-runtime/
        security/
      connectors/
        community/
        overrides/
      protocols/
      telemetry/
      index.ts
    tests/
  docs/
    本地伴侣-存储与计算规范.md、本地中转应用开发文档.md（Relay 专篇）
```

### 六、协议与接口要求

- 统一 envelope（`type`, `taskId`, `connectorId`, `payload`）
- 至少支持事件：
  - `task.accepted`
  - `reply.delta`
  - `reply.completed`
  - `task.failed`
- connector 接口至少包含：
  - `match`
  - `init`
  - `sendMessage`
  - `subscribeReplies`
  - `healthCheck`
  - `teardown`

### 七、交付物清单（必须全部给出）

1. 新增/修改文件列表（按路径）
2. 核心设计说明（不超过 12 条）
3. 本地运行步骤
4. 验证步骤（含成功与失败用例）
5. 已知限制与后续建议

### 八、验收标准（未满足即未完成）

- 能完成“网站输入 -> 本地发送 -> 回传显示”闭环
- 任务失败可定位（有错误码和日志）
- 连接中断后可自动重连
- connector 可热加载或可替换，不改核心代码
- 至少 1 条自动化测试覆盖关键链路

### 九、输出风格

- 使用简体中文
- 先给结果，再给细节
- 只改与任务相关文件，避免噪音改动

---

## 可直接补充的项目变量

- 网站后端 WS 地址：`[wss://your-domain/... ]`
- 设备配对方式：`[扫码/一次性口令]`
- 首批目标站点：`[gemini-web, ...]`
- 运行时：`[node/electron/tauri]`
- 最小支持系统：`[Windows 10+]`

