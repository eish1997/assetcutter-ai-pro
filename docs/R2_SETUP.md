# Cloudflare R2 接入说明

本项目已提供 `server/r2-storage-api.js`，用于生成 R2 预签名上传/下载 URL，并提供对象列举与删除接口。

## 工作区在桶内的路径（按用户 + 项目分层）

登录用户开启云同步后（`VITE_WORKSPACE_CLOUD` 未设为 `false`），前端会将「工作区」数据写入：

| 对象键 | 说明 |
|--------|------|
| `users/<用户ID>/workspace/projects-index.json` | 项目列表与上次打开的项目 id |
| `users/<用户ID>/workspace/projects/<项目ID>/workflow.json` | 该项目工作流画布元数据（`version: 2` 时大图不在 JSON 内，仅存 R2 键） |
| `users/<用户ID>/workspace/projects/<项目ID>/assets/<资产ID>/...` | 原图、各步骤结果、切割组内图片等**独立对象**（二进制） |
| `users/<用户ID>/workspace/projects/<项目ID>/pending/<任务ID>.*` | 待处理队列缩略图（独立对象） |

未登录用户仍只使用浏览器 `localStorage`，不会写入上述路径。

删除项目时，前端会按前缀列举并删除该项目目录下**全部**对象（含 `workflow.json` 与上述 `assets/`、`pending/`），避免孤儿图片。

## 鉴权与多租户隔离

默认 `R2_ENFORCE_USER_SCOPE=true`：所有读写对象键必须位于当前会话用户目录 `users/<该用户 id>/` 下。

### 推荐：R2 挂在 Auth 同源（`/api/r2`）

生产环境会话 Cookie 为 **host-only**，浏览器不会把 `auth.example.com` 的 Cookie 发给另一个子域上的 R2 服务。因此 **推荐在 `auth-api` 进程内处理 `/api/r2/*`**（本仓库已内置）：直接用请求里的 Cookie 查会话，**无需**再配 `AUTH_ME_URL` 做回环。

- **Render**：在 **同一** `assetcutter-auth-api` Web Service 上增加 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET` 等即可。
- **前端**：构建时设置 `VITE_AUTH_API_BASE_URL=https://你的-auth.onrender.com`；**可不设** `VITE_R2_API_BASE_URL`（未设时 R2 请求与 auth 同源）。

### 独立 `r2-storage-api` 进程（仅高级/本地）

单独跑 `server/r2-storage-api.js` 时，通过请求 Cookie 调用 `AUTH_ME_URL`（默认 `http://127.0.0.1:9100/api/auth/me`）解析用户。请将 `AUTH_ME_URL` 设为公网可访问的 `https://你的-auth-api.onrender.com/api/auth/me`，且须注意 **跨域子域下 Cookie 往往无法带到 R2 域名**，一般仅适合本地或同机调试。

若仅本地调试 R2、不需要校验用户，可设 `R2_ENFORCE_USER_SCOPE=false`（**勿用于公网生产**）。

## 1) 准备 Cloudflare R2

1. 在 Cloudflare Dashboard 创建 R2 Bucket。
2. 创建 R2 API Token（S3 兼容）并拿到：
   - `Access Key ID`
   - `Secret Access Key`
3. 记录 Account ID 与 Bucket 名称。

## 2) 配置环境变量（`.env.local`）

```bash
R2_ACCOUNT_ID=你的_cloudflare_account_id
R2_ACCESS_KEY_ID=你的_r2_access_key_id
R2_SECRET_ACCESS_KEY=你的_r2_secret_access_key
R2_BUCKET=你的_bucket_name

# 可选：若你给 bucket 绑定了公网域名（Custom Domain）
R2_PUBLIC_BASE_URL=https://assets.example.com

# 可选
R2_API_PORT=9003
R2_API_BIND_HOST=0.0.0.0

# 与 auth-api 对齐：用于校验用户仅能访问 users/<自己 id>/
# AUTH_ME_URL=http://127.0.0.1:9100/api/auth/me

# 前端：关闭工作区云同步（仅 localStorage）
# VITE_WORKSPACE_CLOUD=false
```

## 3) 启动服务

**本地推荐（R2 挂在 auth，与线上一致）**：

1. 前端：`npm run dev`（Vite 把 `/api/r2` 代理到 **9100** 的 auth-api）  
2. 认证 + R2：在含 `R2_*` 的 `.env.local` 下执行 `node --env-file=.env.local server/auth-api.js`，或使用 `npm run dev:with-r2`（内部等同上述）

**可选**：单独起 `npm run dev:r2-api`（`9003`）时，需把 `vite.config.ts` 里 `/api/r2` 的 `target` 改回 `127.0.0.1:9003`，并配置 `AUTH_ME_URL` 指向本机 auth。

```bash
npm install
npm run dev:r2-api
```

健康检查：

```bash
GET http://localhost:9003/healthz
```

## 3.5) 必做：为 Bucket 配置 CORS（否则浏览器 PUT 会 403 / CORS error）

工作流云同步是：**浏览器拿到预签名 URL 后，直接向 `*.r2.cloudflarestorage.com` 发 `PUT` / `GET`**。  
若桶未允许你的前端来源，会出现 **CORS error**、预检 **OPTIONS** 失败或 **`PUT` 403**；而 **`/api/r2/upload-url` 仍可能是 200**（签名在自家服务器上生成成功）。

在 Cloudflare：**R2 → 你的 Bucket → 设置（Settings）→ CORS Policy**，填入例如（按实际端口/域名增删 `AllowedOrigins`）：

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

上线后把生产站点 `https://你的域名` 也加进 `AllowedOrigins`。保存后等约 1 分钟再试上传。

### upload-url / download-url 在 Network 里 500 或失败？

常见原因：

| 现象 | 处理 |
|------|------|
| **连接被拒绝**（未跑 `dev:r2-api`） | 另开终端执行 `npm run dev:r2-api`；看终端是否有 `[r2-storage-api] http://...` |
| **401 / 未登录** | 先登录；并保证 `auth-api` 已启动，Cookie 能命中 `AUTH_ME_URL` |
| **502 + R2 预签名失败** | 核对 `R2_ACCOUNT_ID`（账号 ID，非 Zone ID）、R2 的 S3 兼容 Access Key/Secret、`R2_BUCKET` 与控制台上的桶名**完全一致** |
| **`upload-url` 200 但直连 R2 的 `PUT` 403 / CORS** | 在 R2 **该 Bucket** 的 **CORS Policy** 里允许你的前端 Origin（见上文 §3.5） |
| **Vite 代理报错** | 更新后的开发代理在连不上 9003 时会返回 **503** 及 JSON 说明，可在 Response 里读 `error` 字段 |

## 4) 接口说明

### 4.1 生成上传 URL

`POST /api/r2/upload-url`

请求体：

```json
{
  "objectKey": "library/2026/03/example.png",
  "contentType": "image/png",
  "expiresIn": 600
}
```

返回：

```json
{
  "objectKey": "library/2026/03/example.png",
  "contentType": "image/png",
  "expiresIn": 600,
  "uploadUrl": "https://...",
  "publicUrl": "https://assets.example.com/library/2026/03/example.png"
}
```

随后前端直接 `PUT uploadUrl` 上传二进制内容，`Content-Type` 与请求体一致。

### 4.2 生成下载 URL

`POST /api/r2/download-url`

请求体：

```json
{
  "objectKey": "library/2026/03/example.png",
  "expiresIn": 600
}
```

### 4.3 列举对象

`GET /api/r2/objects?prefix=library/&maxKeys=100`

支持：
- `prefix`
- `maxKeys`（默认 50，上限 1000）
- `continuationToken`

### 4.4 检查对象是否存在

`GET /api/r2/objects/:objectKey`

### 4.5 删除对象

`DELETE /api/r2/objects/:objectKey`

## 5) 前端上传最小示例

```ts
async function uploadToR2(file: File) {
  const key = `library/${Date.now()}-${file.name}`;
  const signRes = await fetch('http://localhost:9003/api/r2/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      objectKey: key,
      contentType: file.type || 'application/octet-stream',
    }),
  });
  if (!signRes.ok) throw new Error(await signRes.text());
  const signed = await signRes.json();

  const putRes = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) throw new Error(`上传失败: ${putRes.status}`);

  return { key: signed.objectKey, publicUrl: signed.publicUrl };
}
```

