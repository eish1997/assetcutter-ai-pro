
export const AppMode = {
  /** 欢迎页 / 主页 */
  HOME: 'HOME',
  LAB: 'LAB',
  TEXTURE: 'TEXTURE',
  LIBRARY: 'LIBRARY',
  DIALOG: 'DIALOG',
  GENERATE_3D: 'GENERATE_3D',
  ADMIN: 'ADMIN',
  /** 提示词擂台：快速 A/B 对比测试 + 获胜片段库 */
  ARENA: 'ARENA',
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
};

export type AppMode = keyof typeof AppMode;

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
export type DialogImageSizeMode = 'adaptive' | 'manual';

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
  { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
  { id: 'gemini-2.0-flash-exp-image-generation', label: 'Gemini 2.0 Flash Exp' },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
] as const;

/** 生图挡位（快速 / Pro），对应支持图像输出的模型 */
export const DIALOG_IMAGE_GEARS = [
  { id: 'fast', label: '快速', modelId: 'gemini-2.5-flash-image' },
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

/** 切割图片组内一项：直接图片 或 引用子资产（套娃） */
export type WorkflowCutGroupItem = string | { assetId: string };

/** 单个资产：原始图 + 各类型结果图，当前展示版本，是否已归档；归档后可按生成顺序拼流程图 */
export type WorkflowAsset = {
  id: string;
  /** 原始输入图 base64 */
  original: string;
  /** 当前展示的版本 key：'original' 或能力模块 id */
  displayKey: string;
  /** 各类型生成结果图 base64（key 为能力模块 id）；切割图片也可用 cutImageGroup */
  results: Record<string, string>;
  /** 切割图片结果：多图成组，可含子资产引用（套娃） */
  cutImageGroup?: WorkflowCutGroupItem[];
  /** 若本资产来自某资产的切割组内，记录父资产 id（用于 显示全部） */
  parentAssetId?: string;
  /** 生成顺序，用于拼合流程图 */
  resultOrder: string[];
  /** 各步骤执行时间等，可追溯 */
  resultMeta?: Record<string, { executedAt: number }>;
  archived: boolean;
  hiddenInGrid: boolean;
  createdAt: number;
};

/** 待处理区单项：某资产的某操作 */
export type WorkflowPendingTask = {
  id: string;
  assetId: string;
  /** 能力模块 id */
  actionType: string;
  inputImage: string;
  addedAt: number;
  /** 从组内拖到切割时：父组 id 与项下标，用于套娃替换 */
  sourceGroupAssetId?: string;
  sourceItemIndex?: number;
};

/** 能力分类：生图=提示词相关；图像处理=切割/裁剪等；生成3D=混元生3D 预设 */
export const CAPABILITY_CATEGORIES = [
  { id: 'image_gen', label: '生图', desc: '提示词相关，指令传给生图模型（转风格、生成多视角等）' },
  { id: 'image_process', label: '图像处理', desc: '切割、裁剪、贴图提取、检测拆分等（不依赖生图提示词）' },
  { id: 'generate_3d', label: '生成3D', desc: '混元生3D：工作流中拖图到该能力即按预设提交 3D 任务' },
] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]['id'];

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
  /** 预设提示词/指令，生图类传给模型；图像处理类部分能力有内置逻辑可留空；生成3D 时可作补充描述 */
  instruction: string;
  /** 仅当 category === 'generate_3d' 时使用 */
  generate3D?: Generate3DPreset;
};
