# 本地伴侣 · PaddleOCR — 开发文档

本文记录 **PaddleOCR 本机 OCR / 文档解析** 接入 AssetCutter 本地伴侣的架构、实现清单与验收口径。与 [`本地伴侣SAM分割-产品开发规格.md`](./本地伴侣SAM分割-产品开发规格.md) 同模式：**独立 Python HTTP 服务 + 伴侣 Job 编排 + 网站门面**。

---

## 文档控制

| 属性 | 说明 |
| --- | --- |
| **文档版本** | `0.2`（2026-06-04 审查修订） |
| **Job 类型** | `paddle_ocr`（Adapter：`paddle_ocr@v1`） |
| **Pipeline** | `pp_ocr_v5`（图片 OCR）、`pp_structure_v3`（PDF / 文档 → JSON + Markdown） |
| **默认端口** | PaddleOCR HTTP：`127.0.0.1:18082`；伴侣：`127.0.0.1:18765` |
| **配套文档** | [`本地伴侣-本地程序开发.md`](./本地伴侣-本地程序开发.md)、[`本地伴侣-沙盒目录.md`](./本地伴侣-沙盒目录.md)、[`本机分割一键安装指南.md`](./本机分割一键安装指南.md)、[`本地伴侣-本机能力用户体验与产品化路线图.md`](./本地伴侣-本机能力用户体验与产品化路线图.md) |

### 修订记录

| 版本 | 日期 | 摘要 |
| --- | --- | --- |
| 0.1 | 2026-06-04 | MVP：Python 服务、伴侣 Adapter、桌面壳一键安装、分镜 PDF/图片导入、设置页自检 |
| 0.2 | 2026-06-04 | 审查修订：Job 同步语义、错误码表、沙盒路径交叉引用、环境变量补全、localCapabilityUi 边界 |

---

## 1. 目标与边界

### 1.1 产品目标

- 用户在 **网站** 内对 **图片** 做 OCR、对 **PDF / 扫描件** 做结构化解析，算力在本机完成。
- **Windows 桌面伴侣** 提供 **OCR 一键安装**（与 SamLocal / rembg **共用嵌入 Python**）；默认 **CPU**，可选 **GPU**（`paddlepaddle-gpu`）。
- 首个业务入口：**分镜表批量输入**「导入 PDF / 图片」→ 提取纯文本 → 用户再点「解析」写入表行。

### 1.2 非目标（当前版本不做）

- [ ] 云端托管 PaddleOCR、多租户推理集群
- [ ] macOS / Linux 桌面壳一键安装（当前仅文档提示手动 `pip install`）
- [ ] 工作流节点内嵌 OCR（未接 `workflowRunTaskBranch`）
- [ ] OpenAPI / JSON Schema 机器可读契约（SAM 规格 §10 同级工件，待补）
- [ ] 附录错误码登记 `paddle_ocr.*`（待补 [`附录-伴侣错误码.md`](./附录-伴侣错误码.md)）

### 1.3 术语

| 稳定标识 | 对用户展示 |
| --- | --- |
| Job `type`: **`paddle_ocr`** | 「本机 OCR / 文档解析」 |
| Adapter **`paddle_ocr@v1`** | 不直接暴露 |
| Pipeline **`pp_ocr_v5`** | 图片认字 |
| Pipeline **`pp_structure_v3`** | PDF / 文档解析 |
| 设置 env **`COMPANION_PADDLEOCR_*`** | 设置页「检查 OCR」折叠详情 |

---

## 2. 系统架构

### 2.1 逻辑拓扑

```
浏览器 (Vite 站点)
  │  companionFetchJson + Bearer（可选）
  │  PUT 资产 → POST /v1/compute/jobs { type: "paddle_ocr", ... }
  ▼
local-companion :18765
  │  paddleOcrSupervisor 拉起 Python 子进程（若已配置 Python）
  │  paddleOcrAdapter：Volume 读字节 → 临时文件 → HTTP POST
  ▼
paddleocr-service :18082
  │  GET /health
  │  POST /v1/run { input_path, pipeline, lang }
  ▼
PaddleOCR / PPStructureV3 推理 → JSON（+ Markdown）
```

### 2.2 与现有能力对齐

| 现有能力 | PaddleOCR 对齐方式 |
| --- | --- |
| `sam_segment` / `remove_bg` | 同为「伴侣 Job → Adapter → 本机 HTTP / Python」 |
| 桌面壳 SamLocal / rembg 一键安装 | 共用 **`py311-sam-torch-cpu-win-amd64`** 嵌入 Python |
| `GET /v1/debug/*-health` | 新增 **`GET /v1/debug/paddleocr-health`** |
| `localEnginesRegistry` | 注册 `paddle_ocr` + `companion_http_probe_paddleocr` |

### 2.3 沙盒与状态目录（Windows）

路径约定与 [`本地伴侣-沙盒目录.md`](./本地伴侣-沙盒目录.md) 一致；Electron `userData` 在 Windows 上为 **`sandbox\desktop-shell\`**。

| 路径 | 用途 |
| --- | --- |
| `%LOCALAPPDATA%\AssetCutterCompanion\sandbox\runtimes\py311-sam-torch-cpu-win-amd64\1\python\` | 共享嵌入 Python（须先 SamLocal 或 rembg 安装） |
| `%LOCALAPPDATA%\AssetCutterCompanion\sandbox\models\paddleocr\` | 模型缓存（`PADDLEOCR_HOME` / `COMPANION_PADDLEOCR_MODELS_DIR`） |
| `%LOCALAPPDATA%\AssetCutterCompanion\sandbox\cache\pip\` | bootstrap 的 `PIP_CACHE_DIR` |
| `%LOCALAPPDATA%\AssetCutterCompanion\sandbox\desktop-shell\paddleocr-runtime\state.json` | 一键安装状态（`ready`、`pythonExe`、`device`、`serviceDir` 等） |

> **注意**：`state.json` 在 **`desktop-shell\paddleocr-runtime\`** 下，不在 `sandbox\` 根目录。手动跑 bootstrap 时 `AC_PADDLEOCR_USER_ROOT` 须与此路径一致。

### 2.4 `localCapabilityUi` 边界（当前实现）

- **`GET /v1/runtime-status`** 已单独返回 **`paddleOcrHttpProbe`** 与 **`localEnginesStatus.paddle_ocr`**。
- **一条主结论 `localCapabilityUi`** 目前仅合并 **Relay / 本机分割 / rembg**，**尚未纳入 OCR**（OCR 失败不会单独抬高 headline）。见 §9 P2。

---

## 3. 实现清单（勾选 = 已完成）

### 3.1 Python HTTP 服务

- [x] `local-companion/paddleocr-service/server.py` — 常驻 `ThreadingHTTPServer`
- [x] `GET /health` — 返回 `ok`、`device`、`pipelines`
- [x] `POST /v1/run` — `input_path` + `pipeline` + `lang`
- [x] Pipeline **`pp_ocr_v5`** — `PaddleOCR`，输出归一化 `blocks[]`
- [x] Pipeline **`pp_structure_v3`** — `PPStructureV3`，输出 JSON + `markdown`
- [x] 环境变量：`COMPANION_PADDLEOCR_PORT`（默认 18082）、`COMPANION_PADDLEOCR_DEVICE`、`COMPANION_PADDLEOCR_MODELS_DIR`

### 3.2 local-companion（Node 宿主）

- [x] `paddleOcrSupervisor.ts` — 启动 / 停止 Python 子进程，状态查询
- [x] `compute/paddleOcrAdapter.ts` — Volume I/O、调用 `:18082/v1/run`、写回 JSON / Markdown
- [x] `resolvePaddleOcrKeys` — 校验 `inputs.fileKey`、`outputKey`、`params.pipeline`
- [x] `probePaddleOcrBackendHealth` — 探测 `:18082/health`
- [x] `jobsStore.ts` — 注册 **`paddle_ocr`** Job 类型
- [x] `httpHandler.ts` — **`GET /v1/debug/paddleocr-health`**
- [x] `localEnginesRegistry.ts` — 本机引擎注册与 runtime-status 探测
- [x] `pluginRegistry.ts` — capabilities 摘要、`paddleOcr` 元数据
- [x] `main.ts` — HTTP 启动后 `startPaddleOcrIfConfigured()`，退出时 `stopPaddleOcrChild()`

### 3.3 桌面壳（companion-desktop）

- [x] `paddleocr-bootstrap/paddleocr-bootstrap.cjs` — Windows 一键 `pip install paddlepaddle(+gpu) paddleocr`
- [x] 安装前 **`mkdir(userRoot)`**（修复 cwd 不存在导致 `exit=null`）
- [x] import 校验 **`shell: false`**（修复 Windows cmd 吞引号）
- [x] 写入 `paddleocr-runtime/state.json`
- [x] `main.cjs` — IPC `shell-paddleocr-desktop-state`、`shell-paddleocr-bootstrap-run`
- [x] `main.cjs` — `applyDesktopPaddleOcrToEnv` 注入 `COMPANION_PADDLEOCR_PYTHON` / `SERVICE_DIR` / `DEVICE`
- [x] 安装成功后自动重启本机伴侣
- [x] `preload-shell.cjs` — `paddleOcrDesktopState`、`paddleOcrBootstrapRun`、安装日志事件
- [x] `shell/index.html` — OCR 区块：状态、GPU 复选框、一键安装、安装日志
- [x] `scripts/bundle-local-companion-runtime.cjs` — 打包时复制 `paddleocr-service` 进 `local-companion-bundle`
- [x] `companion-desktop/package.json` `extraResources` — 安装包另含 `paddleocr-bootstrap/` 与 `paddleocr-service/`（与 bundle 路径并列，供 Electron 资源解析）

### 3.4 主站前端 / 服务层

- [x] `services/companionClient/compute.ts` — `submitCompanionPaddleOcrJob` + 类型
- [x] `services/companionClient/probe.ts` — `probeCompanionPaddleOcrHealth`
- [x] `services/companionOcr.ts` — `runCompanionImageOcr`、`runCompanionDocumentImport` 门面
- [x] `services/storyboardCompanionOcrImport.ts` — 分镜 PDF/图片 → 纯文本
- [x] `components/storyboard/StoryboardTableBulkInput.tsx` — 「导入 PDF/图片」按钮与流程
- [x] `components/storyboard/StoryboardTableInputView.tsx` — 传递 `companionBaseUrl` / `companionProjectId`
- [x] `components/SettingsSection.tsx` — runtime-status OCR 摘要 + **「检查 OCR」** 按钮

### 3.5 测试

- [x] `tests/paddleOcrAdapter.test.ts` — `resolvePaddleOcrKeys` 单元测试
- [x] `tests/storyboardCompanionOcrImport.test.ts` — OCR 就绪探测 mock 测试
- [ ] 伴侣集成测试（真实 `:18082` 探测，CI 可选）
- [ ] 分镜导入 E2E 手测记录写入 [`网站与发布检查清单.md`](./网站与发布检查清单.md)

---

## 4. Job 契约（`paddle_ocr`）

### 4.1 提交

```http
POST /v1/compute/jobs
Content-Type: application/json

{
  "type": "paddle_ocr",
  "projectId": "<workspace-project-id>",
  "inputs": {
    "fileKey": "ocr/import-xxx.png",
    "outputKey": "ocr/import-xxx.json",
    "markdownOutputKey": "ocr/import-xxx.md"
  },
  "params": {
    "pipeline": "pp_ocr_v5",
    "lang": "ch",
    "returnFormat": "json"
  }
}
```

### 4.2 inputs / params 规则

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `inputs.fileKey` 或 `imageKey` | 是 | 须已 PUT 到当前 `projectId` Volume |
| `inputs.outputKey` | 是 | 写入 OCR JSON 结果 |
| `inputs.markdownOutputKey` | `returnFormat` 为 `markdown` / `both` 时必填 | PP-Structure Markdown |
| `params.pipeline` | 否，默认 `pp_ocr_v5` | `pp_ocr_v5` \| `pp_structure_v3` |
| `params.lang` | 否，默认 `ch` | 传给 PaddleOCR |
| `params.returnFormat` | 否 | `json` \| `markdown` \| `both`；`pp_structure_v3` 默认 `both` |

### 4.3 网站门面（推荐调用链）

```
StoryboardTableBulkInput
  → importStoryboardTextFromCompanionFile()
  → runCompanionImageOcr / runCompanionDocumentImport (companionOcr.ts)
  → putCompanionAsset → submitCompanionPaddleOcrJob → 同一 POST 内同步跑完 Adapter
  → fetchCompanionAssetBlob 读 outputKey JSON
```

**Job 执行语义**：`paddle_ocr` 与 `seam_repair` / `remove_bg` 相同——`POST /v1/compute/jobs` **在 HTTP 请求内 `await runPaddleOcrJob`**，响应里 `job.status` 已是 `completed` 或 `failed`；**网站侧无需轮询**（除非改用 SSE / events 做进度 UI）。

**输入体积**：须遵守伴侣 **`COMPANION_MAX_UPLOAD_BYTES`**（默认 100MB）；大 PDF 可能触发 PUT 或推理超时（默认 Adapter 600s）。

### 4.4 错误码（Adapter / 探测，待登记附录）

| code | 典型场景 |
| --- | --- |
| `COMPUTE_BAD_JOB` | 缺 `projectId`、缺 `fileKey`/`outputKey`、非法 `pipeline` |
| `COMPUTE_PADDLEOCR_BACKEND` | `:18082` 连接失败 / 服务未起 |
| `COMPUTE_PADDLEOCR_NOT_INSTALLED` | Python 环境缺 `paddleocr` / `paddlepaddle` |
| `COMPUTE_PADDLEOCR_BAD_INPUT` | 对 PDF 误用 `pp_ocr_v5` |
| `COMPUTE_PADDLEOCR_FAILED` | 其它 HTTP 500 / 推理错误 |
| `PADDLEOCR_PROBE_NOT_LOOPBACK` | `COMPANION_PADDLEOCR_URL` 非 127.0.0.1 / localhost |
| `PADDLEOCR_NOT_READY` / `EMPTY_OCR` | 网站分镜门面：health 未过或结果无文本 |
| `BAD_OCR_JSON` | 网站读回 outputKey 后 JSON 解析失败 |

完整登记见 §9 → [`附录-伴侣错误码.md`](./附录-伴侣错误码.md)。

---

## 5. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `COMPANION_PADDLEOCR_URL` | `http://127.0.0.1:18082` | Adapter 调用的服务根 URL（须为本机回环，否则 health 探测报 `PADDLEOCR_PROBE_NOT_LOOPBACK`） |
| `COMPANION_PADDLEOCR_PORT` | `18082` | Python 服务监听端口 |
| `COMPANION_PADDLEOCR_DEVICE` | `cpu` | `cpu` \| `gpu` |
| `COMPANION_PADDLEOCR_PYTHON` | （空则回退 `COMPANION_REMBG_PYTHON`） | Python 可执行文件；**有值且 `server.py` 存在** 时 supervisor 才会随伴侣拉起 OCR 子进程 |
| `COMPANION_PADDLEOCR_SERVICE_DIR` | 仓库 / 打包 `paddleocr-service` | `server.py` 所在目录 |
| `COMPANION_PADDLEOCR_SERVER_SCRIPT` | `{SERVICE_DIR}/server.py` | 显式脚本路径 |
| `COMPANION_PADDLEOCR_MODELS_DIR` | `{SANDBOX}/models/paddleocr` | 模型缓存 |
| `COMPANION_PADDLEOCR_TIMEOUT_MS` | `600000` | Adapter 调 `:18082/v1/run` 超时 |
| `COMPANION_SPAWN_PADDLEOCR_CMD` | （空） | 非空则完全覆盖默认 `"<python>" "<server.py>"` shell 启动串 |
| `COMPANION_SPAWN_PADDLEOCR_CWD` | `COMPANION_PADDLEOCR_SERVICE_DIR` | OCR 子进程工作目录 |
| `COMPANION_SANDBOX_ROOT` | 桌面壳注入 | 伴侣默认卷与 `models/paddleocr` 推导 |
| `AC_COMPANION_SANDBOX_ROOT` | — | **bootstrap 必填**（与 SamLocal/rembg 相同） |
| `AC_PADDLEOCR_USER_ROOT` | — | bootstrap 必填；写入 `state.json` 的目录 |
| `AC_PADDLEOCR_GPU=1` | — | 仅 bootstrap：安装 `paddlepaddle-gpu` 而非 CPU 版 |

桌面壳安装完成后，`state.json` 中的 `pythonExe` / `device` 会通过 `applyDesktopPaddleOcrToEnv` 写入伴侣子进程环境。

---

## 6. 用户路径与验收

### 6.1 Windows 首次安装（用户步骤）

1. 桌面伴侣 → 完成 **SamLocal 或 rembg** 一键安装（共用 Python）
2. 桌面伴侣 → **OCR / 文档解析** → 可选 GPU → **一键安装**
3. 安装日志出现 **`paddleocr ok`** → 伴侣自动重启
4. 设置页 **检查 OCR** 或访问 `GET :18082/health` 确认就绪
5. **首次 OCR/PDF 推理**可能额外下载模型到 `models/paddleocr\`（需网络，耗时数分钟属正常）

> 打包版安装包需 **重新 pack** 才内置最新 bootstrap；开发态直接读仓库内脚本。

### 6.2 网站侧验收

| 步骤 | 预期 | 状态 |
| --- | --- | --- |
| 设置 → 本地伴侣 → **检查 OCR** | 返回 `ok: true` 与 device / pipelines | [x] 已实现 |
| 分镜表 → 批量输入 → **导入 PDF/图片** | PDF 走 structure，图片走 OCR，文本填入输入框 | [x] 已实现 |
| 导入后点 **解析** | 走既有 `parseStoryboardTextWithPreset` 写入行 | [x] 依赖既有解析链 |
| 未配对伴侣 / 无 projectId | 按钮禁用或明确提示 | [x] 已实现 |

### 6.3 调试端点

```http
GET http://127.0.0.1:18765/v1/debug/paddleocr-health
GET http://127.0.0.1:18082/health
```

---

## 7. 故障排除（已知问题）

### 7.1 一键安装第一步 `命令失败 exit=null`

| 项 | 说明 |
| --- | --- |
| **现象** | 日志停在 `pip install --upgrade pip`，`exit=null` |
| **原因** | bootstrap 的 `cwd` 指向尚未创建的 `paddleocr-runtime` 目录 |
| **修复** | [x] 已在 bootstrap 开头 `mkdir(userRoot)`（2026-06-04） |
| **涉及文件** | `companion-desktop/paddleocr-bootstrap/paddleocr-bootstrap.cjs` |

### 7.2 import 校验 `SyntaxError: invalid syntax`

| 项 | 说明 |
| --- | --- |
| **现象** | `python -c from paddleocr import ...` 无引号 |
| **原因** | Windows `shell: true` 下 cmd 吞掉 `-c` 参数引号 |
| **修复** | [x] 校验步骤显式 `{ shell: false }` |

### 7.3 未找到共享 Python

| 项 | 说明 |
| --- | --- |
| **现象** | 「请先在桌面伴侣中完成 SamLocal 或 rembg 的一键安装」 |
| **处理** | 先装 SamLocal / rembg，再装 OCR |

### 7.4 OCR 服务未就绪

| 项 | 说明 |
| --- | --- |
| **现象** | 设置页检查 OCR 失败；分镜提示「PaddleOCR 未就绪」 |
| **排查** | ① 一键安装是否成功 ② 伴侣是否重启 ③ `18082` 是否被占用 ④ `COMPANION_PADDLEOCR_PYTHON` 是否指向已装 paddle 的解释器 ⑤ 查看伴侣控制台 / `local-companion-spawn.log` 中 Python stderr |

### 7.5 首次推理很慢或超时

| 项 | 说明 |
| --- | --- |
| **现象** | health 正常，但第一次 OCR/PDF 任务卡住或超过前端等待 |
| **原因** | PaddleOCR 首次运行从网络拉取模型到 `models/paddleocr\` |
| **处理** | 保持网络畅通；必要时调大 `COMPANION_PADDLEOCR_TIMEOUT_MS`；大 PDF 注意 `COMPANION_MAX_UPLOAD_BYTES` |

---

## 8. 源码索引

| 区域 | 路径 |
| --- | --- |
| Python 服务 | `local-companion/paddleocr-service/server.py` |
| Supervisor | `local-companion/src/paddleOcrSupervisor.ts` |
| Adapter | `local-companion/src/compute/paddleOcrAdapter.ts` |
| Job 注册 | `local-companion/src/compute/jobsStore.ts` |
| Bootstrap | `companion-desktop/paddleocr-bootstrap/paddleocr-bootstrap.cjs` |
| 桌面壳 IPC / UI | `companion-desktop/main.cjs`、`shell/index.html`、`preload-shell.cjs` |
| 网站 OCR 门面 | `services/companionOcr.ts` |
| 分镜导入 | `services/storyboardCompanionOcrImport.ts`、`components/storyboard/StoryboardTableBulkInput.tsx` |
| 设置页自检 | `components/SettingsSection.tsx` |
| 单测 | `tests/paddleOcrAdapter.test.ts`、`tests/storyboardCompanionOcrImport.test.ts` |

---

## 9. 后续 backlog（未勾选 = 待做）

### P1 — 稳定性与发布

- [ ] 打包桌面应用并验证 **内置 bootstrap + paddleocr-service**
- [ ] 补充 [`附录-伴侣错误码.md`](./附录-伴侣错误码.md) 中 `paddle_ocr` / `PADDLEOCR_*` 映射
- [ ] [`网站与发布检查清单.md`](./网站与发布检查清单.md) 增加 OCR 手测条目
- [ ] 错题本记录 bootstrap cwd 问题（防再犯）

### P2 — 体验与产品化（见路线图 §6）

- [ ] 合成「本机能力」主状态条纳入 OCR（与 SAM / rembg 统一）
- [ ] 安装失败人话映射（勿裸展示 `exit=null`）
- [ ] 非 Windows 引导向导（非仅 shell 内 mono 提示）

### P3 — 能力扩展

- [ ] macOS / Linux bootstrap 或文档化标准 venv 流程
- [ ] 工作流节点：`paddle_ocr` 接入 `workflowRunTaskBranch`（若产品需要）
- [ ] 通用「图片认字」入口（非分镜表场景）
- [ ] `openapi.yaml` for `paddleocr-service`
- [ ] GPU 安装失败回退 CPU 的自动策略

---

## 10. 本地开发命令

```powershell
# 仓库根：重启桌面伴侣（改 companion-desktop / local-companion 后）
# PowerShell 5.x 勿用 `&&`；用分号或单独一行
Set-Location f:\AI\assetcutter-ai-pro
npm run restart:local-companion

# 手动跑 bootstrap（与桌面壳相同环境变量）
$env:AC_COMPANION_SANDBOX_ROOT = "$env:LOCALAPPDATA\AssetCutterCompanion\sandbox"
$env:AC_PADDLEOCR_USER_ROOT = "$env:LOCALAPPDATA\AssetCutterCompanion\desktop-shell\paddleocr-runtime"
$env:AC_PADDLEOCR_GPU = "0"
node companion-desktop/paddleocr-bootstrap/paddleocr-bootstrap.cjs

# 单测
npx vitest run tests/paddleOcrAdapter.test.ts
npx vitest run tests/storyboardCompanionOcrImport.test.ts
```

---

**文档维护**：实现项完成后将 §3 对应 `[ ]` 改为 `[x]`；架构变更时同步 [`交接文档.md`](./交接文档.md) 与 [`本地伴侣-本地程序开发.md`](./本地伴侣-本地程序开发.md) 交叉链接。
