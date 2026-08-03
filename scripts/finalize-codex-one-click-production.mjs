#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const shouldPublish = args.has('--publish');
const strict = args.has('--strict');
const skipLocalSmoke = args.has('--skip-local-smoke');
const applyRenderAuth = args.has('--apply-render-auth');
const deployRenderAuth = args.has('--deploy-render-auth');
const waitRenderAuthDeploy = args.has('--wait-render-auth-deploy');
const requireCleanMachine = args.has('--require-clean-machine');
const cleanMachineRequired = requireCleanMachine || (shouldPublish && strict);

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

function run(label, command, commandArgs, options = {}) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
    return false;
  }
  return result.status === 0;
}

function hasEnv(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function printCleanMachineNextActions(authBase, desktopVersion) {
  const versionArg = desktopVersion ? ` -DesktopVersion ${desktopVersion}` : '';
  console.log('\nNext clean-machine acceptance steps:');
  console.log('1. Put AssetCutterCompanion-*-clean-machine-acceptance.zip on a fresh Windows PC and unzip it.');
  console.log(
    `2. Run: powershell -ExecutionPolicy Bypass -File .\\verify-codex-clean-machine.ps1 -LaunchInstaller -AutoCodexSetup -Strict -AuthBase ${authBase}${versionArg} -Cookie <logged-in-cookie>`,
  );
  console.log('3. After it writes codex-clean-machine-report-*.json, rerun:');
  console.log(
    `   npm run companion:codex-finalize-production -- --strict --auth-base=${authBase} --auth-cookie=<logged-in-cookie> --clean-machine-report=<report.json>`,
  );
}

function printPublishNextActions(authBase) {
  console.log('\nNext publish step:');
  console.log(
    `Set COMPANION_ADMIN_COOKIE, or run: npm run companion:codex-finalize-production -- --publish --strict --auth-base=${authBase} --auth-cookie=<logged-in-cookie> --cookie=<admin-cookie>`,
  );
}

function printSharedAuthNextActions(authEnvFile) {
  console.log('\nNext cloud identity step:');
  console.log('Run: npm run companion:codex-auth-env');
  if (authEnvFile) {
    console.log(`Then validate: npm run companion:codex-auth-env:check -- --env-file=${authEnvFile}`);
  }
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findReportResult(report, id) {
  const results = Array.isArray(report?.results) ? report.results : [];
  return results.find((item) => item && String(item.id || '') === id) || null;
}

function validateCleanMachineReport(file, expectedVersion) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) {
    return { ok: false, detail: `Clean-machine report not found: ${target}` };
  }
  let report;
  try {
    report = readJsonFile(target);
  } catch (error) {
    return {
      ok: false,
      detail: `Clean-machine report is not valid JSON: ${error && error.message ? error.message : String(error)}`,
    };
  }
  const problems = [];
  const version = String(report.desktopVersion || '').trim();
  if (expectedVersion && version !== expectedVersion) {
    problems.push(`report desktopVersion is ${version || 'missing'}, expected ${expectedVersion}`);
  }
  if (!report.ok) problems.push('report ok is not true');
  if (report.localConversationSmoke !== true) problems.push('local conversation smoke was skipped');

  const setup = report.desktopOneClickSetup?.report || report.desktopOneClickSetup;
  if (!setup || typeof setup !== 'object') {
    problems.push('desktop one-click setup report is missing');
  } else {
    if (!setup.ok) problems.push('desktop one-click setup did not pass');
    if (!setup.cloudIdentitySynced) problems.push('cloud identity was not synced by one-click setup');
    if (!setup.conversationVerified) problems.push('one-click setup did not verify a real conversation');
  }

  for (const id of ['codex_auth_payload', 'desktop_update_feed', 'codex_conversation_smoke']) {
    const item = findReportResult(report, id);
    if (!item) {
      problems.push(`${id} result is missing`);
    } else if (item.level !== 'ok') {
      problems.push(`${id} is ${item.level || 'unknown'}: ${item.detail || ''}`.trim());
    }
  }

  return {
    ok: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `Clean-machine report is complete: ${target}`,
  };
}

function main() {
  const authBase = readArg('--auth-base', process.env.AUTH_API_BASE || 'https://assetcutter-auth-api.onrender.com');
  const desktopVersion = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/package.json'), 'utf8'));
      return String(pkg.version || '').trim();
    } catch {
      return '';
    }
  })();
  const authEnvFileArg = readArg('--auth-env-file', '');
  const cleanMachineReport = readArg('--clean-machine-report', process.env.CODEX_CLEAN_MACHINE_REPORT || '');
  const defaultAuthEnvFile = path.resolve(process.cwd(), '.env.codex-shared-auth.local');
  const authEnvFile = authEnvFileArg
    ? path.resolve(authEnvFileArg)
    : fs.existsSync(defaultAuthEnvFile)
      ? defaultAuthEnvFile
      : '';
  const adminCookie = readArg('--cookie', process.env.COMPANION_ADMIN_COOKIE || '');
  const explicitAuthCheckCookie = readArg('--auth-cookie', process.env.CODEX_SHARED_AUTH_CHECK_COOKIE || '');
  const authCheckCookie = explicitAuthCheckCookie || adminCookie;
  const buildProductionArgs = (forceStrict = false) => {
    const productionArgs = ['run', 'companion:codex-production-check', '--', `--auth-base=${authBase}`];
    if (authCheckCookie) productionArgs.push(`--cookie=${authCheckCookie}`);
    if (strict || forceStrict) productionArgs.push('--strict');
    return productionArgs;
  };

  console.log('Codex one-click production finalizer');
  console.log(`authBase: ${authBase}`);
  console.log(`publish: ${shouldPublish}`);
  console.log(`adminCookie: ${adminCookie ? 'present' : 'missing'}`);
  console.log(`authCheckCookie: ${authCheckCookie ? 'present' : 'missing'}`);
  console.log(`renderApiKey: ${hasEnv('RENDER_API_KEY') ? 'present' : 'missing'}`);
  console.log(`applyRenderAuth: ${applyRenderAuth}`);
  console.log(`deployRenderAuth: ${deployRenderAuth}`);
  console.log(`waitRenderAuthDeploy: ${waitRenderAuthDeploy}`);
  console.log(`requireCleanMachine: ${requireCleanMachine}`);
  console.log(`cleanMachineRequired: ${cleanMachineRequired}`);
  console.log(`cleanMachineReport: ${cleanMachineReport ? path.resolve(cleanMachineReport) : 'missing'}`);
  const sharedAuthEnvPresent = hasEnv('CODEX_SHARED_AUTH_JSON_BASE64') || hasEnv('CODEX_SHARED_AUTH_JSON');
  console.log(`sharedAuthEnv: ${sharedAuthEnvPresent ? 'present' : 'missing'}`);
  console.log(`sharedAuthEnvFile: ${authEnvFile ? authEnvFile : 'missing'}`);
  console.log(`localConversationSmoke: ${skipLocalSmoke ? 'skipped' : 'required'}`);

  let ok = true;
  if (applyRenderAuth && !authEnvFile) {
    console.error('\nMissing Codex shared auth env file. Run npm run companion:codex-auth-env first, or pass --auth-env-file=...');
    printSharedAuthNextActions(defaultAuthEnvFile);
    ok = false;
  }
  if (cleanMachineRequired && !cleanMachineReport && !shouldPublish) {
    console.error('\nMissing clean-machine acceptance report. Run the bundled verify-codex-clean-machine.ps1 on a fresh Windows PC, then pass --clean-machine-report=...');
    printCleanMachineNextActions(authBase, desktopVersion);
    ok = false;
  }
  if (!ok) {
    console.log('\nResult: attention needed before production is ready.');
    process.exitCode = 1;
    return;
  }
  if (sharedAuthEnvPresent) {
    ok = run('Validate Codex shared auth env shape', 'npm', ['run', 'companion:codex-auth-env:check']) && ok;
  } else if (authEnvFile) {
    ok = run('Validate Codex shared auth env file shape', 'npm', [
      'run',
      'companion:codex-auth-env:check',
      '--',
      `--env-file=${authEnvFile}`,
    ]) && ok;
    console.log('\nShared auth env file is valid locally. Next, paste its CODEX_SHARED_AUTH_* values into Render auth-api and redeploy, or run:');
    console.log(`npm run companion:codex-render-auth-env:apply -- --env-file=${authEnvFile} --apply --deploy`);
  }
  if (applyRenderAuth && authEnvFile) {
    const applyArgs = [
      'run',
      'companion:codex-render-auth-env:apply',
      '--',
      `--env-file=${authEnvFile}`,
      '--apply',
      ...(deployRenderAuth ? ['--deploy'] : []),
      ...(waitRenderAuthDeploy ? ['--wait-deploy'] : []),
    ];
    ok = run(
      deployRenderAuth ? 'Apply Codex shared auth env to Render and trigger deploy' : 'Apply Codex shared auth env to Render',
      'npm',
      applyArgs,
    ) && ok;
    if (!ok) {
      console.log('\nResult: attention needed before production is ready.');
      process.exitCode = 1;
      return;
    }
  }
  if (!skipLocalSmoke) {
    ok = run('Verify local Codex one-click readiness with real conversation', 'npm', [
      'run',
      'companion:codex-one-click-check',
      '--',
      '--conversation-smoke',
      ...(strict ? ['--strict'] : []),
    ]) && ok;
  }
  ok = run('Prepare desktop upload manifest', 'npm', ['run', 'companion:desktop-upload-manifest']) && ok;
  ok = run('Validate desktop publish payload', 'npm', ['run', 'companion:desktop-publish', '--', '--dry-run', `--auth-base=${authBase}`]) && ok;
  ok = run('Check production path', 'npm', buildProductionArgs(false)) && ok;

  if (shouldPublish) {
    if (!adminCookie) {
      console.error('\nMissing admin cookie. Set COMPANION_ADMIN_COOKIE or pass --cookie=...');
      printPublishNextActions(authBase);
      process.exitCode = 1;
      return;
    }
    ok = run('Publish desktop installer and register artifact', 'npm', [
      'run',
      'companion:desktop-publish',
      '--',
      `--auth-base=${authBase}`,
      `--cookie=${adminCookie}`,
    ]) && ok;
    ok = run('Verify production after publish (strict)', 'npm', buildProductionArgs(true)) && ok;
  }

  if (cleanMachineReport) {
    console.log('\n== Validate clean-machine acceptance report ==');
    const cleanMachine = validateCleanMachineReport(cleanMachineReport, desktopVersion);
    if (cleanMachine.ok) {
      console.log(`Clean-machine acceptance report: ${cleanMachine.detail}`);
    } else {
      console.error(`Clean-machine acceptance report failed: ${cleanMachine.detail}`);
      ok = false;
    }
  } else if (cleanMachineRequired) {
    console.error('\nMissing clean-machine acceptance report. Publish is not the final acceptance step: run the bundled verify-codex-clean-machine.ps1 on a fresh Windows PC after the update feed is live, then rerun finalizer with --clean-machine-report=...');
    printCleanMachineNextActions(authBase, desktopVersion);
    ok = false;
  }

  console.log(ok ? '\nResult: finalizer checks completed.' : '\nResult: attention needed before production is ready.');
  process.exitCode = ok ? 0 : 1;
}

main();
