import { probeCompanionHealth } from '../companionClient/probe';
import { normalizeCompanionBaseUrl } from '../companionLocalPrefs';
import { resolveTripoProxyBase } from '../tripoService';

export type Generate3dPreflightResult = {
  ok: boolean;
  warnings: string[];
};

async function probeTripoProxyReachable(): Promise<boolean> {
  const base = resolveTripoProxyBase();
  try {
    const url = base.startsWith('http') ? `${new URL(base).origin}/healthz` : null;
    if (!url) {
      return true;
    }
    const r = await fetch(url, { method: 'GET', credentials: 'omit' });
    return r.ok;
  } catch {
    return false;
  }
}

/** 工作流生成 3D 前轻量环境检查（警告为主，不阻断） */
export async function preflightGenerate3dEnvironment(opts: {
  companionBaseUrl?: string | null;
  companionProjectId?: string | null;
  provider: 'tripo' | 'tencent';
}): Promise<Generate3dPreflightResult> {
  const warnings: string[] = [];
  const base = normalizeCompanionBaseUrl(String(opts.companionBaseUrl || '').trim());
  const pid = String(opts.companionProjectId || '').trim();

  if (!base || !pid || pid === 'default') {
    warnings.push('未连接本地伴侣：模型仅保存在浏览器内存，刷新后可能丢失。');
  } else {
    const health = await probeCompanionHealth(base);
    if (!health.ok) {
      warnings.push('本地伴侣不可达：3D 归档可能失败，请确认伴侣已启动。');
    }
  }

  if (opts.provider === 'tripo') {
    const proxyOk = await probeTripoProxyReachable();
    if (!proxyOk && resolveTripoProxyBase().startsWith('http')) {
      warnings.push('Tripo 代理（auth-api）不可达：拉取/上传可能失败，请检查 VITE_AUTH_API_BASE_URL。');
    }
  }

  return { ok: warnings.length === 0, warnings };
}
