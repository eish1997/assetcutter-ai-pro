/**
 * Cursor `stop` hook: 若任务未标记完成，则返回 followup_message 让 Agent 自动继续。
 * 需在 `.cursor/hooks/autopilot.task.json` 设置 enabled: true；关闭时设 false 或删除该文件。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TASK_FILE = path.join(ROOT, '.cursor/hooks/autopilot.task.json');
const STATE_FILE = path.join(ROOT, '.cursor/hooks/loop-state.json');
const STATE_EXAMPLE = path.join(ROOT, '.cursor/hooks/loop-state.example.json');
const RUNTIME_FILE = path.join(ROOT, '.cursor/hooks/autopilot.runtime.json');

const DEFAULT_FOLLOWUP = `继续执行当前用户的原始请求，直到所有需求都已完成并给出可验证结果。
在未真正完成前，不要声称已完成。
当你确认任务已彻底完成时：编辑 \`.cursor/hooks/loop-state.json\`，把 \`done\` 设为 \`true\`，然后可以正常结束。`;

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function emitEmpty() {
  process.stdout.write('{}\n');
}

/** loop-state.json 已 gitignore：若不存在则从 example 复制，便于 Agent 有可编辑文件 */
function ensureStateFile() {
  if (fs.existsSync(STATE_FILE)) return;
  try {
    if (fs.existsSync(STATE_EXAMPLE)) {
      fs.copyFileSync(STATE_EXAMPLE, STATE_FILE);
      return;
    }
    fs.writeFileSync(STATE_FILE, `${JSON.stringify({ done: false }, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[autopilot-stop] ensureStateFile:', err);
  }
}

function runValidation(task) {
  const cmd = typeof task.validateCommand === 'string' ? task.validateCommand.trim() : '';
  if (!cmd) return '';

  const cwdRaw = typeof task.validateCwd === 'string' ? task.validateCwd.trim() : '';
  const cwd = cwdRaw ? path.join(ROOT, cwdRaw) : ROOT;
  const timeout = Number.isFinite(task.validateTimeoutMs) ? task.validateTimeoutMs : 120_000;
  const maxBuffer = 10 * 1024 * 1024;

  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      shell: true,
      timeout: Math.max(1000, timeout),
      maxBuffer,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return `\n\n## 校验命令输出（stdout）\n\`\`\`\n${stdout}\n\`\`\`\n`;
  } catch (e) {
    const stdout = e.stdout != null ? String(e.stdout) : '';
    const stderr = e.stderr != null ? String(e.stderr) : '';
    const msg = e.message != null ? String(e.message) : String(e);
    return `\n\n## 校验失败（请修复后继续）\n\`\`\`\n${stdout}${stderr}${msg ? `\n${msg}` : ''}\n\`\`\`\n`;
  }
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = raw ? JSON.parse(raw) : {};
  } catch {
    emitEmpty();
    return;
  }

  if (input.status !== 'completed') {
    emitEmpty();
    return;
  }

  if (!fs.existsSync(TASK_FILE)) {
    emitEmpty();
    return;
  }

  const task = safeReadJson(TASK_FILE);
  if (!task) {
    emitEmpty();
    return;
  }

  const runtime = safeReadJson(RUNTIME_FILE);
  const armed = runtime && runtime.armed === true;
  const manualOn = task.enabled === true;
  if (!manualOn && !armed) {
    emitEmpty();
    return;
  }

  ensureStateFile();

  const state = safeReadJson(STATE_FILE);
  if (state && state.done === true) {
    if (armed) {
      try {
        fs.writeFileSync(RUNTIME_FILE, `${JSON.stringify({ armed: false }, null, 2)}\n`, 'utf8');
      } catch (err) {
        console.error('[autopilot-stop] disarm runtime:', err);
      }
    }
    emitEmpty();
    return;
  }

  const custom = typeof task.followupBody === 'string' ? task.followupBody.trim() : '';
  const body = custom || DEFAULT_FOLLOWUP;
  const validationAppend = runValidation(task);
  const loopCount = typeof input.loop_count === 'number' ? input.loop_count : 0;
  const limitHint =
    loopCount >= 20
      ? `\n\n（提示：本轮为第 ${loopCount + 1} 次由 stop 钩触发的自动继续，请尽快收敛并完成；完成后务必将 loop-state.json 的 done 设为 true。）`
      : '';

  const followup_message = body + validationAppend + limitHint;
  process.stdout.write(`${JSON.stringify({ followup_message })}\n`);
}

main().catch((err) => {
  console.error('[autopilot-stop]', err);
  emitEmpty();
});
