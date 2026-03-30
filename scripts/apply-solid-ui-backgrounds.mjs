/**
 * Replace Tailwind alpha backgrounds / backdrop-blur with opaque surfaces.
 * Run: node scripts/apply-solid-ui-backgrounds.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function walkTsx(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsx(p, acc);
    else if (ent.name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const pairs = [
  ['bg-black/95 backdrop-blur-xl', 'bg-[#050505]'],
  ['bg-black/90 backdrop-blur-xl', 'bg-[#050505]'],
  ['bg-black/90 backdrop-blur-sm', 'bg-[#050505]'],
  ['bg-black/80 backdrop-blur-sm', 'bg-[#1e1e22]'],
  ['bg-black/80 backdrop-blur-xl', 'bg-[#1e1e22]'],
  ['bg-black/60 backdrop-blur-sm', 'bg-[#1a1a1e]'],
  ['rounded-2xl border border-white/10 bg-black/55 backdrop-blur-xl', 'rounded-2xl border border-[#2e2e32] bg-[#121214]'],
  ['bg-black/55 backdrop-blur-xl', 'bg-[#121214]'],

  ['bg-gradient-to-r from-cyan-500/10 via-blue-600/10 to-violet-600/10', 'bg-[#101820]'],
  ['bg-gradient-to-b from-blue-600/15 to-blue-950/20', 'bg-[#121a28]'],
  ['bg-gradient-to-br from-violet-950/80 via-[#0f0f18] to-blue-950/60', 'bg-[#16101f]'],

  ['hover:bg-amber-500/[0.1]', 'hover:bg-[#3d3020]'],
  ['bg-amber-500/[0.06]', 'bg-[#2a2418]'],
  ['bg-cyan-500/[0.06]', 'bg-[#0c2228]'],
  ['ring-1 ring-blue-500/60 bg-blue-500/[0.06]', 'ring-1 ring-[#3b82f6] bg-[#152535]'],

  ['bg-white/[0.03]', 'bg-[#121214]'],
  ['bg-white/[0.04]', 'bg-[#151518]'],
  ['bg-white/[0.06]', 'bg-[#18181c]'],
  ['hover:bg-white/[0.06]', 'hover:bg-[#18181c]'],

  ['bg-black/95', 'bg-[#050505]'],
  ['bg-black/90', 'bg-[#050505]'],
  ['bg-black/80', 'bg-[#1e1e22]'],
  ['bg-black/60', 'bg-[#1a1a1e]'],
  ['bg-black/55', 'bg-[#121214]'],
  ['bg-black/50', 'bg-[#18181c]'],
  ['bg-black/40', 'bg-[#16161a]'],
  ['bg-black/30', 'bg-[#141416]'],
  ['bg-black/20', 'bg-[#121214]'],

  ['bg-white/20', 'bg-[#303038]'],
  ['bg-white/10', 'bg-[#26262c]'],
  ['bg-white/5', 'bg-[#1c1c22]'],
  ['hover:bg-white/30', 'hover:bg-[#42424c]'],
  ['hover:bg-white/20', 'hover:bg-[#383842]'],
  ['hover:bg-white/10', 'hover:bg-[#2e2e36]'],
  ['hover:bg-white/5', 'hover:bg-[#222228]'],

  ['border-white/30', 'border-[#484850]'],
  ['border-white/20', 'border-[#3a3a40]'],
  ['border-white/15', 'border-[#343438]'],
  ['border-white/10', 'border-[#2e2e32]'],
  ['border-white/5', 'border-[#252528]'],
  ['hover:border-white/30', 'hover:border-[#484850]'],

  ['bg-blue-600/90', 'bg-[#1d4ed8]'],
  ['bg-blue-600/80', 'bg-[#1e40af]'],
  ['bg-blue-600/60', 'bg-[#1d4ed8]'],
  ['bg-blue-600/50', 'bg-[#365e92]'],
  ['bg-blue-600/40', 'bg-[#2e5280]'],
  ['bg-blue-600/30', 'bg-[#264670]'],
  ['bg-blue-600/25', 'bg-[#223d5c]'],
  ['bg-blue-600/20', 'bg-[#1e3558]'],
  ['bg-blue-600/15', 'bg-[#1a2d4d]'],
  ['bg-blue-600/10', 'bg-[#152642]'],
  ['hover:bg-blue-600/30', 'hover:bg-[#305a90]'],
  ['hover:bg-blue-600/40', 'hover:bg-[#3868a8]'],
  ['hover:bg-blue-500/50', 'hover:bg-[#3560a0]'],
  ['hover:bg-blue-500/30', 'hover:bg-[#2d5590]'],
  ['hover:bg-blue-600/20', 'hover:bg-[#284d78]'],

  ['bg-blue-500/15', 'bg-[#1e3a5f]'],
  ['bg-blue-500/10', 'bg-[#1a3354]'],
  ['border-blue-500/50', 'border-[#3b82f6]'],
  ['border-blue-500/40', 'border-[#3b6fb8]'],
  ['border-blue-500/30', 'border-[#4b6a9e]'],
  ['border-blue-400/40', 'border-[#5080c0]'],
  ['border-blue-400/70', 'border-[#6090d0]'],
  ['ring-blue-500/40', 'ring-[#3b82f6]'],
  ['ring-blue-500/60', 'ring-[#3b82f6]'],
  ['border-blue-500/35', 'border-[#4570b0]'],

  ['bg-emerald-600/40', 'bg-[#166534]'],
  ['bg-emerald-600/30', 'bg-[#14532d]'],
  ['bg-emerald-600/10', 'bg-[#0f2918]'],
  ['border-emerald-500/30', 'border-[#34d399]'],
  ['border-emerald-500/35', 'border-[#2eb87a]'],
  ['border-emerald-400/40', 'border-[#3ecf8f]'],

  ['bg-red-600/90', 'bg-[#b91c1c]'],
  ['bg-red-600/30', 'bg-[#5c1a1a]'],
  ['bg-red-500/30', 'bg-[#5a2222]'],
  ['bg-red-500/20', 'bg-[#4a1c1c]'],
  ['bg-red-500/10', 'bg-[#3a1818]'],
  ['hover:bg-red-500/20', 'hover:bg-[#4a1c1c]'],
  ['hover:bg-red-500/30', 'hover:bg-[#5a2222]'],
  ['border-red-500/40', 'border-[#f87171]'],
  ['border-red-500/30', 'border-[#dc6b6b]'],
  ['border-red-500/20', 'border-[#b85a5a]'],
  ['border-red-400/30', 'border-[#c87878]'],

  ['bg-amber-600/90', 'bg-[#b45309]'],
  ['bg-amber-600/80', 'bg-[#9a3412]'],
  ['bg-amber-600/60', 'bg-[#92400e]'],
  ['bg-amber-600/20', 'bg-[#3d2a10]'],
  ['bg-amber-600/10', 'bg-[#2a2210]'],
  ['bg-amber-500/20', 'bg-[#3d3018]'],
  ['bg-amber-500/10', 'bg-[#2c2412]'],
  ['bg-amber-500/5', 'bg-[#221c10]'],
  ['hover:bg-amber-500/20', 'hover:bg-[#3d3018]'],
  ['hover:bg-amber-500/70', 'hover:bg-[#a86207]'],
  ['border-amber-500/50', 'border-[#f59e0b]'],
  ['border-amber-500/40', 'border-[#d97706]'],
  ['border-amber-500/30', 'border-[#b45309]'],
  ['border-amber-400/30', 'border-[#c2873a]'],
  ['border-amber-400/50', 'border-[#d4a054]'],

  ['bg-indigo-600/20', 'bg-[#312e5c]'],
  ['bg-indigo-600/40', 'bg-[#3d3a70]'],
  ['border-indigo-400', 'border-[#818cf8]'],
  ['ring-indigo-400/40', 'ring-[#818cf8]'],

  ['bg-violet-500/10', 'bg-[#2e2650]'],
  ['bg-violet-500/5', 'bg-[#221c38]'],
  ['border-violet-500', 'border-[#8b5cf6]'],
  ['border-violet-400/40', 'border-[#9d74f6]'],
  ['hover:border-violet-400/60', 'hover:border-[#a78bfa]'],

  ['bg-sky-500/10', 'bg-[#0c2838]'],
  ['bg-sky-500/5', 'bg-[#0a1f2c]'],
  ['border-sky-500', 'border-[#0ea5e9]'],
  ['border-sky-400/40', 'border-[#38bdf8]'],
  ['hover:border-sky-400/60', 'hover:border-[#5ac8fa]'],

  ['bg-green-600/20', 'bg-[#14532d]'],
  ['bg-green-500/20', 'bg-[#166534]'],
  ['bg-gray-500/20', 'bg-[#3f3f46]'],

  ['border-cyan-400/25', 'border-[#22d3ee]'],
  ['border-cyan-400/20', 'border-[#22d3ee]'],

  ['shadow-blue-900/30', 'shadow-[#172554]'],
  ['shadow-black/60', 'shadow-[#000000]'],
  ['shadow-black/80', 'shadow-[#000000]'],

  ['bg-red-500/80', 'bg-[#b91c1c]'],
  ['bg-green-600/30', 'bg-[#166534]'],
  ['bg-amber-600/30', 'bg-[#92400e]'],

  ['bg-blue-500/20', 'bg-[#1e40af]'],
  ['border-blue-500/60', 'border-[#3b82f6]'],
  ['bg-blue-500/10', 'bg-[#1a3354]'],

  ['file:bg-blue-600/30', 'file:bg-[#264670]'],

  ['bg-emerald-500/10', 'bg-[#0d2818]'],
  ['border-emerald-500', 'border-[#10b981]'],
  ['border-red-500', 'border-[#ef4444]'],

  ['hover:bg-blue-500/10', 'hover:bg-[#1a3354]'],
  ['hover:bg-amber-500/10', 'hover:bg-[#3d3018]'],
  ['hover:bg-green-600/80', 'hover:bg-[#15803d]'],
  ['hover:bg-green-500', 'hover:bg-[#22c55e]'],
  ['hover:bg-emerald-600/40', 'hover:bg-[#166534]'],
  ['hover:bg-emerald-600/30', 'hover:bg-[#14532d]'],

  ['bg-gradient-to-r from-rose-500 to-amber-400', 'bg-[#c45c4a]'],
  ['bg-gradient-to-r from-amber-400 to-orange-500', 'bg-[#c2873a]'],
  ['bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500', 'bg-[#3d5a80]'],

  ['border-red-400/40 bg-red-500/5 hover:border-red-400/60', 'border-[#c87878] bg-[#2a1518] hover:border-[#f87171]'],
  ['border-[#3ecf8f] bg-emerald-500/5 hover:border-emerald-400/60', 'border-[#34d399] bg-[#0a1f16] hover:border-[#34d399]'],
  ['bg-indigo-500/10 ring-1 ring-[#818cf8]', 'bg-[#312e55] ring-1 ring-[#818cf8]'],

  ['bg-red-950/40', 'bg-[#3f1518]'],
  ['bg-indigo-600/30', 'bg-[#3730a3]'],
  ['bg-indigo-600/80', 'bg-[#3730a3]'],
  ['border-indigo-500/40', 'border-[#6366f1]'],
  ['hover:bg-amber-600/40', 'hover:bg-[#b45309]'],
  ['hover:bg-blue-600/5', 'hover:bg-[#1a2332]'],
  ['border-[#10b981]/40', 'border-[#34d399]'],
  ['bg-red-900/20', 'bg-[#5c2020]'],
  ['bg-amber-500/15', 'bg-[#3a3018]'],
  ['bg-emerald-500/15', 'bg-[#0f3320]'],
  ['bg-gray-500/15', 'bg-[#3a3a40]'],
  ['bg-red-500/15', 'bg-[#4a2228]'],
  ['hover:bg-red-500/15', 'hover:bg-[#4a2228]'],
  ['bg-black/70', 'bg-[#0d0d10]'],
  ['bg-red-600/50', 'bg-[#991b1b]'],
  ['bg-red-600/70', 'bg-[#b91c1c]'],
  ['hover:bg-red-600/50', 'hover:bg-[#991b1b]'],
  ['hover:bg-red-600/70', 'hover:bg-[#b91c1c]'],
  ['bg-green-600/80', 'bg-[#15803d]'],
  ['hover:bg-blue-500/25', 'hover:bg-[#2a5080]'],
  ['hover:bg-emerald-500/20', 'hover:bg-[#14532d]'],
  ['bg-emerald-500/20', 'bg-[#14532d]'],
  ['bg-red-500/90', 'bg-[#dc2626]'],
  ['bg-white/[0.02]', 'bg-[#0e0e10]'],
];

pairs.sort((a, b) => b[0].length - a[0].length);

function transform(content) {
  let c = content;
  for (const [from, to] of pairs) {
    c = c.split(from).join(to);
  }
  c = c.replace(/\s+backdrop-blur-(?:2xl|xl|lg|md|sm)\b/g, '');
  return c;
}

const targets = [...walkTsx(root), path.join(root, 'index.html')];
let n = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const raw = fs.readFileSync(file, 'utf8');
  const next = transform(raw);
  if (next !== raw) {
    fs.writeFileSync(file, next, 'utf8');
    n++;
    console.log('updated', path.relative(root, file));
  }
}
console.log('done, files changed:', n);
