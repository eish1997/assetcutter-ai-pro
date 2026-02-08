# 从 Cursor 到线上网站：一步步部署清单

适合开发新手，按顺序做即可。全程主要是「点网页 + 填几处内容」，不需要会命令行或服务器。

---

## 你需要提前准备的

- [ ] **Node.js**：你已经在 Cursor 里跑过项目，说明已安装。
- [ ] **GitHub 账号**：没有的话去 [github.com](https://github.com) 注册一个（免费）。
- [ ] **Vercel 账号**：用 GitHub 登录即可，[vercel.com](https://vercel.com) 注册（免费）。

---

## 第一步：把项目推到 GitHub

这样 Vercel 才能「从网上拉你的代码并帮你构建」。

### 1.1 在 Cursor 里初始化 Git（如果还没做过）

1. 左侧点 **Source Control**（分支图标）或按 `Ctrl+Shift+G`。
2. 若提示「Initialize Repository」，点 **Initialize Repository**。
3. 若没有提示，看下面 1.2。

### 1.2 确认不要提交密钥文件

你的 `.env.local` 里有 API 密钥，**不能**传到 GitHub。  
项目里已用 `.gitignore` 忽略了 `*.local`，所以 `.env.local` 不会被提交，只要你别手动添加它即可。

### 1.3 提交并推送

1. 在 Source Control 里，在「Message」框输入：`准备部署到 Vercel`。
2. 点 **Commit**（或先点 **+** 把改动的文件暂存，再 Commit）。
3. 点 **Publish Branch**（或 **Push**）：
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

| 项 | 填什么 |
|----|--------|
| **Framework Preset** | Vite（自动） |
| **Build Command** | `npm run build`（自动） |
| **Output Directory** | `dist`（自动） |
| **Install Command** | `npm install`（自动） |

若某一项是空的，就按上表手动填。

### 2.3 添加环境变量（重要）

在 **Environment Variables** 区域：

1. **Name** 填：`GEMINI_API_KEY`
2. **Value** 填：你在本机 `.env.local` 里用的那个 Gemini API Key（整串复制过来）。
3. 环境选 **Production**（默认即可）。
4. 点 **Add**。

如果以后要用腾讯 3D，再在这里加 `VITE_TENCENT_PROXY`（那时再部署代理并填代理地址）。**第一次部署可以不加**，网站一样能打开，只是 3D 相关功能可能不可用。

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
4. **Advanced** → **New variable**：  
   Key：`GEMINI_API_KEY`，Value：你的密钥。
5. 点 **Deploy site**，等完成后会给你一个 `xxx.netlify.app` 的网址。

---

## 常见问题

**Q：打开网站后，对话/生图没反应？**  
检查 Vercel 里是否填了 `GEMINI_API_KEY`，且没有多余空格。改完后在 Vercel 的 Deployments 里点 **Redeploy** 再试。

**Q：腾讯 3D 相关功能用不了？**  
当前部署只包含前端；腾讯 3D 需要单独部署 `server/ai3d-proxy.js` 并在环境变量里配置 `VITE_TENCENT_PROXY`。可以先把网站跑起来，需要时再按项目 DOCS 或单独问「如何部署 ai3d 代理」。

**Q：能用自己的域名吗？**  
可以。在 Vercel 项目里点 **Settings** → **Domains**，按提示添加你的域名即可。

**Q：.env.local 会不会被传到 GitHub？**  
不会。`.gitignore` 已忽略 `*.local`，所以不会被提交。密钥只在 Vercel 的 Environment Variables 里填，不要写进代码或提交到 Git。

---

按上面顺序做完「第一步 + 第二步」，你就从「只在 Cursor 里能跑」变成「有一个谁都能打开的网址」了。遇到某一步卡住，把卡住的那一步和提示信息发出来，可以继续排查。
