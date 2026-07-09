/**
 * After successful git push: summarize since last tip and upload to R2.
 * Usage: node --env-file=.env.local scripts/dev-log-post-push.mjs
 * Skip: SKIP_DEV_LOG=1
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDevLogR2Configured,
  readDevLogIndex,
  upsertDevLogEntry,
} from '../server/dev-log-r2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TIP_CACHE = path.join(ROOT, '.cache', 'dev-log-last-tip');

if (String(process.env.SKIP_DEV_LOG || '').trim() === '1') {
  console.log('[dev-log] skipped (SKIP_DEV_LOG=1)');
  process.exit(0);
}

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    if (allowFail) return '';
    throw e;
  }
}

function dayKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shortSha(sha) {
  return String(sha || '').slice(0, 7);
}

function clusterBullets(nameStats, commits) {
  const buckets = new Map();
  for (const line of nameStats) {
    const file = line.split('\t').pop()?.trim() || line.trim();
    if (!file) continue;
    let bucket = '其它';
    if (file.startsWith('components/ui/') || file.includes('CustomDropdown') || file.includes('Dropdown')) {
      bucket = 'UI 下拉/控件';
    } else if (file.startsWith('components/workflow/') || file.includes('WorkflowSidebar')) {
      bucket = '工作区功能区';
    } else if (file.startsWith('components/admin/')) {
      bucket = '管理后台';
    } else if (file.startsWith('components/') && file.includes('WorkspaceQuickCompose')) {
      bucket = '快捷输入栏';
    } else if (file.startsWith('server/') || file.startsWith('scripts/')) {
      bucket = '服务端/脚本';
    } else if (file.startsWith('docs/') || file.startsWith('.cursor/')) {
      bucket = '文档与规范';
    } else if (file.startsWith('services/')) {
      bucket = '前端服务';
    } else if (file.startsWith('components/')) {
      bucket = '前端组件';
    }
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(file);
  }

  const bullets = [];
  for (const [label, files] of buckets) {
    const n = files.length;
    const sample = files.slice(0, 2).map((f) => f.split('/').pop()).join('、');
    bullets.push(`${label}：${n} 个文件${sample ? `（如 ${sample}）` : ''}`);
  }
  if (commits.length) {
    const subjects = commits.slice(0, 3).map((c) => c.subject).filter(Boolean);
    if (subjects.length) {
      bullets.push(`提交：${subjects.join('；')}`);
    }
  }
  if (!bullets.length) bullets.push('无文件变更统计（可能为空推送或 tip 已对齐）');
  return bullets.slice(0, 8);
}

function parseNameStat(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseCommits(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(' ');
      if (i < 0) return { sha: line, subject: '' };
      return { sha: line.slice(0, i), subject: line.slice(i + 1) };
    });
}

function parseNumstat(raw) {
  let insertions = 0;
  let deletions = 0;
  let filesChanged = 0;
  for (const line of String(raw || '').split(/\r?\n/)) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!m) continue;
    filesChanged += 1;
    if (m[1] !== '-') insertions += Number(m[1]) || 0;
    if (m[2] !== '-') deletions += Number(m[2]) || 0;
  }
  return { filesChanged, insertions, deletions };
}

async function main() {
  if (!isDevLogR2Configured()) {
    console.error('[dev-log] R2 未配置（需 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET）');
    process.exit(1);
  }

  const head = git(['rev-parse', 'HEAD']);
  let fromSha = '';
  try {
    const index = await readDevLogIndex();
    fromSha = String(index.lastPushSha || '').trim();
  } catch (e) {
    console.warn('[dev-log] 读取 R2 index 失败，尝试本地 tip 缓存', e instanceof Error ? e.message : e);
  }
  if (!fromSha && fs.existsSync(TIP_CACHE)) {
    fromSha = fs.readFileSync(TIP_CACHE, 'utf8').trim();
  }
  if (fromSha && fromSha === head) {
    console.log('[dev-log] tip 未变化，跳过写入', shortSha(head));
    process.exit(0);
  }

  const range = fromSha ? `${fromSha}..${head}` : '';
  const nameStat = parseNameStat(
    range ? git(['diff', '--name-only', range], { allowFail: true }) : git(['diff-tree', '--no-commit-id', '--name-only', '-r', head], { allowFail: true })
  );
  const numstat = parseNumstat(
    range ? git(['diff', '--numstat', range], { allowFail: true }) : ''
  );
  const commits = parseCommits(
    range
      ? git(['log', '--format=%H %s', range], { allowFail: true })
      : git(['log', '-1', '--format=%H %s'], { allowFail: true })
  );

  const now = new Date();
  const dayKey = dayKeyLocal(now);
  const id = `${dayKey.replace(/-/g, '')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}-${shortSha(head)}`;
  const summaryBullets = clusterBullets(nameStat, commits);

  const entry = {
    id,
    dayKey,
    pushedAt: now.toISOString(),
    fromSha: fromSha || '',
    toSha: head,
    summaryBullets,
    commits: commits.map((c) => ({ sha: c.sha, subject: c.subject })),
    stats: {
      filesChanged: numstat.filesChanged || nameStat.length,
      insertions: numstat.insertions,
      deletions: numstat.deletions,
    },
  };

  console.log('[dev-log] 上传条目', id);
  for (const b of summaryBullets) console.log('  ·', b);

  const { index } = await upsertDevLogEntry(entry);
  fs.mkdirSync(path.dirname(TIP_CACHE), { recursive: true });
  fs.writeFileSync(TIP_CACHE, `${head}\n`, 'utf8');
  console.log('[dev-log] 完成 lastPushSha=', shortSha(index.lastPushSha), 'days=', index.days.length);
}

main().catch((e) => {
  console.error('[dev-log] 失败', e instanceof Error ? e.message : e);
  process.exit(1);
});
