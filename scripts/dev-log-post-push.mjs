/**
 * After successful git push: summarize since last tip and upload to R2.
 * Usage:
 *   node --env-file=.env.local scripts/dev-log-post-push.mjs
 *   node --env-file=.env.local scripts/dev-log-post-push.mjs --rewrite
 * Skip: SKIP_DEV_LOG=1
 *
 * Summary style: human work bullets (what changed), NOT "N files (foo.tsx)".
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDevLogR2Configured,
  readDevLogDayEntries,
  readDevLogIndex,
  upsertDevLogEntry,
} from '../server/dev-log-r2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TIP_CACHE = path.join(ROOT, '.cache', 'dev-log-last-tip');
const REWRITE =
  process.argv.includes('--rewrite') || String(process.env.DEV_LOG_REWRITE || '').trim() === '1';

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

/** Strip conventional-commit prefix for display */
function humanizeSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return '';
  const m = s.match(
    /^(feat|fix|chore|docs|refactor|style|test|perf|build|ci)(\([^)]*\))?:\s*(.+)$/i
  );
  return m ? String(m[3]).trim() : s;
}

/**
 * Work-oriented bullets (confirmed product style), not file-count inventory.
 * Priority: commit subjects → area themes from paths → one stats line.
 */
function buildWorkSummaryBullets(nameStats, commits, stats) {
  const bullets = [];
  const seen = new Set();
  const pushUnique = (line) => {
    const t = String(line || '').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    bullets.push(t);
  };

  for (const c of commits) {
    const h = humanizeSubject(c.subject);
    if (h) pushUnique(h);
    if (bullets.length >= 6) break;
  }

  const files = nameStats
    .map((line) => line.split('\t').pop()?.trim() || line.trim())
    .filter(Boolean);
  const has = (re) => files.some((f) => re.test(f));

  if (bullets.length < 6) {
    if (has(/CustomDropdown|DropdownSelect|DROPDOWN_/)) {
      pushUnique('下拉视觉统一为全局输入框族（compose chip / settings 分轨）');
    }
    if (has(/WorkflowSidebarColumn|SIDEBAR_COMPOSE_CHIP|SIDEBAR_FILTER_CHIP/)) {
      pushUnique('功能区组头与筛选标签改为快捷栏同款 pill');
    }
    if (has(/WorkspaceQuickComposeBar/)) {
      pushUnique('快捷栏模型选项与下拉常量对齐');
    }
    if (has(/dev-log|DevLogSection|devLog/)) {
      pushUnique('开发日志：push 后总结上传 R2，时间轴与小票导出');
    }
    if (has(/^server\/auth-api/)) {
      pushUnique('auth-api 增加开发日志读取接口');
    }
    if (has(/^docs\/|^\.cursor\//)) {
      pushUnique('交接文档与 Cursor 规范同步');
    }
  }

  const n = stats?.filesChanged || files.length;
  if (n > 0) {
    pushUnique(
      `共触及 ${n} 个文件` +
        (stats?.insertions || stats?.deletions
          ? `（+${stats.insertions || 0} / −${stats.deletions || 0}）`
          : '')
    );
  }

  if (!bullets.length) pushUnique('本次推送无可用摘要（空 diff 或 tip 已对齐）');
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
  let index = emptySafeIndex();
  try {
    index = await readDevLogIndex();
  } catch (e) {
    console.warn('[dev-log] 读取 R2 index 失败，尝试本地 tip 缓存', e instanceof Error ? e.message : e);
  }

  let fromSha = String(index.lastPushSha || '').trim();
  if (!fromSha && fs.existsSync(TIP_CACHE)) {
    fromSha = fs.readFileSync(TIP_CACHE, 'utf8').trim();
  }

  let rewriteEntry = null;
  if (fromSha && fromSha === head) {
    if (!REWRITE) {
      console.log('[dev-log] tip 未变化，跳过写入', shortSha(head), '（重写摘要请加 --rewrite）');
      process.exit(0);
    }
    const dayKeyHint = dayKeyLocal();
    const dayEntries = await readDevLogDayEntries(dayKeyHint).catch(() => []);
    rewriteEntry = dayEntries.find((e) => String(e?.toSha || '') === head) || null;
    if (!rewriteEntry) {
      for (const d of index.days || []) {
        const list = await readDevLogDayEntries(d.dayKey).catch(() => []);
        rewriteEntry = list.find((e) => String(e?.toSha || '') === head) || null;
        if (rewriteEntry) break;
      }
    }
    if (!rewriteEntry) {
      console.error('[dev-log] --rewrite 未找到 toSha=', shortSha(head), '的条目');
      process.exit(1);
    }
    fromSha = String(rewriteEntry.fromSha || '').trim();
    console.log('[dev-log] 重写条目', rewriteEntry.id);
  }

  const range = fromSha ? `${fromSha}..${head}` : '';
  const nameStat = parseNameStat(
    range
      ? git(['diff', '--name-only', range], { allowFail: true })
      : git(['diff-tree', '--no-commit-id', '--name-only', '-r', head], { allowFail: true })
  );
  const numstat = parseNumstat(
    range
      ? git(['diff', '--numstat', range], { allowFail: true })
      : git(['show', '--format=', '--numstat', head], { allowFail: true })
  );
  const commits = parseCommits(
    range
      ? git(['log', '--format=%H %s', range], { allowFail: true })
      : git(['log', '-1', '--format=%H %s'], { allowFail: true })
  );

  const stats = {
    filesChanged: numstat.filesChanged || nameStat.length,
    insertions: numstat.insertions,
    deletions: numstat.deletions,
  };
  const summaryBullets = buildWorkSummaryBullets(nameStat, commits, stats);

  const now = new Date();
  const dayKey = rewriteEntry?.dayKey || dayKeyLocal(now);
  const id =
    rewriteEntry?.id ||
    `${dayKey.replace(/-/g, '')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}-${shortSha(head)}`;

  const entry = {
    id,
    dayKey,
    pushedAt: rewriteEntry?.pushedAt || now.toISOString(),
    fromSha: fromSha || '',
    toSha: head,
    summaryBullets,
    commits: commits.map((c) => ({ sha: c.sha, subject: c.subject })),
    stats,
  };

  console.log('[dev-log] 上传条目', id);
  for (const b of summaryBullets) console.log('  ·', b);

  const { index: nextIndex } = await upsertDevLogEntry(entry);
  fs.mkdirSync(path.dirname(TIP_CACHE), { recursive: true });
  fs.writeFileSync(TIP_CACHE, `${head}\n`, 'utf8');
  console.log('[dev-log] 完成 lastPushSha=', shortSha(nextIndex.lastPushSha), 'days=', nextIndex.days.length);
}

function emptySafeIndex() {
  return { updatedAt: '', lastPushSha: '', days: [] };
}

main().catch((e) => {
  console.error('[dev-log] 失败', e instanceof Error ? e.message : e);
  process.exit(1);
});
