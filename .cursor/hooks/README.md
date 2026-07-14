# Agent Autopilot（Cursor `stop` 钩子）

另见：**开发日志自动上传** — `afterShellExecution` → `dev-log-after-push.mjs`（成功 `git push` 后跑 `npm run dev-log:post-push`）。

## 做什么

Agent 每次尝试结束时触发 `autopilot-stop.mjs`：若任务未在 **`loop-state.json`** 标为完成，则自动下发一条「继续干」的跟进消息（并可附带校验命令输出），最多 **25** 轮（`hooks.json` 里 `loop_limit`）。

发送消息前会跑 **`beforeSubmitPrompt`** 脚本 `autopilot-arm.mjs`：根据你输入里的**唤醒词 / 解除短语**切换「对话触发」模式（不写 `enabled: true` 也能用）。

## 对话触发（推荐）

- 在任意一条用户消息里带上 **`扁担`**（默认唤醒词，可在 `autopilot.task.json` 里改 **`wakeWord`**）→ 自动**开启** Autopilot，并把 **`loop-state.json`** 的 **`done`** 置为 **`false`**（新开跑）。
- 将 **`wakeWord`** 设为 **`""`** 可**关闭**整段对话唤醒（只保留下面的 `enabled: true` 常驻方式）。
- 消息里带 **`扁担停`**（默认 **`sleepPhrase`**）→ **关闭**对话触发（写入运行时标记 `armed: false`）。将 **`sleepPhrase`** 设为 **`""`** 可禁用该解除句（不推荐，除非你不靠「扁担」触发）。
- 任务跑完后，若当前是靠「扁担」拉起的，钩子会在检测到 **`done: true`** 时**自动**关掉 `armed`，下次要用再发一次「扁担」即可。

仍可在 `autopilot.task.json` 里把 **`enabled`** 设为 **`true`**，作为**常驻开启**（不依赖「扁担」）；与 `armed` **二选一即生效**（任一为真都会自动续跑）。

## 状态文件（不入库）

- **`loop-state.json`**、**`autopilot.runtime.json`** 已 **gitignore**，只在本机。
- 仓库内提供 **`loop-state.example.json`**。
- 首次 **`enabled` 或 `armed`** 生效且 Agent 正常结束触发 `stop` 钩子时，若还没有 `loop-state.json`，`autopilot-stop.mjs` 会从模板**自动生成**。

## 校验命令

- 默认 **`validateCommand`: `npm run typecheck`**。不需要时把 **`validateCommand`** 改成 **`""`**。
- 可改为 `npm test -- --run`、`npm run lint` 等。

## 任务结束

- 让 Agent（或你手工）把 **`loop-state.json`** 里 **`done`** 改为 **`true`** → 不再自动继续。

## 怎么关

- **对话**：发一条带 **`扁担停`** 的消息。
- **配置**：把 **`enabled`** 改回 **`false`**（若曾打开），或删掉 / 改名 **`autopilot.task.json`**。

## 注意

- 仅在 Agent **`status === "completed"`** 时会自动继续；用户中止或报错不会跟跑。
- **`beforeSubmitPrompt`** 官方输出**不能改写**你的正文，「扁担」会照常进对话；若不想模型纠结这两个字，可在同条消息里说明「扁担 仅为本地自动化标记，忽略即可」。
- 依赖本机可执行 **`node`**。
