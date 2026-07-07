/**
 * 诊断：从 R2 读取工作区 projects-index / workflow.json 资产数量
 * 用法：node --env-file=.env.local scripts/fetch-cloud-workflow.mjs [username] [userId] [projectId]
 */
import { presignGetByKey } from '../server/r2-storage-handlers.js';

const username = process.argv[2] || 'maoer';
const userId = process.argv[3] || 'd93ce5f5-38f9-4b66-8f40-b64028b53fae';
const projectId = process.argv[4] || 'b46346dd-6d5b-465a-b457-1331f5f3e8c7';

function userDir() {
  const name = String(username || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return name ? `${name}-${userId}` : userId;
}

async function readKey(key) {
  try {
    const { downloadUrl } = await presignGetByKey(key, 300);
    const res = await fetch(downloadUrl);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/NoSuchKey|NotFound|404/.test(msg)) return null;
    throw e;
  }
}

const root = `users/${userDir()}/workspace`;
const indexKey = `${root}/projects-index.json`;
const workflowKey = `${root}/projects/${projectId}/workflow.json`;

const indexRaw = await readKey(indexKey);
const workflowRaw = await readKey(workflowKey);

console.log('indexKey', indexKey, indexRaw ? 'FOUND' : 'MISSING');
if (indexRaw) {
  const idx = JSON.parse(indexRaw);
  console.log('projects', idx.projects?.length ?? 0, 'lastOpen', idx.lastOpenProjectId);
}

console.log('workflowKey', workflowKey, workflowRaw ? 'FOUND' : 'MISSING');
if (workflowRaw) {
  const wf = JSON.parse(workflowRaw);
  console.log(
    'assets',
    Array.isArray(wf.assets) ? wf.assets.length : 0,
    'pending',
    Array.isArray(wf.pending) ? wf.pending.length : 0,
    'version',
    wf.version
  );
  if (Array.isArray(wf.assets) && wf.assets.length) {
    console.log(
      'sample asset ids',
      wf.assets.slice(0, 5).map((a) => a.id)
    );
  }
}
