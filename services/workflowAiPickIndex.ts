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
    id: 'gemini_service_stack',
    layer: 'supplier',
    label: 'geminiService 等文本/生图实现',
    codeRefs: ['services/geminiService.ts'],
  },
  {
    id: 'gemini_proxy_fairness_chain',
    layer: 'supplier',
    label: 'Gemini 代理公平排队（可选 · HTTP/运维层）',
    codeRefs: [
      'services/geminiFairnessBridge.ts',
      'services/geminiProxyFairnessError.ts',
      'services/unifiedAiSoftNotice.ts',
      'components/GeminiFairnessFloatingNotice.tsx',
      'server/gemini-proxy-fairness.js',
      'server/gemini-proxy-api.js',
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
  { id: 'edge_ug_fair', from: 'unified_ai_gateway', to: 'gemini_proxy_fairness_chain' },
  { id: 'edge_fair_gem', from: 'gemini_proxy_fairness_chain', to: 'gemini_service_stack' },
  { id: 'edge_ug_tr', from: 'unified_ai_gateway', to: 'tripo_service' },
  { id: 'edge_g3_tr', from: 'generate3d_module', to: 'tripo_service' },
  { id: 'edge_g3_tc', from: 'generate3d_module', to: 'tencent_service' },
  { id: 'edge_ug_vb', from: 'unified_ai_gateway', to: 'workflow_video_bridge' },
  { id: 'edge_vb_http', from: 'workflow_video_bridge', to: 'http_video_bridge_upstream' },
];

/** §1.4.2 货物大类 → 闸门 → 运营手段 */
export const WORKFLOW_AI_CARGO_ROWS: readonly WorkflowAiCargoRow[] = [
  {
    id: 'cargo_text',
    cargoLabel: '文（对话 / 理解 / 标签等）',
    primaryGate: 'unifiedAiGateway → geminiService 等',
    opsMeans: 'SystemConfig.modelText + 注册表解析；可选运营 JSON 影响生图档位联动',
    remark: '文本 registryId 与 modelRegistry 对齐；试用/Vertex 经 gemini-proxy 时叠公平排队链',
  },
  {
    id: 'cargo_image',
    cargoLabel: '图（生图 / 改图 / 多参考）',
    primaryGate: 'unifiedAiGateway',
    opsMeans: '同上 + merge.ts 合并运营允许列表',
    remark: '挡位与 maxReferenceImagesForImageGear；异步批量走代理时叠公平排队链',
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
