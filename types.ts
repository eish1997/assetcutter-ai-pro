import type { VgpAssetExtension } from './types/vgp';
import type { DialogImageGear, DialogImageModelRegistryId } from './services/modelRegistry/imageModels';
import type { PanoLocalReprojectSnapshot } from './services/panoViewportProjection';

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
    /** 对话生图编辑指令用（经 unifiedAiGateway / dialogGenerateImage） */
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
  /** 内存或本地未上传时存在；已上传 R2 后持久化可仅存 key，加载时再 hydrate */
  resultImageBase64?: string;
  /** 登录且云同步时上传至 R2 的对象键（users/…/dialogs/…） */
  resultImageObjectKey?: string;
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
  resultImageObjectKey?: string;
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

/** 对话生图模型列表 / 参考图上限 — 源自 `services/modelRegistry/imageModels.ts`（单一数据源） */
export {
  DIALOG_IMAGE_GEARS,
  DIALOG_IMAGE_MODEL_MAX_REFERENCE_IMAGES,
  DIALOG_IMAGE_MODELS,
  DIALOG_IMAGE_REGISTRY,
  DEFAULT_IMAGE_MODEL_REGISTRY_ID,
  maxReferenceImagesForImageGear,
  maxReferenceImagesForImageModel,
} from './services/modelRegistry/imageModels';
export type { DialogImageGear, DialogImageModelRegistryId };

// ---------- 工作流模块 ----------
/** 工作流功能类型：拖拽到的目标框（默认 4 个，可扩展） */
export const WORKFLOW_ACTION_TYPES = [
  { id: 'split_component', label: '拆分组件' },
  { id: 'style_transfer', label: '转风格' },
  { id: 'multi_view', label: '生成多视角' },
  { id: 'cut_image', label: '切割图片' },
  { id: 'companion_sam_segment', label: '本机智能分割' },
] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number]['id'];

/** 能力模块：可添加、可配置预设（名称 + 提示词/指令） */
export type WorkflowActionModule = {
  id: string;
  label: string;
  /** 该功能使用的预设提示词/指令（生图类会传给模型） */
  instruction: string;
};

/** 切割图片组内一项（已废弃，改用 groupId）：直接图片 或 引用子资产（套娃）；{ r2Key } 为云端独立对象，hydrate 后通常会变回 string */
export type WorkflowCutGroupItem = string | { assetId: string } | { r2Key: string };

/** 大图预览标注：归一化到原图宽高 [0,1]，可随分辨率稳定回显 */
export type ImageOverlayNormPoint = { x: number; y: number };

export type ImageOverlayRectItem = {
  id: string;
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  sw: number;
};

export type ImageOverlayBrushItem = {
  id: string;
  kind: 'brush';
  points: ImageOverlayNormPoint[];
  stroke: string;
  sw: number;
};

export type ImageOverlayTextItem = {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  fill: string;
};

export type ImageOverlayCropRect = {
  id: string;
  kind: 'crop_rect';
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ImageOverlayCropPolygon = {
  id: string;
  kind: 'crop_polygon';
  points: ImageOverlayNormPoint[];
};

/** 大图「局部重绘」选区（Gemini：扩边裁切 → 生成 → 羽化贴回） */
export type ImageLocalEditRect = {
  id: string;
  kind: 'local_rect';
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ImageLocalEditEllipse = {
  id: string;
  kind: 'local_ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ImageLocalEditPolygon = {
  id: string;
  kind: 'local_polygon';
  points: ImageOverlayNormPoint[];
};

export type ImageLocalEditSelection = ImageLocalEditRect | ImageLocalEditEllipse | ImageLocalEditPolygon;

/** 全景透视预览下：相对 WebGL 画布（renderer 元素）的裁切框，0~1，用于「所见即所得」导出 */
export type PanoViewportCropNorm = { x: number; y: number; w: number; h: number };

/** 全景局部重绘：球面选区在等距柱纹理上的采样点（u 环绕、v∈[0,1]），与当前视角无关 */
export type PanoLocalEditEquirectSample = { u: number; v: number };

export type ImageOverlayAnnotationDoc = {
  v: 1;
  items: Array<ImageOverlayRectItem | ImageOverlayBrushItem | ImageOverlayTextItem>;
  crops: Array<ImageOverlayCropRect | ImageOverlayCropPolygon>;
  /** 仅保留一块；与裁切区独立，用于快捷栏局部重绘 */
  localEdit?: ImageLocalEditSelection | null;
  /** 全景模式矩形裁切：与 `crops` 二选一语义；导出时对当前透视快照按框裁切 */
  panoViewportCrop?: PanoViewportCropNorm | null;
  /** 全景局部重绘：相对当前透视快照画布 0~1 的轴对齐框；与 `localEdit` 互斥（全景下用本字段） */
  panoLocalEditViewport?: PanoViewportCropNorm | null;
  /**
   * 全景局部重绘：选区沿球面的 UV 闭合环（提交时投到**当前**透视快照上算裁切框）。
   * 有本字段时优先于 `panoLocalEditViewport`，避免仅屏幕框在转头后与球面区域不一致导致贴回错位。
   */
  panoLocalEditEquirect?: PanoLocalEditEquirectSample[] | null;
  /**
   * 与 `panoLocalEditViewport` 同时刻记录：框选完成时的相机/缓冲快照。
   * 快捷栏提交生成前会先 `applyReprojectSnapshot` 再截透视图并贴回，避免转头后姿态与屏幕框不一致。
   */
  panoLocalEditReproject?: PanoLocalReprojectSnapshot | null;
};

/** 分镜表内单行（内嵌于 `storyboard_table` 资产，不对应独立 WorkflowAsset） */
export type StoryboardTableRow = {
  id: string;
  /** 0-based 展示序号，保存前由归一化重排 */
  index: number;
  shotNo?: string;
  durationSec?: number | null;
  shotText: string;
  /** 分镜图：data URL / blob / https；云端可仅保留 frameImageObjectKey */
  frameImage?: string;
  frameImageObjectKey?: string;
  locked?: boolean;
};

export type StoryboardTableDoc = {
  /** 表标题；缺省用 textTitle */
  title?: string;
  rows: StoryboardTableRow[];
};

/** 单个资产：原始图 + 各类型结果图，当前展示版本，是否已归档；归档后可按生成顺序拼流程图 */
export type WorkflowAsset = {
  id: string;
  /**
   * 资产形态：缺省视为 `image`，兼容旧数据。
   * `text`：工作区文字卡片（无位图执行能力，不进入图像能力队列）。
   * `storyboard_table`：分镜表容器，镜头行存于 `storyboardTable`。
   */
  assetKind?: 'image' | 'text' | 'storyboard_table';
  /** 分镜表行数据（仅 `assetKind === 'storyboard_table'`） */
  storyboardTable?: StoryboardTableDoc;
  /** 是否为组：true=组卡片，false/undefined=普通资产卡片 */
  isGroup?: boolean;
  /** 组内关联的资产 ID 列表（组卡片时使用）；筛选时根据此字段显示直接成员 */
  assetIds?: string[];
  /** 文字资产标题（可选） */
  textTitle?: string;
  /** 文字资产正文 */
  textBody?: string;
  /** 原始输入图 base64 或外链；云端可仅保留 originalObjectKey 由 hydrate 填回；文字资产可为空串；本地 3D 导入可先为 SVG 占位，后台生成 JPEG 快照后写回供网格缩略图 */
  original: string;
  /** R2 对象键（users/.../assets/<id>/original.xxx），与 original 二选一存在云端 JSON */
  originalObjectKey?: string;
  /** 本地伴侣 `PUT /v1/projects/:id/assets/:key` 下的原图键；持久化时可配合清空 `original` 中的 data/blob 以省 IndexedDB */
  originalCompanionKey?: string;
  /** 当前展示的版本 key：'original' 或能力模块 id */
  displayKey: string;
  /** 各类型生成结果图 base64（key 为能力模块 id） */
  results: Record<string, string>;
  /** 关联 3D 模型下载地址（可选）；用于大图预览切换到 3D 视口 */
  modelUrls?: string[];
  /**
   * 与 `modelUrls` 同序：本地伴侣 `PUT .../assets/:key` 下的模型二进制键。
   * 持久化时可配合清空对应槽位的 `blob:`/`data:` 串以省 IndexedDB。
   */
  modelCompanionKeys?: string[];
  /** 各步骤的 3D 模型 URL（key 与 `displayKey` / `resultOrder` 对齐）；仅该步大图预览出现 3D 入口 */
  stepModelUrls?: Record<string, string[]>;
  /** 与 `stepModelUrls` 同结构：各步骤模型在本地伴侣下的键 */
  stepModelCompanionKeys?: Record<string, string[]>;
  /** 与 `stepModelUrls` 同结构：各步骤模型格式（glb 预览 / fbx 归档） */
  stepModelFormats?: Record<string, Array<'glb' | 'fbx'>>;
  /** 本地 blob 模型无 URL 后缀时，用原始文件名推断格式（.glb/.fbx/.obj 等） */
  modelSourceName?: string;
  /** 各步骤结果在 R2 的键，hydrate 后写回 results */
  resultsObjectKeys?: Record<string, string>;
  /** 各步骤结果图在本地伴侣下的对象键（与 `results` 中对应 step 的 data/blob 配对；持久化时可清空该步内联串） */
  resultsCompanionKeys?: Record<string, string>;
  /** 所属组的唯一 ID，null/undefined = 不在任何组 */
  groupId?: string | null;
  /** 组显示名称（冗余存，UI 直接用） */
  groupLabel?: string;
  /** 组内顺序（数字越小越靠前） */
  groupOrder?: number;
  /** 生成顺序，用于拼合流程图 */
  resultOrder: string[];
  /** 各步骤执行时间等，可追溯（可附带任务恢复字段） */
  resultMeta?: Record<
    string,
    {
      executedAt: number;
      /** 资产卡片/步骤条等展示用短标签（如大图局部重绘写入「局部重绘」） */
      displayStepLabel?: string;
      /** 结果槽位媒体类型；生视频步骤写入 `video` 以便网格用 `<video>` 预览 */
      mediaKind?: 'image' | 'video' | 'model3d';
      /** 生成3D（Tripo）任务 id：写入本步 resultMeta 并随工作区持久化；大图「拉取模型」与继续查询均依赖此字段，请勿手动清空 */
      tripoTaskId?: string;
      /** 生成3D（腾讯混元）任务 JobId；续查与落盘追溯用 */
      tencentJobId?: string;
      /** 最近一次 Tripo 查询/落盘失败信息（可选） */
      tripoLastError?: string;
      /** 最近一次腾讯混元任务失败信息（可选） */
      tencentLastError?: string;
      /** 入队时选用的能力/预设基 id（与步骤键基 id 一致），供详情面板解析预设名称 */
      presetActionIdSnapshot?: string;
      /** 入队时「微调覆写」输入框原文（可与理解后提示词对照） */
      promptOverrideSnapshot?: string;
      /** 文卡入队等附加正文快照 */
      inputTextSnapshot?: string;
      /** 是否经过能力「理解」链路（执行返回 vgpSteps 非空） */
      usedCapabilityUnderstand?: boolean;
      /** 入队时标记跳过理解（预设 skipUnderstand 等） */
      skipUnderstandSnapshot?: boolean;
      /** 标签精修等扩展字段（可选） */
      semanticSummary?: string;
    }
  >;
  /** 文字能力（gen_text）等产生的文本结果，key 与 resultOrder 中步骤 id 对齐 */
  textResults?: Record<string, string>;
  /**
   * 图像标签索引（key=版本键，value=扁平 tags）。
   * 约定维度前缀：subject/style/lighting/composition/mood/material/quality/usecase 等。
   */
  imageTags?: Record<string, string[]>;
  /** 标签阶段：coarse=规则粗标，refined=低成本二段式精修 */
  imageTagStage?: Record<string, 'coarse' | 'refined'>;
  /**
   * 大图预览**平面**模式下的矢量标注与裁切选区（可再编辑）；与全景分桶，互不覆盖。
   * key 与 `displayKey` 对齐（含 `original` 与各能力步骤 id）。
   */
  imageOverlayAnnotations?: Record<string, ImageOverlayAnnotationDoc>;
  /**
   * 大图预览**全景**模式下的标注 / 裁切 / 局部重绘 / 视口矩形裁切（key 同 `displayKey`）。
   */
  imageOverlayAnnotationsPano?: Record<string, ImageOverlayAnnotationDoc>;
  archived: boolean;
  /** true=仅在仓库列显示；false/undefined=在工作区列显示 */
  inRepository?: boolean;
  hiddenInGrid: boolean;
  createdAt: number;
  /**
   * 主网格卡片占位宽高比（宽/高，约 0.5～2），与 `workflowCardAspect` 的 clamp 一致。
   * 入图或解码出固有尺寸时写入并随项目 bundle 持久化，重开项目可先占位，减少多列 `balance` 反复重排。
   */
  gridCardAspectRatio?: number;
  /** VGP：语义快照 + 版本链 + Prompt 产物（阶段 A，可选以兼容旧数据） */
  vgp?: VgpAssetExtension;

  // === 兼容旧字段（迁移后会清理） ===
  /** @deprecated 改用 groupId */
  cutImageGroup?: WorkflowCutGroupItem[];
  /** @deprecated 改用 groupId */
  groupKind?: 'cut' | 'manual';
  /** @deprecated 改用 groupId */
  parentAssetId?: string;
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
  /**
   * 多参考图（与 `inputImage` 同序；`inputImage` 须与首图一致）。
   * 上云打包时写入 `inputImagesObjectKeys` 并清空内联图。
   */
  inputImages?: string[];
  inputImagesObjectKeys?: string[];
  /** Tripo multiview slots. Submit order is front/left/back/right. */
  tripoMultiviewImages?: Partial<Record<'front' | 'back' | 'left' | 'right', string>>;
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
  /** 来自文字资产卡片时的正文（标题+正文拼接），文生文/文生图时使用 */
  inputText?: string;
  /** 功能区分组覆盖参数：仅对生图执行路径生效 */
  overrideImageModelRegistryId?: string;
  /** @deprecated 请用 `overrideImageModelRegistryId` */
  overrideImageGear?: DialogImageGear;
  /** 功能区分组覆盖：文生文 / 图生文文字模型 */
  overrideTextModelRegistryId?: string;
  overrideImageAspectRatio?: string;
  overrideImageSize?: string;
  overrideSkipUnderstand?: boolean;
  /**
   * `quick_compose_bar_plain`：底部输入框直输图/文且未拖入预设卡片；运行日志用中性前缀，不显示底层快捷能力名。
   */
  logContext?: 'quick_compose_bar_plain';
  /**
   * 客户端已得到最终图（如大图局部重绘贴回后）：`runTask` 跳过 `executeCapability`，直接写入该图。
   * 仍走同一套队列与 `executePending` 收尾，以便节点树显示执行中/完成动画。
   */
  clientPrefetchedImageResult?: string;
  /**
   * 大图快捷栏：`executePending` 立即启动以显示节点树「执行中」，实际像素在客户端异步算完后由 `WorkflowSection` 内 Promise 喂入。
   * `runTask` 仅 `await` 该 Promise 并返回图，不再调用 `executeCapability`。
   */
  lightboxAwaitClientResult?: boolean;
  /** 写入 `resultMeta[resultKey].displayStepLabel`，供卡片与大图步骤展示 */
  displayStepLabel?: string;
};

/**
 * 能力分类：按「输入格式 → 输出格式」划分（工作区仅文字卡 / 图片卡两类资产）。
 * 另含生成3D（独立管线）。
 */
export const CAPABILITY_CATEGORIES = [
  { id: 'text_to_text', label: '文生文', desc: '文字入 → 文字出（拖文字卡）' },
  { id: 'text_to_image', label: '文生图', desc: '文字入 → 图片出（拖文字卡）' },
  { id: 'image_to_image', label: '图生图', desc: '图片入 → 图片出（生图模型 + 提示词，拖图片卡）' },
  { id: 'image_process', label: '图像处理', desc: '图片入 → 图片出（内置切割/拆分等，拖图片卡）' },
  { id: 'image_to_text', label: '图生文', desc: '图片入 → 文字出（拖图片卡）' },
  { id: 'generate_3d', label: '生成3D', desc: '工作流中拖图到该能力即按预设提交 3D 任务（支持 Tripo / 腾讯混元）' },
  {
    id: 'generate_video',
    label: '生成视频',
    desc: '文字与/或参考图 → 视频（需配置 VITE_WORKFLOW_VIDEO_API_URL，由后端桥接供应商）',
  },
] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number]['id'];

/** 能力执行引擎：gen_image=调用生图模型；gen_text=调用文字模型；builtin=仅走内置图像处理逻辑 */
export type CapabilityEngine = 'gen_image' | 'gen_text' | 'builtin';

/** 生成3D 能力预设：在工作流中拖图即用此配置提交 */
export type Generate3DPreset = {
  /** 默认 tripo；保留 tencent 兼容历史预设 */
  provider?: 'tripo' | 'tencent';
  /** Tripo 任务类型：文生3D / 图生3D */
  tripoTaskType?: 'text_to_model' | 'image_to_model' | 'multiview_to_model';
  /** Tripo 可选：模型版本（如 P1-20260311 / v3.1-20260211 / v2.5-20250123） */
  tripoModelVersion?: string;
  /** Tripo 可选：负向提示词 */
  tripoNegativePrompt?: string;
  /** Tripo 可选：几何质量 */
  tripoGeometryQuality?: 'standard' | 'detailed';
  /** Tripo 可选：纹理质量 */
  tripoTextureQuality?: 'standard' | 'detailed';
  /** Tripo 可选：目标面数 */
  tripoFaceLimit?: number;
  /** Tripo 可选：开启四边面重拓扑 */
  tripoQuad?: boolean;
  /** Tripo 可选：智能低模 */
  tripoSmartLowPoly?: boolean;
  /** Tripo 可选：分部件生成 */
  tripoGenerateParts?: boolean;
  /** Tripo 可选：自动尺寸 */
  tripoAutoSize?: boolean;
  /** Tripo 可选：压缩模式（当前仅 geometry） */
  tripoCompress?: 'geometry';
  /** Tripo 可选：是否导出 UV（默认 true） */
  tripoExportUv?: boolean;
  /** Tripo 可选：纹理开关 */
  tripoTexture?: boolean;
  /** Tripo 可选：PBR 开关 */
  tripoPbr?: boolean;
  /** Tripo 图生3D可选：输入图自动修复 */
  tripoEnableImageAutofix?: boolean;
  /** Tripo 图生3D可选：纹理对齐策略 */
  tripoTextureAlignment?: 'original_image' | 'geometry';
  /** Tripo 图生3D可选：模型朝向 */
  tripoOrientation?: 'default' | 'align_image';
  /** 专业版 | 极速版（腾讯混元）；Tripo 忽略此字段 */
  module: 'pro' | 'rapid';
  /** 图生3D 时可留空；文生3D 用 instruction，能力里主要用图生 */
  prompt?: string;
  /** 专业版：模型 3.0 | 3.1 */
  model?: '3.0' | '3.1';
  enablePBR?: boolean;
  faceCount?: number;
  generateType?: 'Normal' | 'LowPoly' | 'Geometry' | 'Sketch';
  /** LowPoly 时：triangle | quadrilateral */
  polygonType?: 'triangle' | 'quadrilateral';
  /** 专业版：STL | USDZ | FBX（单格式）；默认 obj+glb。极速版：OBJ/GLB/STL/USDZ/FBX/MP4 */
  resultFormat?: string;
};

/** 大模块：与工作流、资产仓库同级别的可添加能力模块（侧栏独立入口） */
export type CustomAppModule = {
  id: string;
  label: string;
  /** 分类：文生文 | 文生图 | 图生图 | 图像处理 | 图生文 | 生成3D | 生成视频 */
  category: CapabilityCategory;
  /**
   * 执行引擎（可选，由分类推导或显式指定）：
   * - text_to_text / image_to_text → gen_text
   * - text_to_image / image_to_image → gen_image
   * - image_process → builtin（切割/拆分等）
   * - generate_3d / generate_video 不使用
   */
  engine?: CapabilityEngine;
  /** 生图模型 registryId（可选），仅在 engine === 'gen_image' 时生效 */
  imageModelRegistryId?: string;
  /** 文字模型 registryId（可选），文生文 / 图生文时使用；缺省走设置页默认文字模型 */
  textModelRegistryId?: string;
  /** @deprecated 请用 `imageModelRegistryId`；旧 fast/standard/pro 会在读取时迁移 */
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
   * 仅文生文（text_to_text）生效：开启后，工作流将文字资产拖拽到该能力时
   * 会先弹出“临时提示词”输入框（默认空、必须输入），再与 instruction 拼接后执行。
   * 关闭时维持原行为（直接入队）。
   */
  requirePromptOnTextDrop?: boolean;
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
  /**
   * 图像处理处理器 id（`category === 'image_process'` 时使用）。
   * 见 `services/capabilityProcessors/imageProcessProcessors.ts`。
   * cut_image 参数见 `params`（cutMode / uniformRows / uniformCols / cutOverflowPx）。
   */
  processor?: string;
  /** 处理器参数（JSON；normalize 时按 processor schema 校验） */
  params?: Record<string, unknown>;
  /**
   * 图像处理 `host_bundle` 处理器写入；执行时向本机伴侣提交 `host_bundle.exec` / `host_bundle.probe`。
   * 仅 `category: image_process` + `processor: host_bundle` 使用，勿在文生图/图生图等类目单独配置。
   */
  companionHostBundle?: {
    /** 与 `host-bundles` / 已安装列表中的目录名一致 */
    dirName: string;
    /** 默认 `exec` */
    phase?: 'exec' | 'probe';
  };
  /**
   * 为 true 时：`executeCapability` 走本机伴侣 `sam_segment`（需已选工作区项目；`WorkflowSection` 传入 `workflowAssetId`）。
   * 无大图点选时使用**图像中心**为前景点。与 `companionHostBundle` 互斥（规范化时后写者优先）。
   */
  companionSamSegment?: boolean;
  /**
   * 为 true 时：`executeCapability` 走本机伴侣 `remove_bg`（Python rembg；需本机 `pip install "rembg[cpu,cli]"` 与同解释器 `COMPANION_REMBG_PYTHON`）。
   * 与 `companionHostBundle` / `companionSamSegment` 互斥。
   */
  companionRembg?: boolean;
  /** `companionRembg` 时可选：模型 id（须与伴侣 `rembgAdapter` 白名单一致，缺省由伴侣使用 u2net） */
  companionRembgModel?: string;
  /** `companionRembg` 时可选：alpha matting（更慢） */
  companionRembgAlphaMatting?: boolean;
};

/** 能力集合画布节点（与 React Flow 序列化兼容） */
export type CapabilitySetNode = {
  id: string;
  type: 'input' | 'preset' | 'output' | 'textGen' | 'testStop' | 'assetInput';
  position: { x: number; y: number };
  data: {
    label: string;
    /** type===preset 时关联的基础预设 id */
    presetId?: string;
    /** 卡片预览图：与 CustomAppModule.previewImage 同源（data URL / 相对路径 / URL），持久化在集合 JSON */
    previewImage?: string;
    /** type===textGen 时用户输入的文本，用于生成提示词 */
    text?: string;
    /** type===assetInput 时：来源范围（工作区/仓库） */
    assetScope?: 'workspace' | 'repository';
    /** type===assetInput 时：选中的资产 id */
    assetId?: string;
    /** type===output 时：期望产物类型（与 CAPABILITY_CATEGORIES 一致，多输出节点时用于区分） */
    outputCategory?: CapabilityCategory;
    /** 画布「运行测试」成功后写入的临时预览图，不写入持久化 JSON */
    testRunPreview?: string;
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
