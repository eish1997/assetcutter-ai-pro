# 积分与定价 — Sprint 路线图（Sprint A 后）

> **状态**：2026-07-07 更新  
> **前置**：Sprint A 已落地（见 `docs/adr/定价与结算-v1.md`）、统一派发积分闸门 v2 Wave A～D  
> **产品原则**：对外固定档位 + 对内 USD 成本；一任务一账单；L5 只读不重算价

---

## 0. 已完成（Sprint A · 正确性）

| # | 交付 | 验收 |
|---|------|------|
| A1 | `PricingEngine` 单源算价 + 生图 perUnit floor | Flash 生图 `:out` ≥ 39 积分 |
| A2 | `proxyGateMinCreditsForJob` → `quoteGateMinCreditsForJob` | gate 与 catalog 同源 |
| A3 | L5 API：`/price-list` `/quote` `/receipt` | auth-api 200 + 单测 |
| A4 | 设置页「积分价目」Tab + SKU 展示名 | 用户可见价目表 |
| A5 | `billingPresentation` 展示层 | 流水非裸 SKU |
| A6 | 设置页黑屏修复 | `presentationLabelForEvent` 非对象渲染 |

**Sprint A 退出标准**：✅ 全部完成

**Sprint B/C 退出标准**：✅ 2026-07-07 验收通过（42 项定价/结算/Admin 单测 + vite build）

---

## 1. Sprint B — 可预期 + 单源（≈2 周）✅ 2026-07-07

**目标**：用户「提交前能看懂、事后能核对」；价目运行时单源；结算语义清晰。

### B1 · 任务小票 UI（P0，≈2d）✅

| 项 | 说明 |
|----|------|
| 交付 | 用量明细按 `taskId` 展开「任务小票」：`label` / `meterSummary` / 积分 |
| 消费 | `GET /api/usage/receipt?taskId=`（已有） |
| 文件 | `UsageTaskReceiptPanel.tsx` + `UsageEventsGroupedTable.tsx` |

### B2 · 全入口任务预估（P0，≈3d）✅

| 项 | 说明 |
|----|------|
| 交付 | `TaskCreditsEstimate` + `fmtCreditsEstimateFooter` |
| 入口 | 快捷栏、待执行队列、能力预设测试 |

### B3 · 余额不足标准化（P1，≈1d）✅

| 项 | 说明 |
|----|------|
| 交付 | `creditsExceededUserMessage(available, required)` 含差额 |

### B4 · `price_catalog` 运行时单源（P0 架构，≈3d）✅

| 项 | 说明 |
|----|------|
| 交付 | `014_price_catalog.sql` + `price-catalog-store.js`；`pricing-engine` 读 store |
| 快照 | `usage_events.catalog_version` |

### B5 · SettlementService 抽出（P1 架构，≈3d）✅

| 项 | 说明 |
|----|------|
| 交付 | `settlement-service.js`；`usage-billing-store` 委托结算 |

---

## 2. Sprint C — 可运营（≈2 周）✅ 2026-07-07

**目标**：运营改价不改代码；财务可看偏差。

### C1 · Admin 价目 CRUD（P0，≈4d）✅

- API：`GET/POST/PATCH /api/admin/price-catalog`（`pricing.write`）
- UI：`AdminPriceCatalogPanel.tsx` + `/admin/price-catalog`

### C2 · 对账报表 v1（P1，≈3d）✅

- `admin-usage-reconciliation.js` + Admin 用量页对账 Tab
- `GET /api/admin/usage-reconciliation`

### C3 · ESLint 边界（P1，≈1d）✅

- 组件禁止 import `usageBillingCatalog`；adapter 禁止直连 credit-store

### C4 · 价目 Tab 增强（P2，≈2d）✅

- 能力筛选 chip + BYOK 脚注

---

## 3. Sprint D — 体验深化（≈1～2 周，可选）

| # | 项 | 说明 |
|---|-----|------|
| D1 | 工作流完成态内嵌小票 | 任务结束 toast / 步骤时间线链 receipt |
| D2 | 项目级消耗列 | 工作区列表「本月积分」`?projectId=` 已有 API |
| D3 | 低余额站内提醒 | 阈值可配置 |
| D4 | 帮助页「积分 FAQ」 | PM 审阅一页纸 |
| D5 | 埋点 | 价目页访问、预估曝光率 |

---

## 4. 并行轨道（非阻塞）

| 轨道 | 文档 | 与积分关系 |
|------|------|------------|
| 即梦 M1 | `docs/即梦AI-仓库层接入开发文档.md` | 新 SKU 登记 + gate jobKind |
| 工作流审计 R1 | `docs/工作流审计优化计划.md` | Trace ↔ receipt 互链 |
| 用量 Phase 3 支付 | `docs/用量计费商业化开发清单.md` | Stripe 不在 B/C |

---

## 5. 里程碑日历（建议）

```
2026-07-07  Sprint A/B/C 完成 ─────────────────────────●
2026-08-04  Sprint D / 即梦 M1 择一                    ○
```

---

## 6. 测试矩阵（每 Sprint 必跑）

| 命令 | 范围 |
|------|------|
| `npx vitest run tests/pricingEngine.test.ts` | 算价 floor |
| `npx vitest run tests/meteringPipeline.test.ts` | L2 creditsCharged |
| `npx vitest run tests/aiBillingGate.test.ts` | 预估文案 |
| `npx vitest run tests/proxyCreditsGate.test.ts` | gate 阈值 |
| `npx vitest run tests/creditReserves.test.ts` | reserve（独立 auth-db.test.json） |
| `vite build` | 前端编译 |

**手测**：设置 → 用量明细 → 展开小票；快捷栏变体预估；Flash 生图流水 ≥39。

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-07 | Sprint B/C 全量落地 + 主 agent 验收 |
