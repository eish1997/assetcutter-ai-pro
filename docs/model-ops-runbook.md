# 生图运营配置 Runbook（`VITE_MODEL_OPS_CONFIG_URL`）

面向运维与研发：在不发前端包的前提下，通过**远端 JSON** 调整对话/工作流生图**可见档位**与**回退顺序**。实现见 `services/modelRegistry/opsConfig.ts`、`merge.ts`；示例载荷见 `public/model-ops.example.json`。

---

## 1. 前置条件

| 项 | 说明 |
|----|------|
| 构建变量 | 前端构建时设置 **`VITE_MODEL_OPS_CONFIG_URL`**，值为**完整 HTTPS URL**（需对浏览器 **CORS 放行** `GET`，建议 `Cache-Control: no-store` 或客户端已用 `fetch(..., { cache: 'no-store' })`）。 |
| 条件请求（ETag / 304） | 客户端在**与当前站点同源**的运营 URL 上，会在后续拉取中带 **`If-None-Match`** / **`If-Modified-Since`**（以上次 200 响应头为准）；服务端若返回 **304**，则跳过 JSON 解析且不派发 UI 更新事件。跨域托管 JSON 时**不**附加这些头（避免非简单 `GET` 触发未配置的 CORS 预检）；需 304 能力时请用**同源反代**或确保 CDN 对 `OPTIONS` 与上述请求头放行。 |
| 未配置时 | 不请求远端，使用内存默认（等价于 `public/model-ops.example.json`：`allowlist` 不限制、`gearPreference` 为 standard → fast → pro 逻辑由合并层处理）。 |
| 合法模型 id | `imageRegistryAllowlist` 中的字符串必须是注册表已登记的 **`registryId`**，见 `services/modelRegistry/imageModels.ts`（未知 id 会被丢弃；若丢光则视为**不限制**并打 `[model-registry]` warn）。 |

---

## 2. JSON 字段（与代码一致）

```json
{
  "version": 1,
  "imageRegistryAllowlist": null,
  "gearPreference": ["standard", "fast", "pro"]
}
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `version` | number | 预留版本号；当前实现仅校验为数字，逻辑不随版本分支。 |
| `imageRegistryAllowlist` | `string[]` \| `null` \| 省略 | **`null` 或省略**：不限制，三档均可用（仍受渠道解析等约束）。**非空数组**：仅列表内的 `registryId` 对应的档位可用，其余档位 UI 禁用（`disabledReason`: 运营未开放该生图模型）。 |
| `gearPreference` | `"fast"` \| `"standard"` \| `"pro"` 数组 | 当前选中档位被运营禁用时，**按数组顺序**回退到第一个仍可用的档位（日志：`[model-registry] image gear coerced`）。 |

**防呆**：若运营规则导致**三档全部被禁**，合并层会**忽略限制**、回退为全量注册表，并打 **`[model-registry]` error**：`all image gears disabled by ops/provider rules; falling back to full registry`，避免工作流产线卡死。

---

## 3. 常见操作

### 3.1 紧急下架某一档（仅保留其余档）

1. 编辑托管的 JSON：将 `imageRegistryAllowlist` 设为仍允许开放的 **`registryId`** 列表（例如只保留快速档对应模型 id）。  
2. 保存并确保 URL 已更新（或 CDN 失效缓存）。  
3. 用户侧：**刷新页面**；或在 **设置** 中点击与运营配置相关的 **重新拉取**（调用 `refreshModelOpsConfig()`）。  
4. 验证：控制台/观测中可见 **`[model-registry] ops config loaded`**；被禁档位在生图相关下拉里为禁用态。

### 3.2 恢复全量（回滚运营限制）

1. 将 `imageRegistryAllowlist` 设为 **`null`**，或改为仅包含**已知**且希望保留的 id；若需与默认完全一致，可直接使用仓库内 **`public/model-ops.example.json`** 内容。  
2. 或将 **`VITE_MODEL_OPS_CONFIG_URL`** 置空并**重新构建/部署**前端（无 URL 则不再拉远端，回到内置默认）。  
3. 验证：三档均可选（在渠道与注册表允许的前提下）；日志无持续 error。

### 3.3 调整降级优先级（非下架）

修改 `gearPreference` 数组顺序即可，例如优先回退到 `fast`：  
`["fast", "standard", "pro"]`。

---

## 4. 排障

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 拉取不生效 | CORS、404、非 JSON | 浏览器 Network 看 `GET` 状态与响应体；服务端对 Origin 放行。 |
| 配置看似被忽略 | allowlist 里全是未知 id | 看 `[model-registry] ops imageRegistryAllowlist had no known ids; ignoring allowlist`。 |
| 三档突然又全开 | 触发了「全禁回退」防呆 | 查 `[model-registry] all image gears disabled`；修正 allowlist 至少保留一个合法档位。 |

---

## 5. 与阶段验收的对应关系

- **`docs/多模型可运营改造计划.md`** 阶段 3：不下发新前端即可改策略 —— 依赖本 URL 与托管 JSON。  
- **能力矩阵**（场景与槽位）：`docs/spec/model-capability-matrix.md`。

---

## 修订记录

| 日期 | 摘要 |
|------|------|
| 2026-05-06 | 初稿：字段说明、紧急下架/回滚、排障、与阶段 3 对应关系 |
| 2026-05-06 | 补充 **ETag / 304**、同源条件请求与跨域行为说明（实现见 `services/modelRegistry/opsConfig.ts`） |
