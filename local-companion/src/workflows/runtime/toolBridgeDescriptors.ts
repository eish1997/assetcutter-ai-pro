import {
  booleanSchema,
  numberSchema,
  objectSchema,
  stringSchema,
  type JsonSchema,
} from './jsonSchema.js';
import type { ToolBridgeRiskLevel } from './toolBridgeInvocation.js';

export type ToolBridgeTransport = 'mcp' | 'http' | 'local_bridge';

export type ToolBridgeDescriptor = {
  approval_required: boolean;
  description: string;
  idempotent: boolean;
  input_schema: JsonSchema;
  name: string;
  output_schema: JsonSchema;
  owner: 'AssetCutter';
  permissions: string[];
  retryable: boolean;
  risk_level: ToolBridgeRiskLevel;
  supported_transports: ToolBridgeTransport[];
  tags: string[];
  timeout_ms: number;
  title: string;
  version: string;
};

export type McpToolListItem = {
  description: string;
  inputSchema: JsonSchema;
  name: string;
  title: string;
};

export type HttpToolListItem = ToolBridgeDescriptor;

const commonTransports: ToolBridgeTransport[] = ['mcp', 'http', 'local_bridge'];

export const toolBridgeDescriptors = [
  {
    name: 'workflow.maya.export_selection_fbx',
    title: 'Export Maya Selection to FBX',
    version: '1.0.0',
    description: 'Run the Maya FBX export workflow step through the local AssetCutter workflow runtime.',
    input_schema: objectSchema(
      {
        output_path: stringSchema(),
        overwrite: booleanSchema(),
      },
      ['output_path', 'overwrite'],
    ),
    output_schema: objectSchema(
      {
        asset_id: stringSchema(),
        bytes: numberSchema(),
        local_path: stringSchema(),
        storage_uri: stringSchema(),
        trace_id: stringSchema(),
      },
      ['storage_uri', 'trace_id'],
    ),
    permissions: ['workflow:run', 'asset:register', 'connector:maya'],
    risk_level: 'high',
    approval_required: false,
    idempotent: true,
    retryable: true,
    timeout_ms: 60000,
    owner: 'AssetCutter',
    tags: ['maya', 'fbx', 'workflow', 'tool-bridge'],
    supported_transports: commonTransports,
  },
  {
    name: 'scriptHub.maya.export_selection_fbx',
    title: 'Export Maya Selection to FBX (legacy alias)',
    version: '1.0.0',
    description: 'Legacy ScriptHub alias for workflow.maya.export_selection_fbx.',
    input_schema: objectSchema(
      {
        output_path: stringSchema(),
        overwrite: booleanSchema(),
      },
      ['output_path', 'overwrite'],
    ),
    output_schema: objectSchema(
      {
        asset_id: stringSchema(),
        bytes: numberSchema(),
        local_path: stringSchema(),
        storage_uri: stringSchema(),
        trace_id: stringSchema(),
      },
      ['storage_uri', 'trace_id'],
    ),
    permissions: ['workflow:run', 'asset:register', 'connector:maya'],
    risk_level: 'high',
    approval_required: false,
    idempotent: true,
    retryable: true,
    timeout_ms: 60000,
    owner: 'AssetCutter',
    tags: ['maya', 'fbx', 'workflow', 'tool-bridge', 'legacy'],
    supported_transports: commonTransports,
  },
] satisfies ToolBridgeDescriptor[];

export function listToolBridgeDescriptors() {
  return toolBridgeDescriptors;
}

export function getToolBridgeDescriptor(name: string) {
  return toolBridgeDescriptors.find((descriptor) => descriptor.name === name);
}

export function listMcpToolDescriptors(): McpToolListItem[] {
  return toolBridgeDescriptors.map((descriptor) => ({
    description: descriptor.description,
    inputSchema: descriptor.input_schema,
    name: descriptor.name,
    title: descriptor.title,
  }));
}

export function listHttpToolDescriptors(): HttpToolListItem[] {
  return toolBridgeDescriptors;
}
