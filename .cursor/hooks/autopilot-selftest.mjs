/**
 * 本地自测：模拟 Cursor 传入的 stdin，不启动 IDE。
 * 运行：仓库根目录 `node .cursor/hooks/autopilot-selftest.mjs`
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TASK = path.join(ROOT, '.cursor/hooks/autopilot.task.json');
const RUNTIME = path.join(ROOT, '.cursor/hooks/autopilot.runtime.json');
const STATE = path.join(ROOT, '.cursor/hooks/loop-state.json');
const ARM = path.join(ROOT, '.cursor/hooks/autopilot-arm.mjs');
const STOP = path.join(ROOT, '.cursor/hooks/autopilot-stop.mjs');

function runHook(scriptPath, stdinObj) {
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    input: JSON.stringify(stdinObj),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function cleanupLocal() {
  for (const p of [RUNTIME, STATE]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  const taskBackup = fs.readFileSync(TASK, 'utf8');
  let taskObj;
  try {
    taskObj = JSON.parse(taskBackup);
  } catch (e) {
    throw new Error(`无法解析 ${TASK}: ${e}`);
  }
  const taskRestore = () => fs.writeFileSync(TASK, taskBackup, 'utf8');

  cleanupLocal();

  try {
    taskObj.validateCommand = '';
    fs.writeFileSync(TASK, `${JSON.stringify(taskObj, null, 2)}\n`, 'utf8');

    // 1) 唤醒
    let r = runHook(ARM, { prompt: '帮我改一下 扁担' });
    assert(r.status === 0, `arm exit ${r.status}`);
    assert(r.stdout.includes('"continue":true'), `arm 应放行: ${r.stdout}`);
    assert(fs.existsSync(RUNTIME), '应有 autopilot.runtime.json');
    assert(JSON.parse(fs.readFileSync(RUNTIME, 'utf8')).armed === true, 'armed 应为 true');
    assert(fs.existsSync(STATE), '唤醒后应有 loop-state.json');
    assert(JSON.parse(fs.readFileSync(STATE, 'utf8')).done === false, 'done 应为 false');

    // 2) 解除
    r = runHook(ARM, { prompt: '先扁担停吧' });
    assert(r.status === 0, `arm sleep exit ${r.status}`);
    assert(JSON.parse(fs.readFileSync(RUNTIME, 'utf8')).armed === false, '扁担停 后 armed 应为 false');

    // 3) stop：未武装应空输出
    r = runHook(STOP, { status: 'completed', loop_count: 0 });
    assert(r.stdout === '{}', `未武装 stop 应 {{}}: ${r.stdout}`);

    // 4) 再唤醒 + stop 应 followup
    runHook(ARM, { prompt: '扁担 继续任务' });
    r = runHook(STOP, { status: 'completed', loop_count: 0 });
    const out = JSON.parse(r.stdout);
    assert(typeof out.followup_message === 'string' && out.followup_message.length > 0, '应有 followup_message');

    // 5) done true + armed 应收尾并清空 armed
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    st.done = true;
    fs.writeFileSync(STATE, `${JSON.stringify(st, null, 2)}\n`, 'utf8');
    r = runHook(STOP, { status: 'completed', loop_count: 0 });
    assert(r.stdout === '{}', `完成后应 {{}}: ${r.stdout}`);
    assert(JSON.parse(fs.readFileSync(RUNTIME, 'utf8')).armed === false, '完成后应 disarm');

    // 6) aborted 不跟跑
    runHook(ARM, { prompt: '扁担' });
    r = runHook(STOP, { status: 'aborted', loop_count: 0 });
    assert(r.stdout === '{}', `aborted 应 {{}}: ${r.stdout}`);

    console.log('autopilot-selftest: 全部通过');
  } finally {
    taskRestore();
    cleanupLocal();
  }
}

main();
