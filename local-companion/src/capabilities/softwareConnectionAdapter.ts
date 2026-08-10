import { assertValidCapabilityPackage, normalizeCapabilityId, type CapabilityPackage } from './capabilityPackages.js';

export type SoftwareConnectionDraftLike = {
  id?: string;
  name: string;
  appName?: string;
  description?: string;
  tags?: unknown;
  templateHint?: string;
  manifest?: Record<string, unknown>;
};

export type ConnectionTemplateDraftKind =
  | 'executable'
  | 'script_dcc'
  | 'project_plugin'
  | 'command_port'
  | 'heartbeat'
  | 'unknown';

export type ConnectionTemplateDraftInput = {
  hostId?: string;
  appName?: string;
  kind?: string;
  files?: unknown;
  requiredUserDirs?: unknown;
  probeSignal?: string;
  safetyBoundaries?: unknown;
  notes?: string;
};

export type ConnectionTemplateDraft = {
  schemaVersion: 1;
  status: 'draft';
  hostId: string;
  appName: string;
  kind: ConnectionTemplateDraftKind;
  files: string[];
  requiredUserDirs: string[];
  probeSignal: string;
  safetyBoundaries: string[];
  notes: string;
  productionDefinition: false;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 12) : [];
}

function normalizeTemplateKind(value: unknown): ConnectionTemplateDraftKind {
  const text = String(value || '').trim();
  if (['executable', 'script_dcc', 'project_plugin', 'command_port', 'heartbeat'].includes(text)) {
    return text as ConnectionTemplateDraftKind;
  }
  return 'unknown';
}

export function buildConnectionTemplateDraft(input: ConnectionTemplateDraftInput): ConnectionTemplateDraft {
  const hostId = normalizeCapabilityId(String(input.hostId || input.appName || 'unknown-host')) || 'unknown-host';
  const appName = String(input.appName || input.hostId || hostId).trim() || hostId;
  const kind = normalizeTemplateKind(input.kind);
  const defaultsByKind: Record<ConnectionTemplateDraftKind, Pick<ConnectionTemplateDraft, 'files' | 'requiredUserDirs' | 'probeSignal' | 'safetyBoundaries'>> = {
    executable: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`],
      requiredUserDirs: ['软件安装目录或可执行文件路径'],
      probeSignal: '目标软件真实进程存在，且可由白名单 hostId 匹配到可执行文件路径',
      safetyBoundaries: ['只能启动用户确认过的可执行文件路径', '不能把进程存在当作桥接已连通', '未真实 probe 前不能发布云端正式版本'],
    },
    script_dcc: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-heartbeat.js`],
      requiredUserDirs: ['宿主脚本目录或用户插件目录'],
      probeSignal: `${appName} 内运行脚本后写入的新鲜 heartbeat 文件`,
      safetyBoundaries: ['只写入用户选择的脚本目录', 'heartbeat 必须由真实宿主脚本生成', '未真实验收前不能写入生产 bridge definition'],
    },
    project_plugin: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-project-plugin/`],
      requiredUserDirs: ['真实项目根目录'],
      probeSignal: `${appName} 项目插件加载后返回的 HTTP health 或插件回调`,
      safetyBoundaries: ['只修改用户选择的项目目录', '不能跨项目安装', '插件未加载前不能标记 connected'],
    },
    command_port: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-command-port.js`],
      requiredUserDirs: ['宿主脚本目录或启动脚本目录'],
      probeSignal: `${appName} command port 返回真实宿主响应`,
      safetyBoundaries: ['端口必须绑定本机', '命令必须走白名单', '不能用端口打开但无宿主响应冒充成功'],
    },
    heartbeat: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`, `local-companion/src/bridges/templates/${hostId}-heartbeat.js`],
      requiredUserDirs: ['宿主脚本目录'],
      probeSignal: `${appName} 写入的新鲜 heartbeat 文件，内容包含 hostId 和时间戳`,
      safetyBoundaries: ['heartbeat 必须新鲜且 hostId 匹配', '不能用历史 heartbeat 冒充成功', '未真实运行宿主前不能发布'],
    },
    unknown: {
      files: [`local-companion/src/bridges/${hostId}BridgeInstall.ts`],
      requiredUserDirs: ['待 Copilot 与用户确认的软件目录或脚本目录'],
      probeSignal: '真实软件进程、HTTP health、command port 或 heartbeat 信号',
      safetyBoundaries: ['先识别软件形态再生成正式模板', '不能把文件存在或安装记录当作连接成功', '未真实验收前不能发布云端正式版本'],
    },
  };
  const defaults = defaultsByKind[kind];
  const files = stringList(input.files);
  const requiredUserDirs = stringList(input.requiredUserDirs);
  const safetyBoundaries = stringList(input.safetyBoundaries);
  return {
    schemaVersion: 1,
    status: 'draft',
    hostId,
    appName,
    kind,
    files: files.length ? files : defaults.files,
    requiredUserDirs: requiredUserDirs.length ? requiredUserDirs : defaults.requiredUserDirs,
    probeSignal: String(input.probeSignal || '').trim() || defaults.probeSignal,
    safetyBoundaries: safetyBoundaries.length ? safetyBoundaries : defaults.safetyBoundaries,
    notes: String(input.notes || '').trim(),
    productionDefinition: false,
  };
}

export function softwareConnectionDraftToCapabilityPackage(input: SoftwareConnectionDraftLike): CapabilityPackage {
  const appName = String(input.appName || input.name || '').trim();
  const id = normalizeCapabilityId(input.id || appName || 'software-connection');
  const name = appName || id;
  const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [];
  return assertValidCapabilityPackage({
    id,
    type: 'software_connection',
    source: 'draft',
    name,
    description: String(input.description || `${name} 本机软件连接`).trim(),
    tags,
    manifest: {
      ...(input.manifest || {}),
      kind: 'software_connection',
      appName: name,
      templateHint: String(input.templateHint || '').trim(),
    },
    lifecycle: {
      validate: 'software_connection.validate',
      install: 'software_connection.install',
      run: 'software_connection.launch',
      probe: 'software_connection.probe',
      uninstall: 'software_connection.uninstall',
      publish: 'software_connection.publish',
    },
    conversation: {
      sessionId: `capability:software_connection:${id}`,
      contextProvider: 'softwareConnectionAdapter',
    },
    governance: {
      requiresAdminToPublish: true,
      requiresRealProbeToPublish: true,
      cloudVersioned: true,
    },
  });
}
