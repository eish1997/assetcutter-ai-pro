import { readCapabilityPackageDraft } from './capabilityPackageStore.js';
import { deriveSoftwareConnectionState, type ConnectionState } from './softwareConnectionState.js';

function stringifyCompact(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function eventFromRecord(kind: string, record: unknown): { kind: string; ok: boolean; at: string; message: string } | null {
  if (!record || typeof record !== 'object') return null;
  const row = record as Record<string, unknown>;
  const result = row.result && typeof row.result === 'object' ? (row.result as Record<string, unknown>) : {};
  return {
    kind,
    ok: row.ok === true,
    at: typeof row.at === 'string' ? row.at : '',
    message: String(result.message || row.message || ''),
  };
}

function eventFromDraftEvent(event: unknown): { kind: string; ok: boolean; at: string; message: string } | null {
  if (!event || typeof event !== 'object') return null;
  const row = event as Record<string, unknown>;
  return {
    kind: String(row.kind || 'event'),
    ok: row.ok === true,
    at: typeof row.at === 'string' ? row.at : '',
    message: String(row.message || ''),
  };
}

function latestFailedEvent(
  events: Array<{ kind: string; ok: boolean; at: string; message: string }>,
): { kind: string; ok: boolean; at: string; message: string } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && event.ok !== true) return event;
  }
  return null;
}

function nextStepHintsForDraft(
  draft: { type: string; name: string; manifest?: Record<string, unknown> },
  latestFailure: { kind: string; message: string } | null,
): string[] {
  const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const hints: string[] = [];
  const templateHint = String(manifest.templateHint || '').trim();
  const droppedFrom = String(manifest.droppedFrom || '').trim();
  const executablePath = String(manifest.executablePath || '').trim();
  const shortcutPath = String(manifest.shortcutPath || '').trim();
  const hostId = String(manifest.hostId || '').trim();
  if (droppedFrom === 'connection_page') {
    hints.push(
      `拖拽创建来源: ${shortcutPath || executablePath || 'unknown'}；解析到的程序: ${executablePath || 'unknown'}。`,
    );
    if (!hostId) {
      hints.push('下一步: 这是未知软件连接草稿，需要先通过对象对话补齐 hostId、安装方式和真实探测方式，不能把 exe 存在当作连接成功。');
    }
  }
  if (draft.type === 'software_connection' && hostId) {
    hints.push('下一步: 如需启动/关闭软件，只能使用 ac.capability.lifecycle_run 的 launch/close/discover_running，并继续遵守 hostId 白名单。');
  }
  if (templateHint === 'extendscript_heartbeat' || /\bphotoshop\b/i.test(`${draft.name} ${hostId}`)) {
    hints.push('下一步: Photoshop 探测失败时，请先确认已在 Photoshop 菜单中运行 AssetCutter 连接脚本，再重新 ac.capability.probe。');
  }
  if (latestFailure) {
    hints.push(`最近失败: ${latestFailure.kind}${latestFailure.message ? ' - ' + latestFailure.message : ''}。`);
  }
  if (draft.type === 'workflow') {
    hints.push('下一步: workflow 已接入本地 AssetCutter Workflow Runtime；run 会先做预检，失败时返回 RepairAction。');
  }
  return Array.from(new Set(hints.filter((line) => String(line || '').trim()))).slice(0, 5);
}

export function buildCapabilityPackageContext(idRaw: string):
  | {
      ok: true;
      package: unknown;
      session: { type: 'capability'; id: string; sessionId: string; label: string };
      recentEvents: Array<{ kind: string; ok: boolean; at: string; message: string }>;
      connectionState?: ConnectionState;
      contextPrompt: string;
    }
  | { ok: false; error: string; message: string } {
  const draft = readCapabilityPackageDraft(idRaw);
  if (!draft) {
    return { ok: false, error: 'capability_not_found', message: `能力包不存在：${idRaw}` };
  }
  const manifest = draft.manifest && typeof draft.manifest === 'object' ? draft.manifest : {};
  const lastInstall = draft.lastInstall;
  const lastProbe = draft.lastProbe;
  const recordedEvents = Array.isArray(draft.events) ? draft.events.map(eventFromDraftEvent).filter(Boolean) : [];
  const recentEvents = [eventFromRecord('install', lastInstall), eventFromRecord('probe', lastProbe), ...recordedEvents]
    .filter(Boolean)
    .slice(-20) as Array<{ kind: string; ok: boolean; at: string; message: string }>;
  const latestFailure = latestFailedEvent(recentEvents);
  const connectionState = draft.type === 'software_connection' ? deriveSoftwareConnectionState(draft) : undefined;
  const nextStepHints = nextStepHintsForDraft(
    { type: draft.type, name: draft.name, manifest: manifest as Record<string, unknown> },
    latestFailure,
  );
  const sessionId = draft.conversation?.sessionId || `capability:${draft.type}:${draft.id}`;
  const lines = [
    '当前对话绑定到一个能力包对象，请只围绕这个对象继续修改、安装、探测、排错和发布。',
    `能力包 ID: ${draft.id}`,
    `名称: ${draft.name}`,
    `类型: ${draft.type}`,
    `来源: ${draft.source}`,
    `草稿状态: ${draft.draftStatus}`,
    `会话 ID: ${sessionId}`,
    `目标软件: ${String((manifest as Record<string, unknown>).appName || draft.name || '')}`,
    `连接提示: ${String((manifest as Record<string, unknown>).templateHint || '')}`,
    `manifest: ${stringifyCompact(manifest)}`,
    `lastInstall: ${stringifyCompact(lastInstall)}`,
    `lastProbe: ${stringifyCompact(lastProbe)}`,
    `recentEvents: ${stringifyCompact(recentEvents)}`,
    `latestFailure: ${stringifyCompact(latestFailure)}`,
    connectionState ? `connectionState: ${stringifyCompact(connectionState)}` : '',
    `nextStepHints: ${stringifyCompact(nextStepHints)}`,
    '生命周期工具: ac.capability.install, ac.capability.probe, ac.capability.uninstall。',
    '真实连接门禁: 文件存在、卡片存在、安装记录存在都不算连接成功；必须 ac.capability.probe 收到真实 heartbeat/host signal。',
    '不要恢复旧 62 宿主 catalog；旧 host bridge 只能作为 legacy 参考。',
  ];
  if (draft.type === 'workflow') {
    lines.push(
      'Lifecycle tools: workflow drafts support validate, run, open_conversation, publish, and switch_version locally. Workflow run is handled by AssetCutter local Workflow Runtime with preflight, Artifact, ReplaySnapshot, and RepairAction records.',
    );
  }
  if (draft.type === 'software_connection') {
    lines.push(
      'Process lifecycle tools: ac.capability.lifecycle_run supports action=launch, close, and discover_running for supported software connections; executable paths must match the known host executable.',
      connectionState
        ? `Connection maturity: ${connectionState.maturity} / ${connectionState.label}. Available actions: ${connectionState.availableActions.join(', ')}. Blocked reason: ${connectionState.blockedReason || 'none'}. Next action: ${connectionState.nextAction}`
        : '',
      connectionState && connectionState.maturity === 'template_missing'
        ? 'Template missing: this connection can still use launch, close, discover_running, export, and object conversation now; real bridge install/probe/uninstall is not connected yet. Copilot should call ac.capability.template_draft_create on this same CapabilityPackage to create a draft bridge-template plan. Infer kind as executable, script_dcc, project_plugin, command_port, heartbeat, or unknown. Do not write production bridge definitions until real software acceptance passes.'
        : '',
    );
  }
  const contextLines = lines.filter((line) => {
    const text = String(line || '');
    if (draft.type === 'software_connection') return true;
    return !/heartbeat|host signal/.test(text);
  });
  return {
    ok: true,
    package: draft,
    session: {
      type: 'capability',
      id: draft.id,
      sessionId,
      label: draft.name || draft.id,
    },
    recentEvents,
    ...(connectionState ? { connectionState } : {}),
    contextPrompt: contextLines.filter((line) => String(line || '').trim()).join('\n'),
  };
}
