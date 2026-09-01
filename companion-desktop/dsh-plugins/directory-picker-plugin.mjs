import { DirectoryPicker } from '../dsh-bundled/node_modules/@deepseek-ai/dsh-host-directory-picker/lib/index.js'

export const name = 'assetcutter-directory-picker'

function toolsOrigin() {
  return String(process.env.ASSETCUTTER_DSH_TOOLS || 'http://127.0.0.1:3081').trim().replace(/\/$/, '')
}

async function pickViaShell(signal) {
  const res = await fetch(`${toolsOrigin()}/workspace/pick-directory`, {
    method: 'POST',
    signal,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out.ok === false) {
    throw new Error(String(out.error || `directory picker HTTP ${res.status}`))
  }
  if (out.cancelled) return null
  const dir = String(out.path || '').trim()
  return dir || null
}

class ShellDirectoryPicker extends DirectoryPicker {
  nativeCapability = {
    kind: 'native',
    pick: (signal) => pickViaShell(signal),
  }

  capability() {
    return this.nativeCapability
  }
}

export function apply(ctx) {
  ctx.plugin(ShellDirectoryPicker)
}
