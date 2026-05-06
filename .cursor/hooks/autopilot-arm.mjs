/**
 * beforeSubmitPrompt：检测唤醒/解除短语，写入 autopilot.runtime.json（不入库）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TASK_FILE = path.join(ROOT, '.cursor/hooks/autopilot.task.json');
const STATE_FILE = path.join(ROOT, '.cursor/hooks/loop-state.json');
const STATE_EXAMPLE = path.join(ROOT, '.cursor/hooks/loop-state.example.json');
const RUNTIME_FILE = path.join(ROOT, '.cursor/hooks/autopilot.runtime.json');

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureStateFile() {
  if (fs.existsSync(STATE_FILE)) return;
  try {
    if (fs.existsSync(STATE_EXAMPLE)) {
      fs.copyFileSync(STATE_EXAMPLE, STATE_FILE);
    } else {
      fs.writeFileSync(STATE_FILE, `${JSON.stringify({ done: false }, null, 2)}\n`, 'utf8');
    }
  } catch (err) {
    console.error('[autopilot-arm] ensureStateFile:', err);
  }
}

function setLoopStateDone(value) {
  ensureStateFile();
  try {
    const state = safeReadJson(STATE_FILE) || { done: false };
    state.done = value;
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[autopilot-arm] setLoopStateDone:', err);
  }
}

function writeRuntime(armed) {
  try {
    fs.writeFileSync(RUNTIME_FILE, `${JSON.stringify({ armed: !!armed }, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error('[autopilot-arm] writeRuntime:', err);
  }
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = raw ? JSON.parse(raw) : {};
  } catch {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return;
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt : '';

  const task = fs.existsSync(TASK_FILE) ? safeReadJson(TASK_FILE) : {};
  let wakeWord = '扁担';
  if (task && typeof task.wakeWord === 'string') {
    wakeWord = task.wakeWord.trim();
  }
  let sleepPhrase = '扁担停';
  if (task && typeof task.sleepPhrase === 'string') {
    sleepPhrase = task.sleepPhrase.trim();
  }

  if (sleepPhrase && prompt.includes(sleepPhrase)) {
    writeRuntime(false);
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return;
  }

  if (wakeWord && prompt.includes(wakeWord)) {
    writeRuntime(true);
    setLoopStateDone(false);
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
}

main().catch((err) => {
  console.error('[autopilot-arm]', err);
  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
});
