<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1X85oLtgKyGAQwJ2YF66PMp69Bleo4dWZ

## 部署成网站（新手向）

若你想把项目发布成线上可访问的网站，按 **[DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)** 里的步骤操作即可（GitHub → Vercel，全程点选 + 填几处配置）。

---

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 升级触发条件（生成记录存储）

当前生成记录（对话生图、贴图工坊）存储于前端 `localStorage`（key: `ac_generation_records`），仅通过 `services/recordStore.ts` 读写，条数上限 500。当出现以下任一情况时，应启动**后端存储与 recordStore 实现迁移**：

- 记录数接近 500 且需要保留更久；
- 需要多设备/多用户共享记录；
- 需要产品内 A/B、模型评分等依赖服务端的能力。

迁移时仅替换 recordStore 的实现（如改为调用后端 API），记录结构与调用方保持不变。详见 [docs/PROMPT_SCORING_DESIGN.md](docs/PROMPT_SCORING_DESIGN.md)。

## 提示词优化（双入口）

- **提示词效果**：只读分析页，查看生成记录、评分、结构化复现与导出。
- **提示词擂台**：快速 A/B 对比测试（选两段变体生图对比、选胜者替换编辑框）+ 获胜片段库（点击插入光标）。

两入口在侧栏同组展示并互相引流；对比选择存 `ac_ab_choices`，片段库存 `ac_winning_snippets`，仅通过对应 store 读写。详见 [docs/PROMPT_OPTIMIZATION_AB_DESIGN.md](docs/PROMPT_OPTIMIZATION_AB_DESIGN.md)。
