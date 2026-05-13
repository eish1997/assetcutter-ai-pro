import type { RelaySupervisorStatus } from './relaySupervisor.js';
import type { SamLocalSupervisorStatus } from './samLocalSupervisor.js';

export type LocalCapabilityTone = 'ok' | 'warn';

/**
 * 网站 / 桌面壳「一条主结论」用：由伴侣 runtime-status 返回，避免用户直面 exit code。
 * 与 `docs/本地伴侣-本机能力用户体验与产品化路线图.md` §5.1 对齐。
 */
export type LocalCapabilityUiV1 = {
  tone: LocalCapabilityTone;
  /** 主标题（≤ 一行，不出现裸 exit=1） */
  headline: string;
  /** 副句：原因或下一步之一 */
  subline: string;
  /** 供折叠区 / 复制诊断：保留机器可读摘要 */
  detailMono?: string;
  samSpawn: {
    configured: boolean;
    running: boolean;
    /** 给人看的短标题 */
    humanTitle?: string;
    /** 给人看的说明 + 建议 */
    humanBody?: string;
    /** 简短步骤列表（UI 可渲染为 ol） */
    nextHints: string[];
  };
};

function formatSamSpawnTechnical(sam: SamLocalSupervisorStatus): string {
  const parts: string[] = [];
  if (sam.lastError) parts.push(`error=${sam.lastError}`);
  if (sam.lastExitCode != null) parts.push(`exit=${sam.lastExitCode}`);
  if (sam.lastSignal) parts.push(`signal=${sam.lastSignal}`);
  return parts.length ? `sam_spawn (${parts.join(', ')})` : 'sam_spawn';
}

function buildSamSpawnHuman(sam: SamLocalSupervisorStatus): {
  humanTitle: string;
  humanBody: string;
  nextHints: string[];
} {
  const exit = sam.lastExitCode;
  const err = (sam.lastError || '').trim();
  const title = '本机分割引擎未保持运行';
  let body =
    '已配置由本地伴侣自动拉起本机分割，但子进程没有常驻。常见原因：本机分割端口已被其他程序占用、Python 运行环境损坏或依赖未装全。';
  if (exit === 1 && !err) {
    body =
      '子进程以退出码 1 结束（多为启动命令或 Python 立即报错）。请查看桌面伴侣「本机引擎」下的安装日志，或在本机双击沙盒内的 start-sam-local.cmd 查看窗口中的英文报错。';
  } else if (exit === 1 && err) {
    body = `子进程以退出码 1 结束。系统记录：${err.slice(0, 200)}。请结合安装日志或命令行输出排查。`;
  } else if (exit != null && exit !== 0) {
    body = `子进程以退出码 ${exit} 结束。请查看安装日志或重启本地伴侣后再试。`;
  } else if (err) {
    body = `启动失败：${err.slice(0, 240)}`;
  }
  const hints = [
    '在桌面伴侣首页展开「安装日志」查看完整输出',
    '尝试「一键安装 / 再次安装修复」后重启本地伴侣',
    '确认本机未重复运行多份分割服务导致端口冲突（可先关闭多余终端再开桌面伴侣）',
  ];
  return { humanTitle: title, humanBody: body, nextHints: hints };
}

/**
 * 基于当前 supervisor 状态生成 UI 文案（不做 HTTP 探测，保持同步、低开销）。
 */
export function buildLocalCapabilityUi(
  relay: Pick<
    RelaySupervisorStatus,
    'configured' | 'running' | 'lastExitCode' | 'lastError' | 'lastSignal'
  >,
  samLocal: SamLocalSupervisorStatus,
): LocalCapabilityUiV1 {
  const samConfigured = samLocal.configured;
  const samRunning = samLocal.running;
  const relayBroken = relay.configured && !relay.running;
  const samBroken = samConfigured && !samRunning;

  if (relayBroken) {
    const parts: string[] = [];
    if (relay.lastError) parts.push(`error=${relay.lastError}`);
    if (relay.lastExitCode != null) parts.push(`exit=${relay.lastExitCode}`);
    if (relay.lastSignal) parts.push(`signal=${relay.lastSignal}`);
    return {
      tone: 'warn',
      headline: '需修复：站点中转（Relay）未运行',
      subline: '已配置自动拉起 Relay，但子进程未保持运行；站点自动化相关能力可能不可用。',
      detailMono: parts.length ? `relay_spawn (${parts.join(', ')})` : 'relay_spawn',
      samSpawn: {
        configured: samConfigured,
        running: samRunning,
        humanTitle: samBroken ? buildSamSpawnHuman(samLocal).humanTitle : undefined,
        humanBody: samBroken ? buildSamSpawnHuman(samLocal).humanBody : undefined,
        nextHints: samBroken ? buildSamSpawnHuman(samLocal).nextHints : [],
      },
    };
  }

  if (samBroken) {
    const h = buildSamSpawnHuman(samLocal);
    return {
      tone: 'warn',
      headline: '需修复：本机分割引擎未保持运行',
      subline: '启动脚本可能已就绪，但随伴侣拉起的分割服务未常驻；网站「本机分割」可能失败。',
      detailMono: formatSamSpawnTechnical(samLocal),
      samSpawn: {
        configured: true,
        running: false,
        humanTitle: h.humanTitle,
        humanBody: h.humanBody,
        nextHints: h.nextHints,
      },
    };
  }

  return {
    tone: 'ok',
    headline: '正常：本机能力未见阻塞',
    subline: relay.configured
      ? '伴侣与已配置子进程（Relay / 本机分割随启）当前未见异常。'
      : '伴侣运行中；未配置 Relay 时仅影响站点自动化类能力。',
    detailMono: undefined,
    samSpawn: {
      configured: samConfigured,
      running: samRunning,
      nextHints: [],
    },
  };
}

/** 与 `probeSamSegmentBackendHealth` 返回值对齐的最小字段（避免 UI 层依赖 compute 模块） */
export type SamHttpProbeMergeInput = {
  ok: boolean;
  samLocal?: { latencyMs?: number };
};

/**
 * 当伴侣记录的「随启子进程」未挂接，但本机分割 HTTP `/health` 已成功时，放宽一条主结论与托盘语义（P1）。
 * Relay 异常优先：不覆盖含 Relay 的 warn 文案。
 */
export function mergeLocalCapabilityUiWithSamHttpProbe(
  ui: LocalCapabilityUiV1,
  probe: SamHttpProbeMergeInput,
): LocalCapabilityUiV1 {
  if (!probe.ok) return ui;
  if (ui.headline.includes('Relay')) return ui;
  const spawnDetached = ui.samSpawn.configured && !ui.samSpawn.running;
  if (!spawnDetached) return ui;
  const lat = probe.samLocal?.latencyMs;
  const latText = typeof lat === 'number' && Number.isFinite(lat) ? `${lat} ms` : '—';
  return {
    tone: 'ok',
    headline: '正常：本机分割服务可用（伴侣随启未挂接）',
    subline: `已探测分割服务健康检查成功（约 ${latText}）。网站「本机分割」通常仍可用。`,
    detailMono: ui.detailMono,
    samSpawn: {
      configured: true,
      running: false,
      humanTitle: '伴侣侧随启进程未保持',
      humanBody:
        'HTTP /health 正常，说明分割引擎已在运行（可能为外部进程、手动启动或另一终端）。这与伴侣记录的「随启子进程」不一致时，网站能力通常不受影响。',
      nextHints: [
        '若希望由伴侣统一拉起：在桌面壳「本机引擎」检查安装日志后重启本地伴侣',
        '若网站分割仍失败：在网站设置中复制诊断信息并核对 COMPANION_SAM_SEGMENT_URL',
      ],
    },
  };
}

export type RembgPythonProbeMergeInput = {
  ok: boolean;
  code?: string;
  error?: string;
};

/**
 * 将 rembg Python 探测结果并入一条主结论：Relay / 本机分割 warn 优先，仅追加副句；
 * 在整体为 ok 时，rembg 失败单独升为「需关注：去背景」warn。
 */
export function mergeLocalCapabilityUiWithRembgPythonProbe(
  ui: LocalCapabilityUiV1,
  rembg: RembgPythonProbeMergeInput,
): LocalCapabilityUiV1 {
  if (rembg.ok) return ui;

  const errRaw = (rembg.error || '').trim();
  const errTail = errRaw.slice(0, 200);
  const rembgLine = errTail
    ? `去背景（rembg）探测未通过：${errTail}${errRaw.length > 200 ? '…' : ''}`
    : '去背景（rembg）探测未通过（请检查 COMPANION_REMBG_PYTHON 与 pip 安装 rembg）。';
  const tech = rembg.code ? `rembg_probe (${rembg.code})` : 'rembg_probe';

  if (ui.headline.includes('Relay') || ui.tone === 'warn') {
    return {
      ...ui,
      subline: ui.subline ? `${ui.subline}；${rembgLine}` : rembgLine,
    };
  }

  return {
    tone: 'warn',
    headline: '需关注：去背景（rembg）环境未就绪',
    subline: `${ui.headline}。${rembgLine}`,
    detailMono: ui.detailMono ? `${ui.detailMono}; ${tech}` : tech,
    samSpawn: ui.samSpawn,
  };
}
