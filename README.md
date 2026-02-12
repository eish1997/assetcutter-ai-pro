# AssetCutter AI Pro

基于 **Google Gemini** 与 **腾讯混元生3D** 的智能资产生产 Web 应用：提取花纹、贴图修缝、生成贴图、对话生图、生成3D、工作流与能力预设、资产仓库、提示词效果与擂台。

**技术栈：** React 19 + Vite 6 + TypeScript + @google/genai，样式为 Tailwind + 内联 CSS。

**项目形态：** 纯静态前端（SPA），部署后为静态站点；无服务端用户系统，设置与生成记录存于浏览器本地（localStorage）。详见 [DOCS.md](DOCS.md)。

---

## 目录

- [网站功能概览（侧栏结构）](#网站功能概览侧栏结构)
- [商店（能力包）](#商店能力包)
- [部署成网站](#部署成网站)
- [本地开发](#本地开发)
- [故障排查](#故障排查)
- [生成记录与提示词](#生成记录与提示词)
- [贴图修缝（WebSeamRepair）](#贴图修缝webseamrepair)

---

## 网站功能概览（侧栏结构）

| 入口 | 说明 |
|------|------|
| **工作流** | 多图筛选 → 拖拽/点选到功能框 → 待处理 → 一键执行 → 版本切换与归档 |
| **能力** | 功能预设管理（拆分组件、转风格、生成多视角等），工作流功能区调用此处配置 |
| **商店** | 远程「能力包」安装：从 JSON Catalog 拉取能力预设包，安装后合并到「能力」（同 id 覆盖），支持回滚历史版本 |
| **生成3D** | 腾讯混元生3D：文生/图生、智能拓扑、纹理生成、组件、UV、人物、格式转换（当前未上线） |
| **贴图**（组） | **提取花纹**：图案提取、无缝循环贴图；**贴图修缝**：OBJ + 贴图 + 可选 seam mask → 修缝；**生成贴图**：功能贴图 + 描述 → AI 生成 PBR Base Color / Roughness / Metallic |
| **对话生图** | 上传图片 + 描述需求 → AI 理解 → 生图模型出图（可选模型/尺寸、多会话、临时库） |
| **资产仓库** | 按类型筛选、查看/下载、多选批量下载、删除 |
| **提示词**（组） | **提示词效果**：生成记录与评分、结构化复现与导出；**提示词擂台**：A/B 对比测试 + 获胜片段库 |

详细功能与类型说明见 [DOCS.md](DOCS.md)。

---

## 商店（能力包）

「商店」用于**远程分发与更新能力预设（`CustomAppModule[]`）**。它会从一个 **Catalog JSON** 拉取“能力包”，安装后把包内能力**合并到本地「能力」列表（同 `id` 覆盖）**，并为每次安装保留**历史快照**以便回滚。

- **默认 Catalog 地址**：`https://cdn.jsdelivr.net/gh/eish1997/assetcutter-ai-pro-store@main/store/catalog.json`（也可在商店页面手动改成你自己的 Catalog）
- **本地示例（可选）**：`public/store/catalog.json` 与 `public/store/capability_pack_basic.json` 可用于离线演示/调试

---

## 部署成网站

若要把项目发布成线上可访问的网站，按 **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** 操作即可（GitHub → Vercel，全程点选 + 填几处配置）。

---

## 本地开发

**环境要求：** Node.js；使用贴图修缝时需安装 Python 3。

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1. 安装依赖 | `npm install` | 首次或 `package.json` 变更后执行 |
| 2. 配置环境变量 | 在 [.env.local](.env.local) 中设置 `GEMINI_API_KEY` 等 | 见下方「环境变量」 |
| 3. 启动主站（必选） | `npm run dev` | 打开 http://localhost:3000 使用整站 |
| 4. 贴图修缝后端（可选） | `npm run dev:seam-backend` | 仅在使用「贴图修缝」时需要，端口 8008 |
| 5. 腾讯 3D 代理（可选） | `npm run proxy` | 仅在使用「生成3D」时需要，端口 9001，需配置腾讯云密钥 |
| 一键启动主站 + 修缝 | `npm run dev:all` | 同时跑主站与贴图修缝后端（两个进程） |

**构建与预览：** `npm run build` 生成 `dist/`；`npm run preview` 本地预览构建结果。

**端口与代理：**

- 主站：`http://localhost:3000`（Vite）
- 贴图修缝 API：开发时由 Vite 代理 `/seam-repair-api` → `http://127.0.0.1:8008`；生产环境可设置 `VITE_SEAM_REPAIR_API` 为后端地址
- 腾讯 3D：开发时需单独运行 `npm run proxy`，前端设置 `VITE_TENCENT_PROXY=http://localhost:9001`；生产部署见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)

**环境变量（.env.local）：**

- `GEMINI_API_KEY`：对话生图、提取花纹、生成贴图等 AI 能力必填
- `VITE_SEAM_REPAIR_API`：生产环境贴图修缝后端地址（可选，开发时用代理即可）
- 腾讯混元生 3D：运行 `npm run proxy` 时需在 `.env.local` 或环境中设置 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`；前端用代理时需设置 `VITE_TENCENT_PROXY`（如 `http://localhost:9001`）。部署说明见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)

**首次使用贴图修缝时**，需在 `WebSeamRepair/backend` 安装 Python 依赖一次：

```bash
cd WebSeamRepair/backend
pip install -r requirements.txt
```

---

## 故障排查

- **主站打不开 / 白屏**：确认已执行 `npm install`，且端口 3000 未被占用。
- **贴图修缝点「开始修复」报错**：说明修缝后端未启动。执行 `npm run dev:seam-backend` 或 `npm run dev:all`；若提示找不到 `python`，请安装 Python 并先执行上文的 `pip install -r requirements.txt`。
- **生成 3D 报错 / CORS**：本地开发需运行 `npm run proxy` 并设置 `VITE_TENCENT_PROXY=http://localhost:9001`，且 `.env.local` 中配置好 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`。
- **生产部署**：见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)。贴图修缝若需上线，需单独部署 8008 后端并设置 `VITE_SEAM_REPAIR_API`；腾讯 3D 需单独部署代理并配置 `VITE_TENCENT_PROXY`。

---

## 生成记录与提示词

- **生成记录**：对话生图、提取花纹的生成记录存于前端 `localStorage`（`ac_generation_records`），由 `services/recordStore.ts` 读写，条数上限 500。详见 [docs/PROMPT_SCORING_DESIGN.md](docs/PROMPT_SCORING_DESIGN.md)。
- **提示词效果**：只读分析页，查看记录、评分、结构化复现与导出。
- **提示词擂台**：A/B 对比测试（选胜者替换编辑框）+ 获胜片段库。对比选择存 `ac_ab_choices`，片段库存 `ac_winning_snippets`。详见 [docs/PROMPT_OPTIMIZATION_AB_DESIGN.md](docs/PROMPT_OPTIMIZATION_AB_DESIGN.md)。

---

## 贴图修缝（WebSeamRepair）

侧栏 **贴图** 组内的 **贴图修缝** 使用本仓库内 `WebSeamRepair` 的算法（OBJ + 贴图 + 可选 seam mask → seam-aware 修复），**默认在浏览器内用 Pyodide 运行**，部署成静态站即可使用。

- **浏览器内计算**：首次点击「开始修复」会加载约 10MB 的 Pyodide（仅一次），之后修缝在本地完成。
- **可选 Python 后端**：可启动 `npm run dev:seam-backend` 并配置 `VITE_SEAM_REPAIR_API`，前端会优先尝试 Pyodide，失败时回退到后端。
- 算法与参数见 [WebSeamRepair/README.md](WebSeamRepair/README.md)。
