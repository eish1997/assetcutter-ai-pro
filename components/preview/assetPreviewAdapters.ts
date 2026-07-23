import type {
  AssetCapability,
  AssetPreviewAction,
  AssetPreviewAdapter,
  AssetPreviewContext,
} from './assetPreviewTypes';
import type { WorkflowAssetKind } from '../../types';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function variantLocation(context: AssetPreviewContext): string {
  const variant = context.variant;
  if (!variant) return context.asset.id;
  return (
    textValue(variant.url) ||
    textValue(variant.objectKey) ||
    textValue(variant.companionKey) ||
    textValue(variant.modelUrls?.[0]) ||
    `${context.asset.id}:${variant.id}`
  );
}

function formatCount(value: number | undefined): string {
  return Number.isFinite(value) ? Math.max(0, Math.round(value || 0)).toLocaleString('en-US') : '读取中';
}

function formatDimension(value: number | undefined): string {
  if (!Number.isFinite(value)) return '读取中';
  const rounded = Math.round((value || 0) * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded.toFixed(3)).replace(/0+$/, '').replace(/\.$/, '');
}

function model3dStatsRows(context: AssetPreviewContext) {
  const stats = context.model3dStats;
  if (!stats) {
    return [
      { label: '格式', value: '读取中' },
      { label: 'Mesh 数', value: '读取中' },
      { label: '材质数', value: '读取中' },
      { label: '贴图数', value: '读取中' },
      { label: '顶点数', value: '读取中' },
      { label: '三角面数', value: '读取中' },
      { label: '尺寸', value: '读取中' },
    ];
  }
  return [
    { label: '格式', value: stats.format.toUpperCase() },
    { label: 'Mesh 数', value: formatCount(stats.meshCount) },
    { label: '材质数', value: formatCount(stats.materialCount) },
    { label: '贴图数', value: formatCount(stats.textureCount) },
    { label: '顶点数', value: formatCount(stats.vertexCount) },
    { label: '三角面数', value: formatCount(stats.triangleCount) },
    {
      label: '尺寸',
      value: `${formatDimension(stats.dimensions.width)} x ${formatDimension(stats.dimensions.height)} x ${formatDimension(stats.dimensions.depth)}`,
    },
  ];
}

function commonInspectorSections(context: AssetPreviewContext) {
  const variant = context.variant;
  return [
    {
      id: 'asset-summary',
      title: '资产信息',
      rows: [
        { label: '类型', value: context.assetKind },
        { label: '资产', value: context.asset.id },
        { label: '版本', value: variant ? `${variant.label || variant.id}` : '暂无可预览版本' },
      ],
    },
  ];
}

function makeReferenceCapability(): AssetCapability {
  return {
    id: 'create-preview-reference',
    label: '生成预览引用',
    description: '把当前预览版本整理成可继续投入输入框或工作流的文本引用。',
    assetTypes: ['image', 'model3d', 'video', 'audio', 'text', 'file'],
    outputKinds: ['text'],
    inputSchema: [
      { name: 'includeLocation', type: 'boolean', label: '包含资源位置', defaultValue: true },
      { name: 'note', type: 'text', label: '备注', defaultValue: '' },
    ],
    async run({ asset, variant, input }) {
      const includeLocation = input.includeLocation !== false;
      const note = textValue(input.note);
      const lines = [
        `[资产预览引用] ${variant?.label || asset.textTitle || asset.id}`,
        `assetId: ${asset.id}`,
        `displayKey: ${asset.displayKey || variant?.id || 'original'}`,
        `kind: ${variant?.kind || asset.assetKind || 'image'}`,
      ];
      if (includeLocation && variant) {
        const location =
          textValue(variant.url) ||
          textValue(variant.objectKey) ||
          textValue(variant.companionKey) ||
          textValue(variant.modelUrls?.[0]);
        if (location) lines.push(`location: ${location}`);
      }
      if (note) lines.push(`note: ${note}`);
      return {
        status: 'succeeded',
        outputs: [
          {
            kind: 'text',
            label: '预览引用',
            text: lines.join('\n'),
            meta: { source: 'asset_preview_capability', assetId: asset.id, variantId: variant?.id },
          },
        ],
      };
    },
  };
}

export const assetPreviewCapabilities: Record<string, AssetCapability> = {
  'create-preview-reference': makeReferenceCapability(),
};

function commonActions(context: AssetPreviewContext): AssetPreviewAction[] {
  const hasLocation = Boolean(variantLocation(context));
  return [
    {
      id: 'download',
      label: '下载',
      title: '下载当前预览内容',
      placement: 'primary',
      disabled: !hasLocation,
      disabledReason: '当前版本没有可下载资源',
    },
    {
      id: 'copy',
      label: '复制',
      title: '复制当前资产引用或资源',
      placement: 'primary',
    },
  ];
}

function addToInputAction(): AssetPreviewAction {
  return {
    id: 'add-to-input',
    label: '加入输入',
    title: '把当前资产引用加入底部输入框',
    placement: 'primary',
  };
}

export const imagePreviewAdapter: AssetPreviewAdapter = {
  type: 'image',
  label: '图片',
  getToolbarActions: (context) => [
    ...commonActions(context),
    { id: 'start-crop', label: '裁切', title: '进入裁切标注模式', placement: 'primary' },
    { id: 'run-rembg', label: '抠图', title: '调用本机 rembg 生成透明背景结果', placement: 'menu' },
  ],
  getInspectorSections: (context) => [
    ...commonInspectorSections(context),
    {
      id: 'image-settings',
      title: '图片预览',
      rows: [
        { label: '显示', value: context.previewLayout === 'flat' ? '平面' : context.previewLayout || '平面' },
        { label: '高级入口', value: '裁切 / 抠图 / 引用生成' },
      ],
    },
  ],
  getCapabilities: () => [{ capabilityId: 'create-preview-reference' }],
  getInputPolicy: () => ({ captureGlobalWheel: false }),
};

export const model3dPreviewAdapter: AssetPreviewAdapter = {
  type: 'model3d',
  label: '3D',
  getToolbarActions: (context) => [
    { id: 'reset-camera', label: '重置视角', title: '重置 3D 相机到默认构图', placement: 'primary' },
    {
      id: 'toggle-grid',
      label: context.model3dGridVisible ? '隐藏网格' : '网格',
      title: '显示或隐藏 3D 地面网格',
      placement: 'primary',
    },
    {
      id: 'toggle-backface-culling',
      label: context.model3dBackfaceCulling === false ? '背面消隐' : '显示背面',
      title: context.model3dBackfaceCulling === false ? '开启背面消隐，只显示模型正面' : '关闭背面消隐，双面显示薄片结构',
      placement: 'primary',
    },
    { id: 'display-mode', label: '显示模式', title: '材质 / 白模 / 线框 / 法线', placement: 'primary' },
    { id: 'capture-preview', label: '截图', title: '下载当前 3D 视角截图', placement: 'primary' },
  ],
  getInspectorSections: (context) => [
    ...commonInspectorSections(context),
    {
      id: 'model3d-stats',
      title: '当前资产信息',
      rows: model3dStatsRows(context),
    },
    {
      id: 'model3d-view',
      title: '3D 预览',
      rows: [
        { label: '显示模式', value: context.model3dDisplayMode || 'material' },
        { label: '网格', value: context.model3dGridVisible ? '显示' : '隐藏' },
        { label: '背面', value: context.model3dBackfaceCulling === false ? '双面显示' : '背面消隐' },
        { label: '文件', value: context.variant?.modelUrls?.length ? `${context.variant.modelUrls.length} 个模型文件` : '当前版本' },
      ],
    },
  ],
  getCapabilities: () => [{ capabilityId: 'create-preview-reference' }],
  getInputPolicy: () => ({ captureGlobalWheel: true }),
};

const textPreviewAdapter: AssetPreviewAdapter = {
  type: 'text',
  label: '文本',
  getToolbarActions: (context) => [...commonActions(context), addToInputAction()],
  getInspectorSections: commonInspectorSections,
  getCapabilities: () => [{ capabilityId: 'create-preview-reference' }],
  getInputPolicy: () => ({ captureGlobalWheel: false }),
};

const mediaPreviewAdapter = (type: WorkflowAssetKind, label: string): AssetPreviewAdapter => ({
  type,
  label,
  getToolbarActions: (context) => [
    ...commonActions(context),
    ...(type === 'video'
      ? [{ id: 'capture-preview', label: '截图', title: '下载当前视频帧截图', placement: 'primary' as const }]
      : []),
    addToInputAction(),
  ],
  getInspectorSections: commonInspectorSections,
  getCapabilities: () => [{ capabilityId: 'create-preview-reference' }],
  getInputPolicy: () => ({ captureGlobalWheel: type === 'video' || type === 'audio' }),
});

export const assetPreviewAdapterRegistry: Record<WorkflowAssetKind, AssetPreviewAdapter> = {
  image: imagePreviewAdapter,
  model3d: model3dPreviewAdapter,
  text: textPreviewAdapter,
  video: mediaPreviewAdapter('video', '视频'),
  audio: mediaPreviewAdapter('audio', '音频'),
  file: mediaPreviewAdapter('file', '文件'),
  storyboard_table: mediaPreviewAdapter('storyboard_table', '分镜表'),
  asset_set: mediaPreviewAdapter('asset_set', '资产集'),
  group: mediaPreviewAdapter('group', '组'),
};

export function getAssetPreviewAdapter(kind: WorkflowAssetKind): AssetPreviewAdapter {
  return assetPreviewAdapterRegistry[kind] || assetPreviewAdapterRegistry.file;
}

export function getAssetPreviewCapability(id: string): AssetCapability | null {
  return assetPreviewCapabilities[id] || null;
}
