<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1X85oLtgKyGAQwJ2YF66PMp69Bleo4dWZ

## 部署成网站（新手向）

若你想把项目发布成线上可访问的网站，按 **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** 里的步骤操作即可（GitHub → Vercel，全程点选 + 填几处配置）。

---

## 本地开发启动清单

**环境要求：** Node.js；使用贴图修缝时需安装 Python 3。

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1. 安装依赖 | `npm install` | 首次或 `package.json` 变更后执行 |
| 2. 配置环境变量 | 在 [.env.local](.env.local) 中设置 `GEMINI_API_KEY` 等 | 见下方「环境变量」 |
| 3. 启动主站（必选） | `npm run dev` | 打开 http://localhost:3000 使用整站 |
| 4. 贴图修缝后端（可选） | `npm run dev:seam-backend` | 仅在使用侧栏「贴图修缝」时需要，端口 8008 |
| 一键启动主站 + 修缝 | `npm run dev:all` | 同时跑主站与贴图修缝后端（两个进程） |

**端口与代理：**

- 主站：`http://localhost:3000`（Vite）
- 贴图修缝 API：开发时由 Vite 代理 `/seam-repair-api` → `http://127.0.0.1:8008`；生产环境可设置 `VITE_SEAM_REPAIR_API` 为后端地址

**环境变量（.env.local）：**

- `GEMINI_API_KEY`：对话生图 / 提取花纹等 AI 能力必填
- `VITE_SEAM_REPAIR_API`：生产环境贴图修缝后端地址（可选，开发时用代理即可）
- 腾讯云相关：生成 3D 等能力见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)

**首次使用贴图修缝时**，需在 `WebSeamRepair/backend` 安装 Python 依赖一次：

```bash
cd WebSeamRepair/backend
pip install -r requirements.txt
```

---

### 故障排查

- **主站打不开 / 白屏**：确认已执行 `npm install`，且端口 3000 未被占用。
- **贴图修缝点「开始修复」报错 / 网络错误**：说明修缝后端未启动。在项目根目录执行 `npm run dev:seam-backend`，或使用 `npm run dev:all` 一并启动；若提示找不到 `python`，请安装 Python 并先执行上文的 `pip install -r requirements.txt`。
- **生产部署**：见 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)。贴图修缝若需上线，需单独部署 8008 后端并在构建环境设置 `VITE_SEAM_REPAIR_API`。

## 升级触发条件（生成记录存储）

当前生成记录（对话生图、提取花纹）存储于前端 `localStorage`（key: `ac_generation_records`），仅通过 `services/recordStore.ts` 读写，条数上限 500。当出现以下任一情况时，应启动**后端存储与 recordStore 实现迁移**：

- 记录数接近 500 且需要保留更久；
- 需要多设备/多用户共享记录；
- 需要产品内 A/B、模型评分等依赖服务端的能力。

迁移时仅替换 recordStore 的实现（如改为调用后端 API），记录结构与调用方保持不变。详见 [docs/PROMPT_SCORING_DESIGN.md](docs/PROMPT_SCORING_DESIGN.md)。

## 提示词优化（双入口）

- **提示词效果**：只读分析页，查看生成记录、评分、结构化复现与导出。
- **提示词擂台**：快速 A/B 对比测试（选两段变体生图对比、选胜者替换编辑框）+ 获胜片段库（点击插入光标）。

两入口在侧栏同组展示并互相引流；对比选择存 `ac_ab_choices`，片段库存 `ac_winning_snippets`，仅通过对应 store 读写。详见 [docs/PROMPT_OPTIMIZATION_AB_DESIGN.md](docs/PROMPT_OPTIMIZATION_AB_DESIGN.md)。

## 贴图修缝（WebSeamRepair）

侧栏 **贴图修缝** 使用本仓库内 `WebSeamRepair` 的算法（OBJ + 贴图 + 可选 seam mask → seam-aware 修复），**默认在浏览器内用 Pyodide 运行**，部署成静态站即可使用、无需自建后端。

- **浏览器内计算**：首次点击「开始修复」会加载约 10MB 的 Pyodide 运行环境（仅一次），之后修缝在本地完成。
- **可选 Python 后端**：若需更快或更稳，可启动 `npm run dev:seam-backend` 并配置 `VITE_SEAM_REPAIR_API`，前端会优先尝试 Pyodide，失败时回退到后端。
- **算法与参数说明**：见 [WebSeamRepair/README.md](WebSeamRepair/README.md)。
