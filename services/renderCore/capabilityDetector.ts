/**
 * Detect whether WebGPU can be attempted in this environment.
 * Does not guarantee Three.js WebGPURenderer.init() will succeed.
 */

export type WebGpuCapabilityResult = {
  supported: boolean;
  reason?: string;
};

function isCompanionShellHost(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as Window & { companionShell?: unknown }).companionShell);
}

export async function detectWebGpuSupport(): Promise<WebGpuCapabilityResult> {
  // Local companion embeds Chromium; WebGPU + multi WebGL thumbs have black-screened the GPU.
  // Skip before requestAdapter() — probing alone can be costly in Electron.
  if (isCompanionShellHost()) {
    return { supported: false, reason: 'companion-shell-webgpu-disabled' };
  }
  if (typeof navigator === 'undefined') {
    return { supported: false, reason: 'no-navigator' };
  }
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) {
    return { supported: false, reason: 'no-navigator.gpu' };
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, reason: 'requestAdapter-null' };
    }
    return { supported: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { supported: false, reason: `requestAdapter-error:${message}` };
  }
}
