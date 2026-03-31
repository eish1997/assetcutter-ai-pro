import type { VgpAssetExtension } from './types/vgp';

export type { VgpAssetExtension, VgpGenStepCapture } from './types/vgp';
export type {
  PipelinePlan,
  PlannedStep,
  DecisionTraceEntry,
  PlannerRulesetDocument,
  PlannerRuleRow,
  InputProfile,
} from './types/planner';
export { PLAN_SCHEMA_VERSION } from './types/planner';

export const AppMode = {
  LAB: 'LAB',
  TEXTURE: 'TEXTURE',
  LIBRARY: 'LIBRARY',
  DIALOG: 'DIALOG',
  GENERATE_3D: 'GENERATE_3D',
  ADMIN: 'ADMIN',
  /** 提示词擂台：快速 A/B 对比测试 + 获胜片段库 */
  ARENA: 'ARENA',
  /** 商店：远程模板包（GitHub Pages）安装/更新/回滚 */
  STORE: 'STORE',
  /** 工作流：多图筛选 → 拖拽/点选到功能框 → 待处理 → 一键执行 → 版本切换 → 归档 */
  WORKFLOW: 'WORKFLOW',
  /** 能力：功能预设管理，工作流功能区调用此处配置 */
  CAPABILITY: 'CAPABILITY',
  /** 贴图修缝：OBJ + 贴图 + 可选 seam mask → seam-aware 修复 */
  SEAM_REPAIR: 'SEAM_REPAIR',
  /** 生成贴图：功能贴图 + 描述 → AI 生成 PBR Base Color / Roughness / Metallic */
  PBR_TEXTURE: 'PBR_TEXTURE',
  /** 设置：API 密钥等 */
  SETTINGS: 'SETTINGS',
} as const;

/** 对比选择记录（ac_ab_choices），仅通过 abChoiceStore 读写 */
export type ABChoice = {
  id: string;
  timestamp: number;
  snippetA: string;
  snippetB: string;
  winner: 'A' | 'B' | 'tie';
  fullPromptA?: string;
  fullPromptB?: string;
  reason?: string;
};

/** 获胜片段库（ac_winning_snippets），仅通过 snippetStore 读写 */
export type WinningSnippet = {
  id: string;
  text: string;
  timestamp: number;
  source?: string;
  /** 擂主预览图（可选） */
  previewImage?: string;
  /** 回顾用：保存当时的时间轴快照（可选） */
  timelineSnapshot?: ArenaTimelineBlock[];
  /** 回顾用：保存当时的步骤日志快照（可选） */
  stepLogSnapshot?: ArenaStepEntry[];
};

export type AppMode = keyof typeof AppMode;

// ---------- 提示词模板（商店/本地模板库） ----------
export type PromptTemplate = {
  /** 模板唯一 id（用于合并覆盖） */
  id: string;
  /** 展示名 */
  name: string;
  /** 标签（可选） */
  tags?: string[];
  /** 模板正文（通常为英文生图 prompt 或可参数化文本） */
  text: string;
  /** 备注/说明（可选） */
  note?: string;
  /** 更新时间（可选） */
  updatedAt?: number;
};

export type StoreItemType = 'capability_presets';

export type StoreCatalogItem = {
  id: string;
  type: StoreItemType;
  name: string;
  desc?: string;
  version: string;
  url: string;
  /** 能力预设卡片预览（相对能力商店根路径，与包内 preset.previewImage 一致） */
  previewUrl?: string;
  sha256?: string;
  updatedAt?: string;
  tags?: string[];
  minAppVersion?: string;
};

export const AppStep = {
  T_PATTERN: 'T_PATTERN',
  T_TILE: 'T_TILE',
  T_PBR: 'T_PBR'
} as const;

export type AppStep = keyof typeof AppStep;

export type BoundingBox = {
  id: string;
  label: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
};

export type AssetCategory = 'SCENE_OBJECT' | 'PREVIEW_STRIP' | 'PRODUCTION_ASSET' | 'MESH_MODEL' | 'TEXTURE_MAP';

export type LibraryItem = {
  id: string;
  type: 'SLICE' | 'STRIP' | 'MODEL' | 'TEXTURE';
  category: AssetCategory;
  label: string;
  data: string;
  sourceId: string;
  timestamp: number;
  style?: string;
  groupId: string;
  /** 3D 模型文件下载 URL 列表（混元生3D 等），预览图在 data */
  modelUrls?: string[];
};

/** 擂台过程步骤日志：每步 AI 输入/输出可见，用于状态指示与核对 */
export type ArenaStepEntry = {
  id: string;
  /** 步骤标识，如 generating_prompts, generating_image_0, optimizing_loser */
  step: string;
  /** 展示用标题 */
  label: string;
  status: 'running' | 'done' | 'error';
  /** 发给模型的完整输入（系统 prompt + user 消息） */
  inputFull?: string;
  /** 模型返回的原始文本 */
  outputRaw?: string;
  /** 解析摘要（如「已解析：reasoning、promptA、promptB」） */
  outputParsed?: string;
  /** 解析失败时的错误信息 */
  parseError?: string;
  ts: number;
};

/** 擂台当前所处大阶段，用于步骤条高亮 */
export type ArenaCurrentStep =
  | 'idle'
  | 'generating_prompts'
  | 'generating_images'
  | 'awaiting_pick'
  | 'optimizing_loser'
  | 'generating_challenger_image'
  | 'adding_challenger';

/** 时间轴单块：步骤组 / 用户选择 / 对比（可回顾） */
export type ArenaTimelineBlock = {
  id: string;
  type: 'step_group' | 'user_choice' | 'comparison';
  label: string;
  /** 关联的步骤日志 id，用于展示输入输出与滚动定位 */
  stepLogIds?: string[];
  /** 对比块快照（过去轮次的选项），当前活块用 state 的 currentOptions */
  comparisonSnapshot?: { options: Array<{ label: string; prompt: string; image: string | null }> };
  /** 对比块对应的轮次，0=首轮 */
  round?: number;
  ts: number;
};

export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export type AppTask = {
  id: string;
  type: 'TEXTURE_GEN' | 'DIALOG_GEN' | 'GENERATE_3D';
  label: string;
  status: TaskStatus;
  progress: number;
  message: string;
  result?: unknown;
  error?: string;
  startTime: number;
};

export type SystemConfig = {
  modelText: string;
  modelImage: string;
  modelPro: string;
  customPromptSuffix: string;
  prompts: {
    /** 对话生图编辑指令用（geminiService.dialogGenerateImage） */
    edit?: string;
    texture_pattern: string;
    texture_tileable: string;
    texture_pbr: string;
    dialog_understand: string;
  };
};

// ---------- 生成记录与评分（ac_generation_records，仅通过 recordStore 读写） ----------
/** 生成来源：对话生图 / 提取花纹 */
export type GenerationSource = 'dialog' | 'texture';

/** 输出图引用，可扩展（一期：libraryId 或 dialogRef；二期可增加 url、thumbnail 等） */
export type OutputImageRef = string | { type: string; value: string };

export type GenerationRecord = {
  id: string;
  source: GenerationSource;
  timestamp: number;
  fullPrompt: string;
  instruction?: string;
  userPrompt?: string;
  textureType?: 'pattern' | 'tileable' | 'pbr';
  textureMapType?: string;
  inputImageRef?: string;
  outputImageRef: OutputImageRef;
  libraryItemId?: string;
  model?: string;
  options?: Record<string, string>;
  sessionId: string;
  messageId: string;
  versionIndex: number;
  userScore?: number;
  userScoreAt?: number;
  modelScore?: number;
  modelScoreReason?: string;
};

// ---------- 对话式生图模块 ----------
/** 支持的画面比例（Gemini imageConfig.aspectRatio） */
export const SUPPORTED_ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '21:9', label: '21:9' },
] as const;

/** 对话生图：比例选项（「自适应」= 不传 aspectRatio/imageSize，由输入图与模型决定） */
export const DIALOG_ASPECT_RATIO_OPTIONS = [
  { value: 'adaptive', label: '自适应' },
  ...SUPPORTED_ASPECT_RATIOS,
] as const;

/** 支持的输出尺寸（Gemini imageConfig.imageSize） */
export const SUPPORTED_IMAGE_SIZES = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
] as const;

/** 单次生成结果的版本（含元数据） */
export type DialogMessageVersion = {
  resultImageBase64: string;
  understoodPrompt?: string;
  timestamp: number;
  width?: number;
  height?: number;
  /** 该版本识别到的物体框，切换版本不丢失 */
  detectedBoxes?: BoundingBox[];
  /** 关联的生成记录 id，用于评分时 O(1) 更新 */
  generationRecordId?: string;
};

/** 单条对话会话（多标签页用） */
export type DialogSession = {
  id: string;
  messages: DialogMessage[];
  /** 根据首条用户内容自动生成的简短标题，如「大门」「星空背景」 */
  title?: string;
  createdAt: number;
  updatedAt: number;
  /** 是否已归档（归档后归入「已归档」区，可折叠） */
  archived?: boolean;
};

export type DialogMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imageBase64?: string;
  /** 当前用户消息附带的多张输入图，首图仍兼容写入 imageBase64 */
  inputImages?: string[];
  /** @deprecated 使用 versions 最后一版；兼容旧数据 */
  resultImageBase64?: string;
  /** @deprecated 使用 versions 最后一版；兼容旧数据 */
  understoodPrompt?: string;
  timestamp: number;
  /** 生成结果版本历史，最新在末尾 */
  versions?: DialogMessageVersion[];
};

/** 对话临时库单项：生图结果或识别物体裁剪图，随会话删除而清理；可带提示词便于加入当前输入 */
export type DialogTempItem = {
  id: string;
  data: string;
  sourceSessionId: string;
  sourceMessageId?: string;
  sourceType: 'generated' | 'object_crop' | 'user_input';
  label?: string;
  /** 用户当条描述（生图时），用于「加入当前对话」回填输入框 */
  userPrompt?: string;
  /** 理解后的英文指令（生图时），用于「加入当前对话」回填 */
  understoodPrompt?: string;
  timestamp: number;
};

/** 可选生图模型（展示名 -> 模型 id） */
export const DIALOG_IMAGE_MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image' },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image' },
] as const;

/** 生图挡位（快速 / 标准 / Pro），对应支持图像输出的模型 */
export const DIALOG_IMAGE_GEARS = [
  { id: 'fast', label: '快速', modelId: 'gemini-2.5-flash-image' },
  { id: 'standard', label: '标准', modelId: 'gemini-3.1-flash-image-preview' },
  { id: 'pro', label: 'Pro', modelId: 'gemini-3-pro-image-preview' },
] as const;
export type DialogImageGear = (typeof DIALOG_IMAGE_GEARS)[number]['id'];

// ---------- 工作流模块 ----------
/** 工作流功能类型：拖拽到的目标框（默认 4 个，可扩展） */
export const WORKFLOW_ACTION_TYPES = [
  { id: 'split_component', label: '拆分组件' },
  { id: 'style_transfer', label: '转风格' },
  { id: 'multi_view', label: '生成多视角' },
  { id: 'cut_image', label: '切割图片' },
] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number]['id'];

/** 能力模块：可添加、可配置预设（名称 + 提示词/指令） */
export type WorkflowActionModule = {
  id: string;
  label: string;
  /** 该功能使用的预设提示词/指令（生图类会传给模型） */
  instruction: string;
};

/** 切割图片组内一项：直接图片 或 引用子资产（套娃）；{ r2Key } 为云端独立对象，hydrate 后通常会变回 string */
export type WorkflowCutGroupItem = string | { assetId: string } | { r2Key: string };

/** 单个资产：原始图 + 各类型结果图，当前展示版本，是否已归档；归档后可按生成顺序拼流程图 */
export type WorkflowAsset = {
  id: string;
  /** 原始输入图 base64 或外链；云端可仅保留 originalObjectKey 由 hydrate 填回 */
  original: string;
  /** R2 对象键（users/.../assets/<id>/original.xxx），与 original 二选一存在云端 JSON */
  originalObjectKey?: string;
  /** 当前展示的版本 key：'original' 或能力模块 id */
  displayKey: string;
  /** 各类型生成结果图 base64（key 为能力模块 id）；切割图片也可用 cutImageGroup */
  results: Record<string, string>;
  /** 各步骤结果在 R2 的键，hydrate 后写回 results */
  resultsObjectKeys?: Record<string, string>;
  /** 切割图片结果：多图成组，可含子资产引用（套娃）；用户拖到「组」建的组也用此字段 */
  cutImageGroup?: WorkflowCutGroupItem[];
  /** 组类型：切割=切割能力生成；manual=用户拖到「组」创建 */
  groupKind?: 'cut' | 'manual';
  /** 组显示名称，角标显示为「groupLabel + 组内数量」；不设则用 groupKind 的默认名（组/切割） */
  groupLabel?: string;
  /** 若本资产来自某资产的组内，记录父资产 id（用于 显示全部） */
  parentAssetId?: string;
  /** 生成顺序，用于拼合流程图 */
  resultOrder: string[];
  /** 各步骤执行时间等，可追溯 */
  resultMeta?: Record<string, { executedAt: number }>;
  archived: boolean;
  hiddenInGrid: boolean;
  createdAt: number;
  /** VGP：语义快照 + 版本链 + Prompt 产物（阶段 A，可选以兼容旧数据） */
  vgp?: VgpAssetExtension;
};

/** 待处理区单项：某资产的某操作 */
export type WorkflowPendingTask = {
  id: string;
  assetId: string;
  /** 能力模块 id */
  actionType: string;
  inputImage: string;
  /** 待处理缩略图在 R2 的键，hydrate 后写回 inputImage */
  inputImageObjectKey?: string;
  addedAt: number;
  /** 从组内拖到切割时：父组 id 与项下标，用于套娃替换 */
  sourceGroupAssetId?: string;
  sourceItemIndex?: number;
  /** 临时微调提示词：从功能区「微调」入口拖入时填写，执行时覆盖预设的 instruction */
  promptOverride?: string;
  /**
   * 入队时当前资产用于执行的展示版本（与 inputImage 一致），供 VGP 解析父版本（可从任意步骤结果继续生图）。
   * 缺省时按链头兼容旧任务。
   */
  inputSourceDisplayKey?: string;
};

/** 能力分类：生图=提示词相关；图像处理=切割/裁剪等；生成3D=混元生3D 预设 */
export const CAPABILITY_CATEGORIES = [
  { id: 'image_gen', label: '生图', desc: '提示词相关，指令传给生图模型（转风格、生成多视角等）' },
  { id: 'image_process', label: '图像处理', desc: '切割、裁剪、贴图提取、检测拆分等（不依赖生图提示词）' },
  { id: 'generate_3d', label: '生成3D', desc: '混元生3D：工作流中拖图到该能力即按预设提交 3D 任务' },
] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]['id'];

/** 能力执行引擎：gen_image=调用生图模型；builtin=仅走内置图像处理逻辑 */
export type CapabilityEngine = 'gen_image' | 'builtin';

/** 生成3D 能力预设：在工作流中拖图即用此配置提交 */
export type Generate3DPreset = {
  /** 专业版 | 极速版 */
  module: 'pro' | 'rapid';
  /** 图生3D 时可留空；文生3D 用 instruction，能力里主要用图生 */
  prompt?: string;
  /** 专业版：模型 3.0 | 3.1 */
  model?: '3.0' | '3.1';
  enablePBR?: boolean;
  faceCount?: number;
  generateType?: 'Normal' | 'LowPoly' | 'Geometry' | 'Sketch';
  resultFormat?: string;
};

/** 大模块：与工作流、资产仓库同级别的可添加能力模块（侧栏独立入口） */
export type CustomAppModule = {
  id: string;
  label: string;
  /** 分类：生图 | 图像处理 | 生成3D */
  category: CapabilityCategory;
  /**
   * 执行引擎（可选）：
   * - image_gen 默认 gen_image
   * - image_process 默认 builtin（如需走生图，需要显式改为 gen_image）
   * - generate_3d 不使用此字段
   */
  engine?: CapabilityEngine;
  /** 生图档位（可选），仅在 engine === 'gen_image' 时生效 */
  imageGear?: DialogImageGear;
  /** 生图输出比例（可选），如 1:1、16:9，仅 engine === 'gen_image' 时生效，对应 Gemini imageConfig.aspectRatio */
  imageAspectRatio?: string;
  /** 生图输出尺寸（可选），如 1K、2K、4K，仅 engine === 'gen_image' 时生效，对应 Gemini imageConfig.imageSize */
  imageSize?: string;
  /** 是否启用（默认启用）；禁用后工作流功能区不展示 */
  enabled?: boolean;
  /** 排序（数字越小越靠前）；缺省时按数组顺序 */
  order?: number;
  /** 预设提示词。生图类：工作流执行时先交给文字模型理解，再拿理解结果调用生图模型（与对话模式一致）；图像处理类部分能力有内置逻辑可留空；生成3D 时可作补充描述。 */
  instruction: string;
  /** 生图执行时跳过“理解”步骤，直接将 instruction（或覆写提示词）发送给生图模型 */
  skipUnderstand?: boolean;
  /**
   * 卡片预览图：本地多为 data URL；从 R2 能力商店同步后可为同源相对路径或完整 URL。
   * 上传 R2 时服务端会将 data URL 转为独立对象并在 JSON 中写入相对路径，便于他人同步后展示。
   */
  previewImage?: string;
  /** 对比预览：原始图（可选） */
  previewOriginalImage?: string;
  /** 对比预览：生成图（可选） */
  previewGeneratedImage?: string;
  /** 对比预览：原始图缩略图（可选） */
  previewOriginalThumbImage?: string;
  /** 对比预览：生成图缩略图（可选） */
  previewGeneratedThumbImage?: string;
  /** 仅当 category === 'generate_3d' 时使用 */
  generate3D?: Generate3DPreset;
};

/** 能力集合画布节点（与 React Flow 序列化兼容） */
export type CapabilitySetNode = {
  id: string;
  type: 'input' | 'preset' | 'output' | 'textGen';
  position: { x: number; y: number };
  data: {
    label: string;
    /** type===preset 时关联的基础预设 id */
    presetId?: string;
    /** type===textGen 时用户输入的文本，用于生成提示词 */
    text?: string;
  };
};

/** 能力集合画布连线 */
export type CapabilitySetEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/** 能力集合：由多个基础预设组合、在画布中连线形成的流程 */
export type CapabilitySet = {
  id: string;
  label: string;
  nodes: CapabilitySetNode[];
  edges: CapabilitySetEdge[];
  createdAt?: number;
  updatedAt?: number;
};
