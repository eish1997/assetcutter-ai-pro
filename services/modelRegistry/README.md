# modelRegistry

多模型注册表、供应商 Binding 与运营合并（见 `docs/多模型可运营改造计划.md`、**`docs/模型中心与供应商绑定改造清单.md`**、**`docs/adr/模型中心与供应商绑定.md`**）。

工作流侧「门面→编排→闸门」键值与 **`WorkflowSection.runTask`** 分支判定见 **`services/workflowRunTaskBranch.ts`**（**`classifyWorkflowRunTaskBranch`**）；总索引见 **`services/workflowAiPickIndex.ts`**（及 **`docs/多模型可运营改造计划.md` §1.4**）。

## 运行时主路径

```text
registryId + role → pickBinding → resolveUpstream → geminiService.getClientForTask
```

用户启用 channel：`settingsStore.getEnabledChannels()`；凭证就绪：`isChannelReady(channel)`（`channelCredentials.ts`）。

| 模块 | 说明 |
|------|------|
| `types.ts` | `ModelFamily`、`ChannelId`、`ProviderBinding` |
| `constants.ts` | 默认 `modelText` / `modelImage` / `modelPro` |
| `imageModels.ts` | 生图 SKU 注册表、`DIALOG_IMAGE_GEARS` 数据源 |
| `textModels.ts` | 文本 SKU 注册表（最小集） |
| `providerBindings.ts` | 静态 binding 表 + family 级兜底 |
| `hubGraph/` | 枢纽节点类型、供应商输出口、`edges ↔ bindings` 编译 |
| `pickBinding.ts` | 按 priority 选第一条 ready binding（支持 ops `bindingOverrides` / `wiringEdges`） |
| `bindingRuntime.ts` | Vertex/AI Worker Proxy 等运行时 helper |
| `channelCatalog.ts` / `channelCredentials.ts` | channel UI 元数据与凭证检查 |
| `resolve.ts` | 按 binding.channel 解析上游 model id |
| `imageModelProvider.ts` | 生图 channel 级就绪与禁用原因 |
| `merge.ts` | 注册表 ∩ ready binding ∩ 运营 allowlist → 有效档位 |
| `opsTypes.ts` / `opsConfig.ts` | 运营 JSON（`VITE_MODEL_OPS_CONFIG_URL`） |
| `systemConfigMigrate.ts` | 读 `ac_config` 时校验生图槽位 |
| `log.ts` | `[model-registry]` 前缀日志 |

**Legacy**：`getAiProvider()` / `enabledAiProviders` 仍与 channel 双向同步，供云配置迁移；新代码勿依赖。

**阶段 4（非 Gemini 适配器）**：OpenAI 等经 `openaiAdapter.ts` + binding channel；调用仍走 `resolve` / `getClientForTask`。

## 新增 SKU 接线流程（枢纽节点）

1. **登记 HubOut**：在 `textModels.ts` 或 `imageModels.ts` 增加 `registryId` 与菜单文案。
2. **声明 HubIn**：`hubGraph/hubPorts.ts` 的 `buildHubInPorts()` 会自动从注册表生成 `{registryId}:{role}`。
3. **接 SupplierOutlet**：在 `providerBindings.ts` 为该 SKU 增加 binding 行（或通过 ops `wiringEdges` 覆盖）。
4. **用户侧**：设置页启用对应供应商输出口并填凭证；**型号接线**面板可预览生效链。

未出现在 binding / wiringEdges 中的供应商输出口保持空桩；HubIn 无 ready 边时 merge 层给出 `disabledReason`。
