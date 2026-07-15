import type { ProjectAgentToolDefinition, ProjectAgentToolId } from '../../../types/projectAgent';
import { PROJECT_AGENT_TOOL_IDS } from '../../../types/projectAgent';

/**
 * Project Agent tool ACI registry (§16.2 + P1 invoke_expert).
 * P0 media tools remain six; P1 adds one shared invoke_expert id (not per-expert).
 */
export const PROJECT_AGENT_TOOL_REGISTRY: readonly ProjectAgentToolDefinition[] = [
  {
    id: 'run_plain_text',
    label: '文生文',
    description: 'Plain text generation without a capability preset. Input: user text and optional textModel.',
  },
  {
    id: 'run_plain_i2t',
    label: '图生文',
    description: 'Visual question answering / image-to-text when an image is present.',
  },
  {
    id: 'run_plain_t2i',
    label: '文生图',
    description: 'Text-to-image with no main image. Input: text prompt and image settings.',
  },
  {
    id: 'run_plain_i2i',
    label: '图生图',
    description: 'Image-to-image when a main image asset is present. Input: text, mainAssetId, optional refs.',
  },
  {
    id: 'run_preset',
    label: '运行预设',
    description:
      'Execute one capability preset by presetId. Multiple preset cards → multiple run_preset steps (same tool id).',
  },
  {
    id: 'run_lightbox_local_edit',
    label: '局部重绘',
    description: 'Lightbox local inpaint/edit. Input: assetId, displayKey, hasLocalEdit context, optional text.',
  },
  {
    id: 'run_plain_3d',
    label: '生成3D',
    description: 'Quick 3D generation using an enabled generate_3d preset. Fails if none enabled.',
  },
  {
    id: 'invoke_expert',
    label: '调用专家',
    description:
      'Invoke a named Expert by expertId (§17). Loads Profile + Memory budget, returns Artifact ids. One tool id for all experts.',
  },
] as const;

const byId = new Map<ProjectAgentToolId, ProjectAgentToolDefinition>(
  PROJECT_AGENT_TOOL_REGISTRY.map((t) => [t.id, t])
);

export function getToolDefinition(id: ProjectAgentToolId): ProjectAgentToolDefinition | undefined {
  return byId.get(id);
}

export function assertRegistryComplete(): void {
  if (PROJECT_AGENT_TOOL_REGISTRY.length !== PROJECT_AGENT_TOOL_IDS.length) {
    throw new Error('Project Agent tool registry size mismatch');
  }
  for (const id of PROJECT_AGENT_TOOL_IDS) {
    if (!byId.has(id)) throw new Error(`Missing tool in registry: ${id}`);
  }
}
