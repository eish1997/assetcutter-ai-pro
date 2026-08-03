#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const strict = args.has('--strict');
const skipConversationSmoke = args.has('--skip-conversation-smoke');

function readArg(name, fallback = '') {
  const argv = process.argv.slice(2);
  const prefix = `${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1] && !String(argv[index + 1]).startsWith('--')) {
    return argv[index + 1];
  }
  return fallback;
}

function runJson(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
    timeout: 240000,
  });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  let parsed = null;
  try {
    parsed = stdout ? JSON.parse(stdout) : null;
  } catch {
    parsed = null;
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
    parsed,
  };
}

function readDesktopVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('companion-desktop/package.json'), 'utf8'));
    return String(pkg.version || '').trim();
  } catch {
    return '';
  }
}

function flattenResults(section, payload) {
  const parsed = payload && payload.parsed && typeof payload.parsed === 'object' ? payload.parsed : null;
  const results = parsed && Array.isArray(parsed.results) ? parsed.results : [];
  return results.map((item) => ({
    section,
    id: item.id,
    label: item.label,
    level: item.level,
    detail: item.detail,
  }));
}

function defaultReportPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(os.tmpdir(), `codex-clean-machine-report-${stamp}.json`);
}

function writeReport(report, outPath) {
  const target = path.resolve(outPath || defaultReportPath());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}

function defaultAgentSettingsPath() {
  if (process.platform === 'win32') {
    const local = String(process.env.LOCALAPPDATA || '').trim();
    if (local) {
      return path.join(local, 'AssetCutterCompanion', 'sandbox', 'agent-store', 'settings.json');
    }
  }
  return '';
}

function readDesktopOneClickSetupReport(settingsPath, desktopVersion) {
  const file = String(settingsPath || '').trim();
  const targetVersion = String(desktopVersion || '').trim();
  if (!file) {
    return {
      level: 'warn',
      detail: 'Desktop agent settings path could not be resolved',
      settingsPath: '',
      report: null,
    };
  }
  if (!fs.existsSync(file)) {
    return {
      level: 'warn',
      detail: `Desktop agent settings not found: ${file}`,
      settingsPath: file,
      report: null,
    };
  }
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    const setupReport = settings && settings.codexLastSetupReport && typeof settings.codexLastSetupReport === 'object'
      ? settings.codexLastSetupReport
      : null;
    if (!setupReport) {
      return {
        level: 'warn',
        detail: 'No codexLastSetupReport yet; click the desktop one-click Codex setup button first',
        settingsPath: file,
        report: null,
      };
    }
    const reportDesktopVersion = String(setupReport.desktopVersion || '').trim();
    if (targetVersion && !reportDesktopVersion) {
      return {
        level: 'warn',
        detail: `Last desktop one-click setup passed at ${setupReport.at || 'unknown time'}, but the report does not record desktop version; rerun one-click setup with desktop ${targetVersion}`,
        settingsPath: file,
        report: setupReport,
      };
    }
    if (targetVersion && reportDesktopVersion && reportDesktopVersion !== targetVersion) {
      return {
        level: 'fail',
        detail: `Last desktop one-click setup report is for desktop ${reportDesktopVersion}, expected ${targetVersion}; rerun one-click setup with the current desktop`,
        settingsPath: file,
        report: setupReport,
      };
    }
    const failed = Array.isArray(setupReport.failed) ? setupReport.failed.join(', ') : '';
    if (!setupReport.ok) {
      return {
        level: 'fail',
        detail: `Last desktop one-click setup failed${failed ? `: ${failed}` : ''}`,
        settingsPath: file,
        report: setupReport,
      };
    }
    if (!setupReport.cloudIdentitySynced) {
      return {
        level: 'warn',
        detail: 'Last desktop one-click setup report did not record cloud identity sync; rerun the bundled verify-codex-clean-machine.ps1 with -AutoCodexSetup after signing in',
        settingsPath: file,
        report: setupReport,
      };
    }
    if (!setupReport.conversationVerified) {
      return {
        level: 'warn',
        detail: `Last desktop one-click setup report did not record an in-setup conversation verification; click one-click Codex setup and wait for the test conversation to finish`,
        settingsPath: file,
        report: setupReport,
      };
    }
    return {
      level: 'ok',
      detail: `Last desktop one-click setup passed at ${setupReport.at || 'unknown time'} for desktop ${reportDesktopVersion || 'unknown version'} with conversation verification`,
      settingsPath: file,
      report: setupReport,
    };
  } catch (error) {
    return {
      level: 'fail',
      detail: `Could not read desktop one-click setup report: ${error && error.message ? error.message : String(error)}`,
      settingsPath: file,
      report: null,
    };
  }
}

function nextActionForResult(item) {
  if (!item || item.level === 'ok') return '';
  const id = String(item.id || '');
  const section = String(item.section || '');
  if (id === 'desktop_one_click_setup') {
    return 'On a test PC, rerun the bundled verify-codex-clean-machine.ps1 with -AutoCodexSetup, or open AssetCutter Companion and click one-click Codex setup, then rerun this check.';
  }
  if (id === 'codex_auth_payload') {
    return 'Pass a logged-in team cookie with --cookie=... so the cloud Codex identity payload can be verified.';
  }
  if (id === 'desktop_update_feed') {
    return 'Publish/register the fresh desktop installer so latest.yml includes the target version.';
  }
  if (id === 'codex_conversation_smoke') {
    return 'Run without --skip-conversation-smoke on the test machine to prove Codex can actually reply.';
  }
  if (id === 'cloud_auth_route') {
    return 'Pass --auth-url and --cookie, or verify the team Codex identity route from the logged-in environment.';
  }
  if (id === 'cloud_auth_env') {
    return 'Configure CODEX_SHARED_AUTH_JSON_BASE64 or CODEX_SHARED_AUTH_JSON in the cloud auth service.';
  }
  if (id === 'codex_cli') {
    return 'Install or repair Codex CLI, then rerun one-click setup.';
  }
  if (id === 'npm' || id === 'node') {
    return 'Allow one-click setup to install Node.js/npm, or install Node.js LTS manually, then rerun setup.';
  }
  if (section === 'production') {
    return 'Fix the production check shown in this row, then rerun with --strict.';
  }
  return 'Fix this check, then rerun the clean-machine acceptance command.';
}

function buildNextActions(results) {
  const out = [];
  const seen = new Set();
  for (const item of results) {
    if (!item || item.level === 'ok') continue;
    const action = nextActionForResult(item);
    if (!action || seen.has(action)) continue;
    seen.add(action);
    out.push({
      id: item.id,
      section: item.section,
      level: item.level,
      action,
    });
  }
  return out;
}

function main() {
  const authBase = readArg('--auth-base', process.env.AUTH_API_BASE || 'https://assetcutter-auth-api.onrender.com');
  const cookie = readArg('--cookie', process.env.CODEX_SHARED_AUTH_CHECK_COOKIE || process.env.COMPANION_ADMIN_COOKIE || '');
  const companionUrl = readArg('--companion-url', process.env.COMPANION_HEALTH_URL || 'http://127.0.0.1:18765/v1/health');
  const desktopVersion = readArg('--desktop-version', readDesktopVersion());
  const outPath = readArg('--out', '');
  const agentSettingsPath = readArg('--agent-settings', process.env.ASSETCUTTER_AGENT_SETTINGS_PATH || defaultAgentSettingsPath());

  const readinessArgs = [
    'scripts/check-codex-one-click-readiness.mjs',
    '--json',
    `--companion-url=${companionUrl}`,
  ];
  if (!skipConversationSmoke) readinessArgs.push('--conversation-smoke');
  if (strict) readinessArgs.push('--strict');

  const productionArgs = [
    'scripts/verify-codex-one-click-production.mjs',
    '--json',
    `--auth-base=${authBase}`,
    `--desktop-version=${desktopVersion}`,
  ];
  if (cookie) productionArgs.push(`--cookie=${cookie}`);
  if (strict) productionArgs.push('--strict');

  const readiness = runJson('node', readinessArgs);
  const production = runJson('node', productionArgs);
  const desktopOneClick = readDesktopOneClickSetupReport(agentSettingsPath, desktopVersion);
  const results = [
    ...flattenResults('local', readiness),
    {
      section: 'local',
      id: 'desktop_one_click_setup',
      label: 'Desktop one-click Codex setup report',
      level: desktopOneClick.level,
      detail: desktopOneClick.detail,
    },
    ...flattenResults('production', production),
  ];
  const failed = results.filter((item) => item.level === 'fail');
  const warned = results.filter((item) => item.level === 'warn');
  const nextActions = buildNextActions(results);
  const ok = readiness.ok && production.ok && !failed.length && (!strict || !warned.length);
  const report = {
    ok,
    strict,
    generatedAt: new Date().toISOString(),
    authBase,
    companionUrl,
    desktopVersion,
    localConversationSmoke: !skipConversationSmoke,
    agentSettingsPath,
    desktopOneClickSetup: desktopOneClick,
    local: readiness.parsed || { ok: readiness.ok, stdout: readiness.stdout, stderr: readiness.stderr },
    production: production.parsed || { ok: production.ok, stdout: production.stdout, stderr: production.stderr },
    results,
    nextActions,
  };
  const reportPath = path.resolve(outPath || defaultReportPath());
  report.reportPath = reportPath;
  writeReport(report, reportPath);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Codex clean-machine acceptance');
    console.log(`desktopVersion: ${desktopVersion || 'unknown'}`);
    console.log(`authBase: ${authBase}`);
    console.log(`companion: ${companionUrl}`);
    console.log(`report: ${reportPath}`);
    for (const item of results) {
      const mark = item.level === 'ok' ? 'OK' : item.level === 'warn' ? 'WARN' : 'FAIL';
      console.log(`[${mark}] ${item.section}/${item.label}: ${item.detail}`);
    }
    if (nextActions.length) {
      console.log('Next actions:');
      for (const item of nextActions) {
        console.log(`- ${item.action}`);
      }
    }
    const resultText = ok && !warned.length
      ? 'Result: clean-machine evidence is complete.'
      : ok
        ? 'Result: clean-machine diagnostic report collected; warnings remain.'
        : 'Result: clean-machine evidence still needs attention.';
    console.log(resultText);
  }
  process.exitCode = ok ? 0 : 1;
}

main();
