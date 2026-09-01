# 第一性原理代码审查报告（第一轮）

## 评分卡
| 模块 | 正确性 | 安全与边界 | 可控性 | 可维护性 | 工程护栏 | 结论 |
|---|---:|---:|---:|---:|---:|---|
| `services/tencentService.ts` | 3 | 1 -> 3 | 2 | 3 | 2 -> 4 | 已把默认调用路径收敛到代理优先，浏览器直持密钥改为显式开启。 |
| `server/ai3d-proxy.js` | 3 | 1 -> 3 | 2 -> 4 | 3 | 2 -> 4 | 已补动作白名单、来源限制、模型主机校验、流式大小限制与超时。 |
| `services/capabilityExecutor.ts` | 2 -> 4 | 3 | 2 -> 4 | 3 | 2 -> 4 | 已修复“图无法继续执行却返回成功”的语义错误，并补图结构校验。 |
| `components/UnifiedModelViewer3D.tsx` | 2 -> 4 | 3 | 1 -> 4 | 3 | 2 -> 3 | 已补异步取消、竞态防护、对象 URL 与 WebGL 资源释放。 |
| `services/geminiService.ts` | 3 | 2 | 2 -> 4 | 3 | 2 -> 4 | 已停止对高成本生图/贴图请求的自动重放。 |
| `WebSeamRepair/backend/main.py` | 2 -> 4 | 2 -> 4 | 1 -> 4 | 3 | 2 -> 3 | 已补上传大小、图片尺寸、参数范围与更安全的错误返回。 |
| `WebSeamRepair/backend/seam_repair.py` | 2 -> 4 | 3 | 1 -> 4 | 3 | 2 -> 3 | 已补 OBJ/贴图/seam 复杂度护栏。 |

## 本轮主要发现
1. 前端默认暴露腾讯云凭证边界错误。
2. 代理存在 SSRF、任意动作转发和大模型 OOM 风险。
3. 能力集合执行在死锁或缺输入时会伪成功。
4. 3D 预览存在旧请求回写和资源泄漏风险。
5. 高成本 Gemini 请求自动重试可能导致重复计费或重复生成。
6. seam repair API 与算法层几乎没有输入上限，容易被大文件拖垮。

## 已落地修复
- 新增 [`docs/FIRST_PRINCIPLES_CODE_QUALITY.md`](docs/FIRST_PRINCIPLES_CODE_QUALITY.md)，固化第一性原理检查规范。
- 调整 [`vite.config.ts`](../vite.config.ts)，不再把腾讯云密钥注入前端运行时。
- 调整 [`services/settingsStore.ts`](../services/settingsStore.ts) 与 [`services/tencentService.ts`](../services/tencentService.ts)，腾讯云密钥改为会话级临时存储，默认仅走代理。
- 调整 [`App.tsx`](../App.tsx) 与 [`components/SettingsSection.tsx`](../components/SettingsSection.tsx)，UI 明确提示安全默认值，并把浏览器直持密钥改为显式不安全模式。
- 加固 [`server/ai3d-proxy.js`](../server/ai3d-proxy.js)，补动作白名单、CORS 来源控制、模型目标校验、流式限流与超时。
- 调整 [`scripts/start-seam-backend.js`](../scripts/start-seam-backend.js)，修复在 ESM 仓库中的运行时一致性问题。
- 调整 [`services/capabilityExecutor.ts`](../services/capabilityExecutor.ts)，补图结构校验、死锁失败返回，并优先裁剪最大检测框。
- 调整 [`components/UnifiedModelViewer3D.tsx`](../components/UnifiedModelViewer3D.tsx)，补 abort、stale guard 与 GPU 资源释放。
- 调整 [`services/geminiService.ts`](../services/geminiService.ts)，对高成本请求禁用自动重试。
- 调整 [`WebSeamRepair/backend/main.py`](../WebSeamRepair/backend/main.py)、[`WebSeamRepair/backend/seam_repair.py`](../WebSeamRepair/backend/seam_repair.py)、[`public/py/seam_repair.py`](../public/py/seam_repair.py)，补上传、尺寸、参数、OBJ 与 seam 数量上限。
- 更新 [`README.md`](../README.md)、[`DOCS.md`](../DOCS.md)、[`.env.example`](../.env.example) 以匹配新的边界策略。

## 新增工程护栏
- `npm run typecheck`：使用 [`tsconfig.quality.json`](../tsconfig.quality.json) 对本轮高风险改动范围做聚焦类型检查。
- `npm run lint`：使用 [`eslint.config.js`](../eslint.config.js) 对本轮关键文件执行静态检查。
- `npm run test`：使用 `Vitest` 运行关键路径测试。
- 新增测试：
  - [`tests/capabilityExecutor.test.ts`](../tests/capabilityExecutor.test.ts)
  - [`tests/tencentService.test.ts`](../tests/tencentService.test.ts)

## 验证结果
- `npm run typecheck` 通过
- `npm run lint` 通过（仍有历史 warning，未阻塞）
- `npm run test` 通过

## 剩余风险
- [`App.tsx`](../App.tsx) 仍然过大，存在大量历史 warning 和状态耦合，建议后续拆分。
- 全仓仍未建立覆盖更广的严格类型基线；当前 `typecheck` 属于“增量护栏”，不是全仓清零。
- `public/py/seam_repair.py` 与后端版仍是双份维护，虽然本轮同步了护栏，但长期仍建议收敛为单一可信来源。
