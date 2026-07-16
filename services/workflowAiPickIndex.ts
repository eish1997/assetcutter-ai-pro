/**
 * 工作流「拣货路径」与货物大类闸门的**只读索引**（非运行时路由表）。
 * 说明见 `docs/多模型可运营改造计划.md` §1.4.2 / §1.4.3；PR 自检见 §1.4.4。
 * `WorkflowSection.runTask` 的分支判定与 **`classifyWorkflowRunTaskBranch`** 实现在 **`workflowRunTaskBranch.ts`**（本文件 re-export）。
 */

export {
  classifyWorkflowRunTaskBranch,
  WORKFLOW_SECTION_RUN_TASK_BRANCHES,
  type WorkflowRunTaskBranchId,
  type WorkflowSectionRunTaskBranch,
} from './workflowRunTaskBranch';

export type WorkflowAiPickLayer = 'menu' | 'pick' | 'gate' | 'supplier';

export interface WorkflowAiPickNode {
  readonly id: string;
  readonly layer: WorkflowAiPickLayer;
  readonly label: string;
  /** 便于检索的模块路径或符号（与文档表一致即可） */
  readonly codeRefs: readonly string[];
  readonly notes?: string;
}

export interface WorkflowAiPickEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface WorkflowAiCargoRow {
  readonly id: string;
  readonly cargoLabel: string;
  readonly primaryGate: string;
  readonly opsMeans: string;
  readonly remark?: string;
}

export type WorkflowAiExecutionRouteStatus = 'gateway' | 'legacy' | 'partial_gateway' | 'local' | 'admin_only';

export interface WorkflowAiExecutionEntryRow {
  readonly id: string;
  readonly entryLabel: string;
  readonly sourceRefs: readonly string[];
  readonly modalities: readonly string[];
  readonly routeStatus: WorkflowAiExecutionRouteStatus;
  readonly modelContract: 'canonical_model' | 'registry_id_only' | 'mixed' | 'not_applicable';
  readonly contextContract: 'complete' | 'partial' | 'missing' | 'not_applicable';
  readonly nextAction: string;
}

/** §1.4.3 Mermaid「门面菜单 → 拣货 → 闸门 → 供货商」节点 */
export const WORKFLOW_AI_PICK_NODES: readonly WorkflowAiPickNode[] = [
  {
    id: 'ui_facade',
    layer: 'menu',
    label: '预设 / 侧栏 / 设置 / 快捷条',
    codeRefs: ['CapabilityPresetSection', 'WorkflowSidebarColumn', 'WorkspaceQuickComposeBar', 'SettingsSection'],
  },
  {
    id: 'workflow_section',
    layer: 'pick',
    label: 'WorkflowSection 任务编排',
    codeRefs: ['components/WorkflowSection.tsx'],
  },
  {
    id: 'capability_executor',
    layer: 'pick',
    label: 'capabilityExecutor',
    codeRefs: ['services/capabilityExecutor.ts'],
  },
  {
    id: 'local_companion_sam',
    layer: 'supplier',
    label: '本地伴侣 sam_segment → SamLocal',
    codeRefs: [
      'services/lightboxSamSegment.ts',
      'services/companionClient/compute.ts',
      'local-companion/src/compute/samSegmentAdapter.ts',
    ],
    notes: '不经 unifiedAiGateway；预设 companionSamSegment / 大图点选',
  },
  {
    id: 'app_3d_workflow_loop',
    layer: 'pick',
    label: 'App 工作流内 3D 闭环（生成/归档/重拉/下载）',
    codeRefs: [
      'App.tsx',
      'services/persistWorkflow3dSlots.ts',
      'services/workflowModelSlots.ts',
      'services/workflowGenerate3dAssetPatch.ts',
      'services/workflow3dCompanionHydrate.ts',
      'services/downloadModelFile.ts',
      'services/workflowTripoModelRehydrate.ts',
      'services/workflowTencentModelRehydrate.ts',
      'components/WorkflowSection.tsx',
    ],
    notes: '独立生成3D页已移除；伴侣槽位为字节真相',
  },
  {
    id: 'workflow_3d_companion_slots',
    layer: 'gate',
    label: 'workflowModelSlots + 伴侣卷 I/O',
    codeRefs: [
      'services/workflowModelSlots.ts',
      'services/workflowCompanionAssets.ts',
      'services/workflow3dCompanionHydrate.ts',
      'services/companionClient/storage.ts',
    ],
    notes: 'stepModelCompanionKeys 真相源；hydrate / attachment 下载',
  },
  {
    id: 'unified_ai_gateway',
    layer: 'gate',
    label: 'unifiedAiGateway',
    codeRefs: ['services/unifiedAiGateway.ts', 'services/unifiedAiSoftNotice.ts'],
    notes: 'runMeteredAiCall → aiDispatchGate.gateBeforeUpstream',
  },
  {
    id: 'ai_dispatch_gate',
    layer: 'gate',
    label: 'aiDispatchGate + billingRoute（派发单点闸门）',
    codeRefs: [
      'services/aiDispatchGate.ts',
      'shared/billingRoute.ts',
      'shared/billingDecision.ts',
      'services/aiBillingGate.ts',
    ],
    notes: 'resolveBillingRoute 规则单源；platform reserve；L2 billingDecision',
  },
  {
    id: 'generate3d_module',
    layer: 'gate',
    label: 'services/generate3d（3D 任务适配）',
    codeRefs: ['services/generate3d/'],
    notes: 'ESLint 允许的 tripo/tencent 直连例外目录',
  },
  {
    id: 'workflow_video_bridge',
    layer: 'gate',
    label: 'workflowVideoBridge',
    codeRefs: ['services/workflowVideoBridge.ts'],
  },
  {
    id: 'model_registry_pick',
    layer: 'pick',
    label: 'modelRegistry（pickBinding / resolve / channel）',
    codeRefs: [
      'services/modelRegistry/pickBinding.ts',
      'services/modelRegistry/providerBindings.ts',
      'services/modelRegistry/resolve.ts',
      'services/modelRegistry/bindingRuntime.ts',
      'services/modelRegistry/channelCredentials.ts',
    ],
    notes: 'registryId + role → ready channel → upstream id；见 docs/adr/模型中心与供应商绑定.md',
  },
  {
    id: 'gemini_service_stack',
    layer: 'supplier',
    label: 'geminiService（getClientForTask / 适配器）',
    codeRefs: ['services/geminiService.ts'],
    notes: '内部 pickBinding；不再以 getAiProvider() 单选分支为主路径',
  },
  {
    id: 'ai_worker_proxy_fairness_chain',
    layer: 'supplier',
    label: 'Gemini 代理公平排队（可选 · HTTP/运维层）',
    codeRefs: [
      'services/geminiFairnessBridge.ts',
      'services/aiWorkerProxyFairnessError.ts',
      'services/unifiedAiSoftNotice.ts',
      'components/GeminiFairnessFloatingNotice.tsx',
      'server/ai-worker-proxy-fairness.js',
      'server/ai-worker-proxy-api.js',
      'server/auth-api.js',
      'components/admin/AdminGeminiFairnessPanel.tsx',
    ],
    notes: 'GEMINI_FAIRNESS_ENABLED；浏览器 X-AC-Fairness-Key；磁盘 JSON 与 /admin/gemini-fairness；与 Google 429 分层',
  },
  {
    id: 'tripo_service',
    layer: 'supplier',
    label: 'tripoService',
    codeRefs: ['services/tripoService.ts'],
    notes: '仅经网关或 generate3d',
  },
  {
    id: 'tencent_service',
    layer: 'supplier',
    label: 'tencentService',
    codeRefs: ['services/tencentService.ts'],
    notes: '仅经网关或 generate3d',
  },
  {
    id: 'http_video_bridge_upstream',
    layer: 'supplier',
    label: 'HTTP 生视频上游（VITE_WORKFLOW_VIDEO_API_URL）',
    codeRefs: ['VITE_WORKFLOW_VIDEO_API_URL'],
  },
  {
    id: 'jimeng_warehouse',
    layer: 'gate',
    label: 'services/jimeng（catalog / adapter / client）',
    codeRefs: [
      'services/jimeng/catalog.ts',
      'services/jimeng/adapter.ts',
      'services/jimeng/client.ts',
      'services/jimeng/pickJimengBinding.ts',
      'services/modelRegistry/jimengImageRegistry.ts',
      'services/modelRegistry/jimengVideoRegistry.ts',
      'services/modelRegistry/jimengDigitalHumanRegistry.ts',
    ],
    notes: 'W0 warehouseOnly；图类经 pickBinding(role=image)；视频/数字人经 pickJimengBinding',
  },
  {
    id: 'jimeng_server_proxy',
    layer: 'supplier',
    label: 'auth-api /api/jimeng + jimeng-visual-api',
    codeRefs: [
      'server/jimeng-visual-api.js',
      'server/jimeng-sign.js',
      'server/jimeng-credits-gate.js',
      'server/auth-api.js',
    ],
    notes: '站点 VOLCENGINE_* AK/SK；L1 credits-gate；Submit + Poll',
  },
  {
    id: 'volcengine_visual_upstream',
    layer: 'supplier',
    label: 'visual.volcengineapi.com（即梦 CV API）',
    codeRefs: ['visual.volcengineapi.com'],
  },
  {
    id: 'volcengine_ark_upstream',
    layer: 'supplier',
    label: '火山方舟（OpenAI 兼容）',
    codeRefs: ['volcengine-ark', 'https://ark.cn-beijing.volces.com/api/v3'],
    notes: '经 OpenAI-compatible adapter；与即梦 visual.volcengineapi.com 分离',
  },
];

/**
 * AI 执行入口审计表：用于判断“前端选了模型”是否真的能进入 Gateway route。
 * 这是只读架构索引，不参与运行时分发；更新规则见 docs/AI执行路由闭环架构审计.md。
 */
export const WORKFLOW_AI_EXECUTION_ENTRY_ROWS: readonly WorkflowAiExecutionEntryRow[] = [
  {
    id: 'quick_compose_text',
    entryLabel: '全局输入框 / 快捷生成 · 文生文',
    sourceRefs: ['components/WorkflowSection.tsx', 'components/WorkspaceQuickComposeBar.tsx'],
    modalities: ['text'],
    routeStatus: 'gateway',
    modelContract: 'canonical_model',
    contextContract: 'partial',
    nextAction: '已走 runUnifiedGeneration(text.generate) -> /api/ai/jobs；后续补流式和更细参数 schema。',
  },
  {
    id: 'project_agent_plain_text',
    entryLabel: 'Project Agent · run_plain_text',
    sourceRefs: [
      'services/projectAgent/planTools.ts',
      'services/projectAgent/planner.ts',
      'components/project-agent/mapPlanToQuickComposeInvoke.ts',
      'components/WorkflowSection.tsx',
    ],
    modalities: ['text'],
    routeStatus: 'gateway',
    modelContract: 'canonical_model',
    contextContract: 'partial',
    nextAction: '已随快捷文本入口创建 Gateway Job；后续补 Agent 子运行 job id 展示。',
  },
  {
    id: 'project_agent_current_view_qa',
    entryLabel: 'Project Agent · @当前画面 / run_plain_i2t',
    sourceRefs: [
      'components/project-agent/mapPlanToQuickComposeInvoke.ts',
      'services/projectAgent/contextAssembly.ts',
      'components/WorkflowSection.tsx',
    ],
    modalities: ['text', 'image', 'model3d', 'video'],
    routeStatus: 'gateway',
    modelContract: 'canonical_model',
    contextContract: 'partial',
    nextAction: '第 4 轮补 asset preview snapshot / asset id / version id 后走 vision.describe。',
  },
  {
    id: 'quick_compose_image',
    entryLabel: '全局输入框 / 快捷生成 · 文生图 / 图生图',
    sourceRefs: ['components/WorkflowSection.tsx', 'components/WorkspaceQuickComposeBar.tsx'],
    modalities: ['image'],
    routeStatus: 'gateway',
    modelContract: 'canonical_model',
    contextContract: 'partial',
    nextAction: '已走 runUnifiedGeneration(workflow_text_to_image / workflow_image_edit)；后续补局部重绘、分镜和 route schema。',
  },
  {
    id: 'capability_preset_execute',
    entryLabel: '能力预设执行 · 文 / 图 / 视频 / 3D',
    sourceRefs: ['services/capabilityExecutor.ts', 'components/CapabilityPresetSection.tsx'],
    modalities: ['text', 'image', 'video', 'model3d'],
    routeStatus: 'partial_gateway',
    modelContract: 'mixed',
    contextContract: 'partial',
    nextAction: '先统一 resolve 组覆盖、预设、全局默认，再按 capability 创建 Gateway Job。',
  },
  {
    id: 'storyboard_ai',
    entryLabel: '分镜表 · 重绘 / 拼图 / 角色替换 / 结构解析',
    sourceRefs: [
      'components/storyboard/StoryboardTablePanel.tsx',
      'services/storyboardTableRedraw.ts',
      'services/storyboardFeedbackSheetRedraw.ts',
      'services/storyboardRoleReplaceRedraw.ts',
      'services/storyboardTableParse.ts',
    ],
    modalities: ['text', 'image'],
    routeStatus: 'partial_gateway',
    modelContract: 'canonical_model',
    contextContract: 'partial',
    nextAction: '第 5 轮纳入统一请求，并保留 storyboardAssetId / rowId metadata。',
  },
  {
    id: 'workflow_video',
    entryLabel: '工作流 · 生视频',
    sourceRefs: ['services/unifiedAiGateway.ts', 'services/aiGatewayVideoExecution.ts'],
    modalities: ['video'],
    routeStatus: 'gateway',
    modelContract: 'canonical_model',
    contextContract: 'partial',
    nextAction: '继续补 route parameter schema；保留 legacy HTTP bridge 为显式 fallback。',
  },
  {
    id: 'workflow_3d',
    entryLabel: '工作流 · 生 3D',
    sourceRefs: ['services/generate3d/', 'services/unifiedAiGateway.ts', 'components/WorkflowSection.tsx'],
    modalities: ['model3d'],
    routeStatus: 'partial_gateway',
    modelContract: 'mixed',
    contextContract: 'partial',
    nextAction: '按 model3d.generate 统一任务结构，Tripo / 混元 / 方舟 3D 只作为 route。',
  },
  {
    id: 'local_sam_segment',
    entryLabel: '本机伴侣 · 智能分割',
    sourceRefs: ['services/lightboxSamSegment.ts', 'services/companionClient/compute.ts'],
    modalities: ['image'],
    routeStatus: 'local',
    modelContract: 'not_applicable',
    contextContract: 'complete',
    nextAction: '作为本地工具例外保留，不进入 AI Gateway。',
  },
  {
    id: 'admin_route_test',
    entryLabel: '管理端 · Route Test / 可用性摘要',
    sourceRefs: ['components/admin/AdminProviderKeysPanel.tsx', 'server/ai-gateway/model-availability-summary.js'],
    modalities: ['text', 'image', 'video', 'model3d', 'music'],
    routeStatus: 'admin_only',
    modelContract: 'canonical_model',
    contextContract: 'not_applicable',
    nextAction: '继续区分 Key / Model / Route / Artifact 测试层级，避免误认为真实生成通过。',
  },
];

/** §1.4.3 推荐依赖边（from → to） */
export const WORKFLOW_AI_PICK_EDGES: readonly WorkflowAiPickEdge[] = [
  { id: 'edge_ui_ws', from: 'ui_facade', to: 'workflow_section' },
  { id: 'edge_ui_ce', from: 'ui_facade', to: 'capability_executor' },
  { id: 'edge_ws_ce', from: 'workflow_section', to: 'capability_executor' },
  { id: 'edge_ws_app3d', from: 'workflow_section', to: 'app_3d_workflow_loop' },
  { id: 'edge_ce_ug', from: 'capability_executor', to: 'unified_ai_gateway' },
  { id: 'edge_ce_lcsam', from: 'capability_executor', to: 'local_companion_sam' },
  { id: 'edge_app_g3', from: 'app_3d_workflow_loop', to: 'generate3d_module' },
  { id: 'edge_app_slots', from: 'app_3d_workflow_loop', to: 'workflow_3d_companion_slots' },
  { id: 'edge_app_ug', from: 'app_3d_workflow_loop', to: 'unified_ai_gateway' },
  { id: 'edge_ug_fair', from: 'unified_ai_gateway', to: 'ai_worker_proxy_fairness_chain' },
  { id: 'edge_fair_pick', from: 'ai_worker_proxy_fairness_chain', to: 'model_registry_pick' },
  { id: 'edge_pick_gem', from: 'model_registry_pick', to: 'gemini_service_stack' },
  { id: 'edge_ug_tr', from: 'unified_ai_gateway', to: 'tripo_service' },
  { id: 'edge_g3_tr', from: 'generate3d_module', to: 'tripo_service' },
  { id: 'edge_g3_tc', from: 'generate3d_module', to: 'tencent_service' },
  { id: 'edge_ug_vb', from: 'unified_ai_gateway', to: 'workflow_video_bridge' },
  { id: 'edge_vb_http', from: 'workflow_video_bridge', to: 'http_video_bridge_upstream' },
  { id: 'edge_ug_jimeng', from: 'unified_ai_gateway', to: 'jimeng_warehouse' },
  { id: 'edge_jimeng_proxy', from: 'jimeng_warehouse', to: 'jimeng_server_proxy' },
  { id: 'edge_jimeng_volc', from: 'jimeng_server_proxy', to: 'volcengine_visual_upstream' },
  { id: 'edge_pick_jimeng', from: 'model_registry_pick', to: 'jimeng_warehouse' },
  { id: 'edge_pick_ark', from: 'model_registry_pick', to: 'volcengine_ark_upstream' },
];

/** §1.4.2 货物大类 → 闸门 → 运营手段 */
export const WORKFLOW_AI_CARGO_ROWS: readonly WorkflowAiCargoRow[] = [
  {
    id: 'cargo_text',
    cargoLabel: '文（对话 / 理解 / 标签等）',
    primaryGate: 'unifiedAiGateway → modelRegistry.pickBinding → geminiService',
    opsMeans: 'SystemConfig.modelText（registryId）+ pickBinding(role=text) + resolveUpstream',
    remark: '默认 DEFAULT_MODEL_TEXT；Vertex 代理路径叠 ai-worker-proxy 公平排队链',
  },
  {
    id: 'cargo_image',
    cargoLabel: '图（生图 / 改图 / 多参考）',
    primaryGate: 'unifiedAiGateway → pickBinding(role=image) → getAIForImageModel',
    opsMeans: '挡位 registryId + merge.ts（ready binding ∩ 运营 allowlist）+ bindingOverrides',
    remark: 'maxReferenceImagesForImageGear；异步 AI Worker Proxy 经 vertex-proxy 时带 aiBackend: vertex',
  },
  {
    id: 'cargo_video',
    cargoLabel: '视频',
    primaryGate: 'unifiedAiGateway.workflowGenerateVideo → workflowVideoBridge',
    opsMeans: '构建变量 VITE_WORKFLOW_VIDEO_API_URL（尚无与 model-ops 同源 JSON）',
    remark: '多供应商、异步形态见计划 §8',
  },
  {
    id: 'cargo_3d',
    cargoLabel: '3D',
    primaryGate: 'unifiedAiGateway re-export；执行编排 services/generate3d',
    opsMeans: '腾讯凭据 env/页面；GENERATE3D_PROVIDER_REGISTRY 代码登记',
    remark: '无与文图同一套 ops JSON；运营策略见 §1.4.1',
  },
  {
    id: 'cargo_misc',
    cargoLabel: '贴图 / 擂台 / 站点助手等',
    primaryGate: '经 unifiedAiGateway',
    opsMeans: '随文/图默认与渠道',
    remark: '见计划 §3.6',
  },
  {
    id: 'cargo_jimeng_image',
    cargoLabel: '即梦 · 图（W0 仓库）',
    primaryGate: 'unifiedAiGateway.workflowGenerateImageJimeng → pickBinding(role=image) → /api/jimeng',
    opsMeans: 'catalog.ts + jimengImageRegistry；warehouseOnly；M1 运营 allowlist',
    remark: 'verified: jimeng-image-t2i-v40',
  },
  {
    id: 'cargo_jimeng_video',
    cargoLabel: '即梦 · 视频（W0 仓库）',
    primaryGate: 'unifiedAiGateway.workflowGenerateVideoJimeng → pickJimengBinding(video)',
    opsMeans: 'jimengVideoRegistry；不经 geminiService',
    remark: 'verified: jimeng-video-ti2v-v30-pro',
  },
  {
    id: 'cargo_jimeng_dh',
    cargoLabel: '即梦 · 数字人（W0 仓库）',
    primaryGate: 'unifiedAiGateway.workflowGenerateDigitalHumanJimeng → pickJimengBinding(digital_human)',
    opsMeans: 'jimengDigitalHumanRegistry；asyncMode omnihuman_v1',
    remark: 'W0 可 skip 冒烟；M1 generate_digital_human',
  },
];

const nodeIdSet = new Set(WORKFLOW_AI_PICK_NODES.map((n) => n.id));

function assertEdgesReferenceNodes(): void {
  for (const e of WORKFLOW_AI_PICK_EDGES) {
    if (!nodeIdSet.has(e.from) || !nodeIdSet.has(e.to)) {
      throw new Error(`workflowAiPickIndex: edge ${e.id} references unknown node`);
    }
  }
}

assertEdgesReferenceNodes();
