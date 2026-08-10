import {
  getAdobeBridgeStatus,
  installAdobeBridge,
  uninstallAdobeBridge,
  type AdobeBridgeId,
} from '../bridges/adobeExtendScriptBridgeInstall.js';
import {
  getBlenderBridgeStatus,
  installBlenderBridge,
  uninstallBlenderBridge,
} from '../bridges/blenderBridgeInstall.js';
import { closeHostApp, launchHostApp, saveRunningHostTarget } from '../bridges/hostAppProcess.js';
import { runShellTool } from '../shellToolRun.js';
import {
  appendCapabilityPackageEvent,
  readCapabilityPackageDraft,
  updateCapabilityPackageDraft,
} from './capabilityPackageStore.js';
import { buildCapabilityPackageContext } from './capabilityContext.js';
import { publishCapabilityDraftToCloud, switchCapabilityCloudVersion } from './capabilityCloudVersions.js';
import { runWorkflowCapability } from '../workflows/runWorkflowCapability.js';

type TemplateMissingLifecycleResult = {
  ok: false;
  error: 'template_missing';
  message: string;
  nextAction: string;
  supportedActions: string[];
};

export type CapabilityLifecycleInput = {
  targetDir?: string;
  scriptsDirs?: string[];
  port?: number;
  executablePath?: string;
  targetId?: string;
  actionId?: string;
  params?: unknown;
  actorRole?: string;
  isAdmin?: boolean;
  semver?: string;
  versionId?: string;
  versionNote?: string;
  publishedBy?: string;
  baseUrl?: string;
  historyPath?: string;
};

export type CapabilityLifecycleAction =
  | 'validate'
  | 'install'
  | 'run'
  | 'probe'
  | 'uninstall'
  | 'launch'
  | 'close'
  | 'discover_running'
  | 'publish'
  | 'switch_version'
  | 'open_conversation';

type SupportedSoftwareBridge =
  | { kind: 'adobe'; softwareId: AdobeBridgeId }
  | { kind: 'blender'; softwareId: 'blender' };

function supportedBridgeForDraft(id: string): SupportedSoftwareBridge | null {
  const draft = readCapabilityPackageDraft(id);
  if (!draft || draft.type !== 'software_connection') return null;
  const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const text = [
    draft.id,
    draft.name,
    String((manifest as Record<string, unknown>).appName || ''),
    String((manifest as Record<string, unknown>).hostId || ''),
    String((manifest as Record<string, unknown>).softwareId || ''),
    String((manifest as Record<string, unknown>).templateHint || ''),
  ]
    .join(' ')
    .toLowerCase();
  if (/\bphotoshop\b|adobe photoshop|extendscript_heartbeat/.test(text)) return { kind: 'adobe', softwareId: 'photoshop' };
  if (/\bblender\b|blender_http|blender_startup|python_http/.test(text)) return { kind: 'blender', softwareId: 'blender' };
  return null;
}

function softwareHostIdForDraft(id: string): string | null {
  const draft = readCapabilityPackageDraft(id);
  if (!draft || draft.type !== 'software_connection') return null;
  const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const explicit = String((manifest as Record<string, unknown>).hostId || (manifest as Record<string, unknown>).softwareId || '').trim();
  if (explicit) return explicit.toLowerCase();
  const text = `${draft.id} ${draft.name} ${String((manifest as Record<string, unknown>).appName || '')}`.toLowerCase();
  if (/\bphotoshop\b|adobe photoshop/.test(text)) return 'photoshop';
  return null;
}

function appendLifecycleEvent(
  id: string,
  action: string,
  ok: boolean,
  message: string,
  detail?: unknown,
): unknown {
  return appendCapabilityPackageEvent(id, {
    kind: `${action}_${ok ? 'passed' : 'failed'}`,
    ok,
    message,
    detail,
  });
}

function templateMissingLifecycleResult(id: string, action: 'install' | 'probe' | 'uninstall'): TemplateMissingLifecycleResult {
  const message = '当前软件还没有接入真实安装/探测模板。';
  const nextAction = '可先启动或识别运行中的软件；真实连接需要 Copilot 或开发者补齐模板。';
  const supportedActions = ['agent_loop', 'conversation', 'discover_running', 'launch', 'close', 'export'];
  appendCapabilityPackageEvent(id, {
    kind: 'template_missing',
    ok: false,
    message,
    detail: {
      action,
      error: 'template_missing',
      nextAction,
      supportedActions,
    },
  });
  return {
    ok: false,
    error: 'template_missing',
    message,
    nextAction,
    supportedActions,
  };
}

export async function installCapabilityPackage(
  id: string,
  input: CapabilityLifecycleInput = {},
): Promise<
  { ok: true; result: unknown; draft: unknown } | { ok: false; error: string; message: string; nextAction?: string; supportedActions?: string[] }
> {
  const bridge = supportedBridgeForDraft(id);
  if (!bridge) {
    return templateMissingLifecycleResult(id, 'install');
  }
  const targetDirs = Array.isArray(input.scriptsDirs)
    ? input.scriptsDirs
    : input.targetDir
      ? [input.targetDir]
      : undefined;
  const result =
    bridge.kind === 'blender'
      ? installBlenderBridge({ startupDirs: targetDirs, port: input.port })
      : installAdobeBridge(bridge.softwareId, { scriptsDirs: targetDirs, port: input.port });
  if (!result.ok) {
    appendLifecycleEvent(id, 'install', false, result.message, result);
    return result;
  }
  updateCapabilityPackageDraft(id, (current) => ({
    ...current,
    draftStatus: 'validated',
    lastInstall: {
      ok: true,
      at: new Date().toISOString(),
      softwareId: bridge.softwareId,
      result,
    },
  }));
  const draft = appendLifecycleEvent(id, 'install', true, result.message || '连接脚本安装完成。', result);
  return { ok: true, result, draft };
}

export async function probeCapabilityPackage(
  id: string,
): Promise<
  { ok: true; result: unknown; draft: unknown } | { ok: false; error: string; message: string; result?: unknown; nextAction?: string; supportedActions?: string[] }
> {
  const bridge = supportedBridgeForDraft(id);
  if (!bridge) {
    return templateMissingLifecycleResult(id, 'probe');
  }
  const status = bridge.kind === 'blender' ? await getBlenderBridgeStatus() : await getAdobeBridgeStatus(bridge.softwareId);
  const probe = status.probe || { ok: false, message: 'Photoshop 探测失败。' };
  const draft = updateCapabilityPackageDraft(id, (current) => ({
    ...current,
    draftStatus: probe.ok ? 'validated' : current.draftStatus,
    lastProbe: {
      ok: Boolean(probe.ok),
      at: new Date().toISOString(),
      softwareId: bridge.softwareId,
      result: probe,
    },
  }));
  if (!probe.ok) {
    appendLifecycleEvent(id, 'probe', false, String(probe.message || 'Photoshop 探测失败。'), probe);
    return {
      ok: false,
      error: 'capability_probe_failed',
      message: String(probe.message || 'Photoshop 探测失败。'),
      result: probe,
    };
  }
  const next = appendLifecycleEvent(id, 'probe', true, String(probe.message || 'Photoshop 探测成功。'), probe);
  return { ok: true, result: probe, draft: next || draft };
}

export async function uninstallCapabilityPackage(
  id: string,
  input: CapabilityLifecycleInput = {},
): Promise<
  { ok: true; result: unknown; draft: unknown } | { ok: false; error: string; message: string; nextAction?: string; supportedActions?: string[] }
> {
  const bridge = supportedBridgeForDraft(id);
  if (!bridge) {
    return templateMissingLifecycleResult(id, 'uninstall');
  }
  const targetDirs = Array.isArray(input.scriptsDirs)
    ? input.scriptsDirs
    : input.targetDir
      ? [input.targetDir]
      : undefined;
  const result =
    bridge.kind === 'blender'
      ? uninstallBlenderBridge({ startupDirs: targetDirs })
      : uninstallAdobeBridge(bridge.softwareId, { scriptsDirs: targetDirs });
  updateCapabilityPackageDraft(id, (current) => ({
    ...current,
    lastInstall: {
      ok: false,
      at: new Date().toISOString(),
      softwareId: bridge.softwareId,
      result,
    },
  }));
  const uninstallMessage =
    result.ok ? '连接脚本卸载完成。' : 'message' in result ? String(result.message || '') : '连接脚本卸载失败。';
  const draft = appendLifecycleEvent(id, 'uninstall', result.ok, uninstallMessage, result);
  return { ok: true, result, draft };
}

async function runSoftwareConnectionProcessLifecycle(
  id: string,
  action: 'launch' | 'close' | 'discover_running',
  input: CapabilityLifecycleInput = {},
): Promise<{ ok: true; result: unknown; draft: unknown } | { ok: false; error: string; message: string; result?: unknown }> {
  const hostId = softwareHostIdForDraft(id);
  if (!hostId) {
    return {
      ok: false,
      error: 'unsupported_capability_host_process',
      message: 'This software connection does not yet declare a supported host process id.',
    };
  }
  const draft = readCapabilityPackageDraft(id);
  const manifest = draft && draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const manifestExecutablePath = String((manifest as Record<string, unknown>).executablePath || '').trim();
  const result =
    action === 'launch'
      ? launchHostApp(hostId, {
          executablePath: input.executablePath || manifestExecutablePath,
          versionId: input.versionId,
          targetId: input.targetId,
        })
      : action === 'discover_running'
        ? saveRunningHostTarget(hostId)
        : closeHostApp(hostId);
  const next = appendCapabilityPackageEvent(id, {
    kind: result.ok ? `${action}_passed` : `${action}_failed`,
    ok: result.ok,
    message: result.message,
    detail: result,
  });
  if (!result.ok) {
    return { ok: false, error: result.error || `capability_${action}_failed`, message: result.message, result };
  }
  return { ok: true, result, draft: next };
}

async function runToolCapabilityPackage(
  id: string,
  input: CapabilityLifecycleInput = {},
): Promise<{ ok: true; result: unknown; draft: unknown } | { ok: false; error: string; message: string; result?: unknown }> {
  const draft = readCapabilityPackageDraft(id);
  if (!draft || draft.type !== 'tool') {
    return { ok: false, error: 'unsupported_capability_run', message: '当前 run 生命周期只支持工具能力包。' };
  }
  const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const toolId = String(manifest.authoredToolId || manifest.toolId || draft.id || '').trim();
  if (!toolId) return { ok: false, error: 'tool_id_missing', message: '工具能力包缺少 toolId。' };
  const result = await runShellTool({ toolId, actionId: input.actionId, params: input.params || {} });
  const eventKind = result.ok ? 'run_passed' : 'run_failed';
  const message = result.ok
    ? `工具运行成功：${toolId}`
    : `工具运行失败：${'error' in result ? result.error : 'unknown_error'}`;
  const next = appendCapabilityPackageEvent(id, { kind: eventKind, ok: result.ok, message, detail: result });
  if (!result.ok) {
    return { ok: false, error: 'capability_run_failed', message, result };
  }
  return { ok: true, result, draft: next };
}

async function runWorkflowCapabilityPackage(
  id: string,
  input: CapabilityLifecycleInput = {},
): Promise<{ ok: true; result: unknown; draft: unknown } | { ok: false; error: string; message: string; result?: unknown }> {
  const draft = readCapabilityPackageDraft(id);
  if (!draft || draft.type !== 'workflow') {
    return { ok: false, error: 'unsupported_capability_run', message: '当前 run 生命周期只支持 workflow 能力包。' };
  }
  const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const workflowId = String((manifest as Record<string, unknown>).workflowId || draft.id || '').trim();
  const result = await runWorkflowCapability({
    baseUrl: input.baseUrl,
    historyPath: input.historyPath,
    params: input.params,
    workflowId,
  });
  const next = appendCapabilityPackageEvent(id, {
    kind: result.ok ? 'workflow_run_passed' : 'workflow_run_failed',
    ok: result.ok,
    message: result.message,
    detail: result,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: 'error' in result && result.error ? result.error : 'workflow_run_failed',
      message: result.message,
      result,
    };
  }
  return { ok: true, result: result.result, draft: next };
}

export async function runCapabilityLifecycle(
  id: string,
  action: CapabilityLifecycleAction,
  input: CapabilityLifecycleInput = {},
): Promise<
  | { ok: true; action: CapabilityLifecycleAction; result: unknown; draft?: unknown }
  | {
      ok: false;
      action: CapabilityLifecycleAction;
      error: string;
      message: string;
      result?: unknown;
      nextAction?: string;
      supportedActions?: string[];
    }
> {
  if (action === 'validate') {
    const context = buildCapabilityPackageContext(id);
    if (!context.ok) return { ...context, ok: false, action };
    return { ok: true, action, result: context.package };
  }
  if (action === 'install') {
    const result = await installCapabilityPackage(id, input);
    return result.ok ? { ok: true, action, result: result.result, draft: result.draft } : { ...result, action };
  }
  if (action === 'run') {
    const draft = readCapabilityPackageDraft(id);
    if (draft && draft.type === 'workflow') {
      const result = await runWorkflowCapabilityPackage(id, input);
      return result.ok ? { ok: true, action, result: result.result, draft: result.draft } : { ...result, action };
    }
    const result = await runToolCapabilityPackage(id, input);
    return result.ok ? { ok: true, action, result: result.result, draft: result.draft } : { ...result, action };
  }
  if (action === 'probe') {
    const result = await probeCapabilityPackage(id);
    return result.ok ? { ok: true, action, result: result.result, draft: result.draft } : { ...result, action };
  }
  if (action === 'uninstall') {
    const result = await uninstallCapabilityPackage(id, input);
    return result.ok ? { ok: true, action, result: result.result, draft: result.draft } : { ...result, action };
  }
  if (action === 'launch' || action === 'close' || action === 'discover_running') {
    const result = await runSoftwareConnectionProcessLifecycle(id, action, input);
    return result.ok ? { ok: true, action, result: result.result, draft: result.draft } : { ...result, action };
  }
  if (action === 'open_conversation') {
    const context = buildCapabilityPackageContext(id);
    if (!context.ok) return { ...context, ok: false, action };
    return { ok: true, action, result: context };
  }
  if (action === 'publish') {
    const published = publishCapabilityDraftToCloud(id, {
      actorRole: input.actorRole,
      isAdmin: input.isAdmin,
      semver: input.semver,
      versionNote: input.versionNote,
      publishedBy: input.publishedBy,
    });
    return published.ok
      ? { ok: true, action, result: published }
      : { ok: false, action, error: published.error, message: published.message, result: published };
  }
  if (action === 'switch_version') {
    const switched = switchCapabilityCloudVersion(id, String(input.versionId || ''), {
      actorRole: input.actorRole,
      isAdmin: input.isAdmin,
    });
    return switched.ok
      ? { ok: true, action, result: switched }
      : { ok: false, action, error: switched.error, message: switched.message, result: switched };
  }
  return {
    ok: false,
    action,
    error: 'capability_lifecycle_not_enabled',
    message: `${action} 生命周期已登记，但当前阶段尚未启用。`,
  };
}
