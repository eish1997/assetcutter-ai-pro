# 从 Cursor 到线上网站：一步步部署清单

适合开发新手，按顺序做即可。全程主要是「点网页 + 填几处内容」，不需要会命令行或服务器。

---

## 已帮你完成（可直接从「第一步」的推送开始）

- **Git 仓库已初始化**，并做了首次提交（提交说明：准备部署到 Vercel）。
- **确认 .env.local 不会被提交**（已由 .gitignore 忽略）。
- **本地构建已跑通**：`npm run build` 成功，生成 `dist/`。

**请你接下来做：** 在 Cursor 里把代码推到 GitHub，再到 Vercel 导入并部署（见下面第一步、第二步）。

---

## 你需要提前准备的

- **Node.js**：你已经在 Cursor 里跑过项目，说明已安装。
- **GitHub 账号**：没有的话去 [github.com](https://github.com) 注册一个（免费）。
- **Vercel 账号**：用 GitHub 登录即可，[vercel.com](https://vercel.com) 注册（免费）。

---

## 第一步：把项目推到 GitHub

这样 Vercel 才能「从网上拉你的代码并帮你构建」。

### 1.1 在 Cursor 里打开 Source Control

1. 左侧点 **Source Control**（分支图标）或按 `Ctrl+Shift+G`。
2. 若之前已让 Agent 执行过：仓库已初始化、已有一次提交，**直接做下面的 1.3 推送即可**。若没有，再按 1.2 做一次提交。

### 1.2 确认不要提交密钥文件

你的 `.env.local` 里有 API 密钥，**不能**传到 GitHub。  
项目里已用 `.gitignore` 忽略了 `*.local`，所以 `.env.local` 不会被提交，只要你别手动添加它即可。

### 1.3 推送到 GitHub

1. 在 Source Control 里点 **Publish Branch**（或 **Push**）：
  - 若让你选「Publish to GitHub」，选 **Public**，仓库名可以保持 `assetcutter-ai-pro`（或你喜欢的名字）。
  - 用 GitHub 账号登录/授权后，代码就会出现在你的 GitHub 仓库里。

记下你的仓库地址，形如：`https://github.com/你的用户名/assetcutter-ai-pro`。

---

## 第二步：用 Vercel 部署

### 2.1 导入项目

1. 打开 [vercel.com](https://vercel.com)，用 **GitHub 登录**。
2. 点 **Add New…** → **Project**。
3. 在列表里找到 **assetcutter-ai-pro**（或你刚推送的仓库名），点 **Import**。

### 2.2 配置构建（通常不用改）

Vercel 一般能自动识别 Vite 项目，你只需确认：


| 项                    | 填什么                 |
| -------------------- | ------------------- |
| **Framework Preset** | Vite（自动）            |
| **Build Command**    | `npm run build`（自动） |
| **Output Directory** | `dist`（自动）          |
| **Install Command**  | `npm install`（自动）   |


若某一项是空的，就按上表手动填。

### 2.3 添加环境变量（生图必配）

在 **Environment Variables** 区域：

1. **auth-api 与生图中继（必配，与 Render 线上一致）**  
   - `VITE_AUTH_API_BASE_URL` = `https://assetcutter-auth-api.onrender.com`  
   - 仓库内 `.env.production` 已含上述默认值；**若 Vercel 面板未配置会使用该默认**。生图请求经 auth-api 转发，避免浏览器直连 `*.onrender.com` 在某些网络下 `fetch failed`。
2. **试用 / Vertex 生图（必配，与 Render 线上一致）**  
   - `VITE_AI_WORKER_PROXY_API` = `https://assetcutter-ai-worker-proxy.onrender.com`
   - `VITE_AI_WORKER_PROXY_API_VERTEX` = `https://assetcutter-ai-worker-proxy.onrender.com`
   - 新部署统一使用 `VITE_AI_WORKER_PROXY_API` / `VITE_AI_WORKER_PROXY_API_VERTEX`；历史 `GEMINI_PROXY_*` / `BULK_IMAGE_*` 仅在服务端保留隐藏迁移兜底。
   - 仓库内 `.env.production` 已含上述默认值；**若 Vercel 面板里曾填过 `same-origin` 或前端自己的域名，请删掉或改成上面地址**，否则会覆盖默认值并导致其它电脑报 **405**。  
   - 改完后需 **Redeploy** 一次（`VITE_*` 在构建时写入 `dist`）。
2. 默认**不要**再添加 `GEMINI_API_KEY`（试用走云端代理上的密钥）。
3. 腾讯 3D 需要时再配 `VITE_TENCENT_PROXY`（并单独部署 `ai3d-proxy`）。

### 2.4 部署

1. 点 **Deploy**。
2. 等 1～3 分钟，页面会显示 **Congratulations** 和一个网址，例如：
  `https://assetcutter-ai-pro-xxxx.vercel.app`
3. 点该链接，或用手机、别的电脑打开这个网址——这就是你的线上网站。

---

## 第三步：以后更新网站怎么操作

每次你改完代码、想更新线上网站时：

1. 在 Cursor 的 Source Control 里 **Commit** 你的修改（写一句说明）。
2. 点 **Sync / Push** 推到 GitHub。
3. Vercel 会自动检测到推送，重新构建并发布，几分钟后新版本就生效（同一网址不变）。

---

## 可选：用 Netlify 而不是 Vercel

若你更想用 Netlify，流程类似：

1. 打开 [netlify.com](https://netlify.com)，用 GitHub 登录。
2. **Add new site** → **Import an existing project** → 选 **GitHub**，再选你的仓库。
3. 构建设置：
  - **Build command**：`npm run build`
  - **Publish directory**：`dist`
4. 若需要腾讯 3D，再添加 `VITE_TENCENT_PROXY`；Gemini 不建议作为站点环境变量注入前端。
5. 点 **Deploy site**，等完成后会给你一个 `xxx.netlify.app` 的网址。

---

## 常见问题

**Q：打开网站后，对话/生图没反应？**  
先到网站「设置」页填写 Gemini API Key；如刚填写过，重新触发一次操作即可，无需重新部署。

**Q：腾讯 3D 相关功能用不了？**  
当前部署只包含前端；腾讯 3D 需要单独部署 `server/ai3d-proxy.js` 并在环境变量里配置 `VITE_TENCENT_PROXY`。可以先把网站跑起来，需要时再按项目 DOCS 或单独问「如何部署 ai3d 代理」。

**Q：修复接缝（贴图修缝）部署到网站还能用吗？**  
**能。** 贴图修缝已支持在**浏览器内**用 Pyodide 运行同一套算法，部署成静态站后无需自建后端即可使用。首次点击「开始修复」会下载约 10MB 运行环境（仅一次）。若你额外部署了 WebSeamRepair 的 Python 后端并配置了 `VITE_SEAM_REPAIR_API`，前端会优先用 Pyodide，失败时自动回退到后端。

**Q：能用自己的域名吗？**  
可以。在 Vercel 项目里点 **Settings** → **Domains**，按提示添加你的域名即可。

**Q：.env.local 会不会被传到 GitHub？**  
不会。`.gitignore` 已忽略 `*.local`，所以不会被提交。密钥只在 Vercel 的 Environment Variables 里填，不要写进代码或提交到 Git。

---

按上面顺序做完「第一步 + 第二步」，你就从「只在 Cursor 里能跑」变成「有一个谁都能打开的网址」了。遇到某一步卡住，把卡住的那一步和提示信息发出来，可以继续排查。
