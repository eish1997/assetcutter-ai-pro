# R2 能力预设多源与管理员上传（开发文档）

## 目标

- 在现有能力商店机制上新增 R2 目录源，不替换原有主源。
- 能力页支持从多个 catalog 源拉取并合并展示。
- 管理员账号可在「能力预设卡片」一键上传当前预设到 R2。
- 上传时自动更新当前用户命名空间下的 `catalog.json`，便于团队共享拉取。

## 当前实现范围

### 1) 多源拉取

- 新增设置项：
  - `ac_store_catalog_url`（主源）
  - `ac_store_catalog_r2_url`（R2 源）
- 读取逻辑：
  - `getCapabilityStoreCatalogSources()` 返回去重后的源地址数组。
  - `useStoreCatalog()` 依次拉取各源 `catalog.json`，按 `id` 去重（同 id 保留先出现项）。
- 包 URL 解析：
  - 每个 catalog 项保留来源 base URL，支持 `./packs/xxx.json` 相对路径。

### 2) 管理员上传能力预设到 R2

- 能力卡片新增按钮：`上传R2`（仅管理员可见）。
- 点击后流程：
  1. 将当前预设序列化为单预设包（`CustomAppModule[]`，长度 1）。
  2. 上传到 `users/<adminUserId>/capability-store/presets/<presetId>.json`。
  3. 读取并更新 `users/<adminUserId>/capability-store/catalog.json`。
  4. 覆盖同 `id` 的 catalog 项并写回。
- catalog 项格式（示例）：
  - `id`: `preset_<presetId>`
  - `type`: `capability_presets`
  - `url`: `./presets/<presetId>.json`
  - `version`: 时间戳字符串

### 3) 安全边界（当前版本）

- 前端 UI 层只给管理员显示上传按钮。
- 上传仍复用 `/api/r2/upload-url` 与登录态，路径在当前用户命名空间下。
- 若需要“后端强制管理员权限校验”，应新增专用 API（后续建议见下文）。

## 涉及文件

- `services/settingsStore.ts`
  - 新增 R2 catalog 读写函数与多源聚合函数。
- `components/SettingsSection.tsx`
  - 设置页新增主源 + R2 源输入与保存。
- `services/storeCatalogHook.ts`
  - 支持多源 catalog 拉取、合并、按来源解析包 URL。
- `services/capabilityPresetR2Publish.ts`
  - 新增“上传预设 + 更新 catalog”服务。
- `components/CapabilityPresetSection.tsx`
  - 新增管理员上传按钮与上传状态。
- `App.tsx`
  - 传入 `canUploadToR2` 与 `currentUserId`。

## 配置要求

- 已启用 auth-api 并配置 R2：
  - `R2_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET`
- 建议配置公开读取基址（用于日志里的 public URL）：
  - `R2_PUBLIC_BASE_URL`
- R2 能力商店读取走同源接口：
  - `GET /api/r2/capability-store/catalog`
  - `GET /api/r2/capability-store/<relative-path>`
  - 后端通过 `R2_CAPABILITY_STORE_CATALOG_KEY`（默认 `public/capability-store/catalog.json`）定位目录根。

## 验收步骤

1. 管理员登录。
2. 设置页填写 R2 源 catalog URL 并保存。
3. 在能力页任一卡片点击 `上传R2`。
4. 查看日志出现“已上传到 R2”。
5. 刷新远程能力列表，确认其他账号配置相同 R2 源后可拉取到该能力。

## 下一步建议操作

1. **后端权限收敛（优先）**
   - 新增 `POST /api/r2/capability-preset/publish`，在后端 `requireAdmin` 后执行上传与 catalog 合并。
   - 前端不再直接拼 objectKey，减少越权面。

2. **统一官方目录（团队共享）**
   - 不再写 `users/<adminId>/...`，改为固定前缀如 `public/capability-store/...`。
   - 仅管理员 API 可写，所有人只读。

3. **版本策略**
   - `url` 改为带版本文件名（如 `./presets/<id>/<version>.json`），catalog 指向最新。
   - 保留旧版本以支持回滚。

4. **完整性校验**
   - 上传后计算 `sha256` 写入 catalog；客户端安装时比对。

5. **审核与发布流（可选）**
   - 投稿先入 `staging/`，管理员审核后再写入正式 catalog。
