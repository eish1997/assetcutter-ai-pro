/**
 * 批量出图 API：全公司 RPD 900 + 并发 2、Job 持久化（可选）。
 * 用法：GEMINI_API_KEY=xxx node server/bulk-image-api.js
 * 默认端口 9002，前端设置 VITE_BULK_IMAGE_API=http://localhost:9002
 * 可选 BULK_IMAGE_DATA_DIR 指定目录时持久化 jobs.json 与 rpd.json，重启恢复。
 */
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const PORT = Number(process.env.BULK_IMAGE_PORT || process.env.PORT) || 9002;
const DATA_DIR = (process.env.BULK_IMAGE_DATA_DIR || '').trim();
const PERSIST_DEBOUNCE_MS = 2000;
// Render / Railway 等云平台要求 Web 服务监听在 0.0.0.0 才能被端口扫描到；
// 本地开发若未显式设置，监听 0.0.0.0 也能正常访问（通过 localhost）。
const BIND_HOST = (process.env.BULK_IMAGE_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';
const RPD_DAILY_LIMIT = Number(process.env.BULK_IMAGE_RPD_DAILY_LIMIT) || 900;
const MAX_CONCURRENT = Number(process.env.BULK_IMAGE_MAX_CONCURRENT) || 2;
const IMAGES_PER_REQUEST = 4;
const MAX_JOBS_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const STEP_RETRIES = 2;
const STEP_RETRY_DELAY_MS = 2000;
const IMAGE_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_IMAGE_REQUEST_TIMEOUT_MS) || 120_000;
const ONE_BULK_JOB_AT_A_TIME = true;
const QUEUE_HIGH_WATERMARK = Number(process.env.BULK_IMAGE_QUEUE_HIGH_WATERMARK) || 10;
const QUEUE_HIGH_LOG_INTERVAL_MS = 60_000;

const DEFAULT_PROMPTS = {
  edit: `[HIGH PRECISION EDITING PROTOCOL]
      Modify this image according to the user instruction with surgical accuracy.
      Maintain the core object's geometry, scale, and lighting consistency.
      Ensure the output is high-definition, sharp, and free of artifacts.
      Instruction: {instruction}`,
  dialog_text_to_image: `Generate a single high-quality image from the following description. Be faithful to the description: composition, style, subjects, and mood. Output only the image; no text.
Description: {instruction}`,
};

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function parseAllowedOrigins() {
  const raw = (process.env.PROXY_ALLOWED_ORIGINS || '').trim();
  if (!raw) return new Set(DEFAULT_ALLOWED_ORIGINS);
  if (raw === '*') return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

const allowedOrigins = parseAllowedOrigins();

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (allowedOrigins === null) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else res.setHeader('Access-Control-Allow-Origin', '*');
    return true;
  }
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return true;
  }
  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return true;
  }
  return false;
}

function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s, 'utf8') });
  res.end(s);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function normalizeSecret(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\uFEFF/g, '').replace(/\r\n?/g, '').trim();
}

// ---------- RPD (in-memory, keyed by date) ----------
const rpdByDate = new Map();

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayRPD() {
  const key = getTodayKey();
  return Math.max(0, rpdByDate.get(key) || 0);
}

function incrementTodayRPD() {
  const key = getTodayKey();
  rpdByDate.set(key, getTodayRPD() + 1);
  schedulePersist();
}

let persistTimer = null;
function schedulePersist() {
  if (!DATA_DIR) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, PERSIST_DEBOUNCE_MS);
}

async function persist() {
  persistTimer = null;
  if (!DATA_DIR) return;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const jobsPath = path.join(DATA_DIR, 'jobs.json');
    const jobsList = Array.from(jobs.values());
    await fs.writeFile(jobsPath, JSON.stringify(jobsList, null, 0), 'utf8');
    const rpdPath = path.join(DATA_DIR, 'rpd.json');
    const rpdObj = Object.fromEntries(rpdByDate);
    await fs.writeFile(rpdPath, JSON.stringify(rpdObj), 'utf8');
  } catch (e) {
    console.error('[bulk-image-api] persist error:', e?.message || e);
  }
}

async function loadPersisted() {
  if (!DATA_DIR) return;
  try {
    const jobsPath = path.join(DATA_DIR, 'jobs.json');
    const raw = await fs.readFile(jobsPath, 'utf8').catch(() => null);
    if (raw) {
      const list = JSON.parse(raw);
      for (const j of list) {
        if (j && j.id) {
          if (j.status === 'pending' || j.status === 'running') {
            j.status = 'cancelled';
            j.errorSummary = '服务重启，任务已停止';
          }
          jobs.set(j.id, j);
        }
      }
    }
    const rpdPath = path.join(DATA_DIR, 'rpd.json');
    const rpdRaw = await fs.readFile(rpdPath, 'utf8').catch(() => null);
    if (rpdRaw) {
      const obj = JSON.parse(rpdRaw);
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number' && v >= 0) rpdByDate.set(k, v);
      }
    }
  } catch (e) {
    console.error('[bulk-image-api] load persisted error:', e?.message || e);
  }
}

// ---------- Gemini: single request, return all images ----------
async function generateImages(apiKey, imageBase64, instruction, numImages, model, options) {
  const key = normalizeSecret(apiKey || process.env.GEMINI_API_KEY || '');
  if (!key) throw new Error('No Gemini API key (env GEMINI_API_KEY or request apiKey)');
  const ai = new GoogleGenAI({ apiKey: key });
  const isTextToImage = !imageBase64;
  const systemInstruction = (isTextToImage ? DEFAULT_PROMPTS.dialog_text_to_image : DEFAULT_PROMPTS.edit).replace('{instruction}', instruction);
  const config = { systemInstruction };
  if (options?.aspectRatio || options?.imageSize) {
    config.imageConfig = {};
    if (options.aspectRatio) config.imageConfig.aspectRatio = options.aspectRatio;
    if (options.imageSize) config.imageConfig.imageSize = options.imageSize;
  }
  const parts = isTextToImage
    ? [{ text: instruction }]
    : [
        { inlineData: { mimeType: 'image/jpeg', data: (imageBase64 || '').split(',')[1] || imageBase64 || '' } },
        { text: instruction },
      ];
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.5-flash-image',
    contents: { parts },
    config: { ...config, httpOptions: { timeout: IMAGE_REQUEST_TIMEOUT_MS } },
  });
  const out = [];
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) out.push(`data:image/png;base64,${part.inlineData.data}`);
  }
  if (out.length === 0) {
    const textPart = response.candidates?.[0]?.content?.parts?.find((p) => p.text);
    const hint = textPart?.text?.slice(0, 120) ? `（模型返回了文字: ${String(textPart.text).slice(0, 120)}…）` : '（当前模型可能不支持图像输出）';
    throw new Error(`生图未返回图片${hint}`);
  }
  return out;
}

async function proxyGenerateContent(model, contents, config) {
  const key = normalizeSecret(process.env.GEMINI_API_KEY || '');
  if (!key) throw new Error('No Gemini API key (env GEMINI_API_KEY)');
  const ai = new GoogleGenAI({ apiKey: key });
  const safeConfig = { ...(config || {}) };
  if (safeConfig.abortSignal) delete safeConfig.abortSignal;
  const timeout = Number(safeConfig?.httpOptions?.timeout) || IMAGE_REQUEST_TIMEOUT_MS;
  const mergedConfig = {
    ...safeConfig,
    httpOptions: { ...(safeConfig.httpOptions || {}), timeout },
  };
  const response = await ai.models.generateContent({
    model: model || 'gemini-2.5-flash',
    contents,
    config: mergedConfig,
  });
  // 将 Node SDK 的响应压缩成前端常用的轻量结构，保持与浏览器 SDK 近似：
  // - text: 聚合文本
  // - candidates: 原始 candidates（包含 content.parts 等）
  const text = typeof response.text === 'string' ? response.text : '';
  const candidates = response.candidates || response.response?.candidates || [];
  return { text, candidates };
}

function isRetryable(e) {
  const msg = String((e && e.message) || e);
  return /429|503|overloaded|UNAVAILABLE|500|INTERNAL|Internal error/i.test(msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Job store & queue ----------
const jobs = new Map();
const pendingSteps = [];
let inFlight = 0;
const jobAbortControllers = new Map();
let lastQueueHighLogAt = 0;
const perUserDailyRequests = new Map();

const PER_USER_DAILY_LIMIT = Number(process.env.BULK_IMAGE_PER_USER_DAILY_LIMIT) || 0;

function getTodayUserKey(userId) {
  if (!userId) return null;
  return `${getTodayKey()}|${userId}`;
}

function getTodayUserRequests(userId) {
  const key = getTodayUserKey(userId);
  if (!key) return 0;
  return perUserDailyRequests.get(key) || 0;
}

function addTodayUserRequests(userId, n) {
  const key = getTodayUserKey(userId);
  if (!key) return;
  const prev = perUserDailyRequests.get(key) || 0;
  perUserDailyRequests.set(key, prev + n);
}

function updateJob(id, patchOrUpdater) {
  const job = jobs.get(id);
  if (!job) return false;
  const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater(job) : patchOrUpdater;
  if (!patch || Object.keys(patch).length === 0) return false;
  const next = { ...job, ...patch, updatedAt: Date.now() };
  jobs.set(id, next);
  schedulePersist();
  return true;
}

function deriveStatus(job, hasError) {
  if (job.status === 'cancelled') return 'cancelled';
  const done = Array.isArray(job.results) ? job.results.length : 0;
  const total = Number(job.totalImages) || 0;
  if (total <= 0) return hasError ? 'failed' : 'running';
  if (done === 0 && hasError) return 'failed';
  if (done >= total) return 'completed';
  if (done > 0 && hasError) return 'partial';
  return 'running';
}

async function runStepWithRetry(step) {
  const opts = step.aspectRatio || step.imageSize ? { aspectRatio: step.aspectRatio, imageSize: step.imageSize } : undefined;
  let lastErr;
  for (let attempt = 0; attempt <= STEP_RETRIES; attempt++) {
    try {
      return await generateImages(step.apiKey, step.imageBase64, step.instruction, step.batchSize, step.model, opts);
    } catch (e) {
      lastErr = e;
      if (attempt < STEP_RETRIES && isRetryable(e)) {
        await sleep(STEP_RETRY_DELAY_MS * Math.pow(2, attempt));
      } else throw e;
    }
  }
  throw lastErr;
}

function processQueue() {
  while (inFlight < MAX_CONCURRENT && pendingSteps.length > 0) {
    const step = pendingSteps.shift();
    const job = jobs.get(step.jobId);
    if (!job || job.status === 'cancelled') {
      processQueue();
      continue;
    }
    inFlight++;
    if (job.status === 'pending') updateJob(step.jobId, { status: 'running' });
    runStepWithRetry(step)
      .then((images) => {
        const applied = updateJob(step.jobId, (prev) => {
          if (prev.status === 'cancelled') return {};
          const nextResults = [...(prev.results || []), ...images].slice(0, prev.totalImages);
          return {
            results: nextResults,
            status: deriveStatus({ ...prev, results: nextResults }, false),
            errorSummary: undefined,
          };
        });
        if (applied) {
          incrementTodayRPD();
          const j = jobs.get(step.jobId);
          if (j && j.status === 'completed') {
            console.log(
              `[job] completed id=${step.jobId} totalImages=${j.totalImages} results=${Array.isArray(j.results) ? j.results.length : 0}`
            );
          }
        }
      })
      .catch((err) => {
        const j = jobs.get(step.jobId);
        if (!j || j.status === 'cancelled') return;
        const message = err?.message ?? String(err);
        updateJob(step.jobId, (prev) => {
          if (prev.status === 'cancelled') return {};
          return {
            status: deriveStatus(prev, true),
            errorSummary: message.length > 80 ? message.slice(0, 80) + '…' : message,
          };
        });
        console.error(
          `[job] failed id=${step.jobId} message="${message.replace(/\s+/g, ' ').slice(0, 160)}"`
        );
      })
      .finally(() => {
        inFlight--;
        processQueue();
      });
  }
  if (pendingSteps.length >= QUEUE_HIGH_WATERMARK) {
    const now = Date.now();
    if (now - lastQueueHighLogAt >= QUEUE_HIGH_LOG_INTERVAL_MS) {
      lastQueueHighLogAt = now;
      console.warn(
        `[quota] queue_high queueLength=${pendingSteps.length} inFlight=${inFlight} maxConcurrent=${MAX_CONCURRENT} watermark=${QUEUE_HIGH_WATERMARK}`
      );
    }
  }
}

function hasAnyPendingOrRunning() {
  for (const j of jobs.values()) {
    if (j.status === 'pending' || j.status === 'running') return true;
  }
  return false;
}

function getPendingOrRunningCount() {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.status === 'pending' || j.status === 'running') n++;
  }
  return n;
}

function createJob(body) {
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) throw new Error('生图指令不能为空');
  const totalImages = Math.min(30, Math.max(1, Number(body.totalImages) || 1));
  if (ONE_BULK_JOB_AT_A_TIME && hasAnyPendingOrRunning()) {
    throw new Error('请等待当前批量任务完成后再新建');
  }
  const requestCount = Math.ceil(totalImages / IMAGES_PER_REQUEST);
  const today = getTodayRPD();
  if (today >= RPD_DAILY_LIMIT) {
    console.warn(
      `[quota] rpd_exceeded today=${today} limit=${RPD_DAILY_LIMIT} requestedSteps=${requestCount} reason=limit_reached`
    );
    throw new Error('今日生图额度已用尽，请明日再试');
  }
  const remaining = RPD_DAILY_LIMIT - today;
  if (requestCount > remaining) {
    console.warn(
      `[quota] rpd_exceeded today=${today} limit=${RPD_DAILY_LIMIT} requestedSteps=${requestCount} remaining=${remaining} reason=insufficient_remaining`
    );
    throw new Error(`今日剩余额度 ${remaining} 次请求，无法完成约 ${requestCount} 次请求`);
  }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (PER_USER_DAILY_LIMIT > 0 && userId) {
    const userToday = getTodayUserRequests(userId);
    const userRemaining = PER_USER_DAILY_LIMIT - userToday;
    if (requestCount > userRemaining) {
      console.warn(
        `[quota] per_user_exceeded userId=${JSON.stringify(
          userId
        )} todaySteps=${userToday} limit=${PER_USER_DAILY_LIMIT} requestedSteps=${requestCount}`
      );
      throw new Error('今日单用户批量额度已用尽，请明日再试（全公司总额度不受影响）');
    }
    addTodayUserRequests(userId, requestCount);
  }
  const apiKey = typeof body.apiKey === 'string' ? normalizeSecret(body.apiKey) : undefined;
  const id = `imgjob-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  const job = {
    id,
    instruction,
    totalImages,
    status: 'pending',
    results: [],
    createdAt: now,
    updatedAt: now,
    imageBase64: body.imageBase64 ?? null,
    model: body.model || 'gemini-2.5-flash-image',
    aspectRatio: body.aspectRatio,
    imageSize: body.imageSize,
  };
  jobs.set(id, job);
  console.log(`[job] created id=${id} totalImages=${totalImages} requestCount=${requestCount}`);
  const model = job.model;
  for (let i = 0; i < requestCount; i++) {
    const batchSize = Math.min(IMAGES_PER_REQUEST, totalImages - i * IMAGES_PER_REQUEST);
    pendingSteps.push({
      jobId: id,
      instruction,
      imageBase64: job.imageBase64,
      model,
      batchSize,
      aspectRatio: job.aspectRatio,
      imageSize: job.imageSize,
      apiKey: apiKey || undefined,
    });
  }
  if (inFlight >= MAX_CONCURRENT && pendingSteps.length > 0) {
    console.log(
      `[quota] concurrency_queued jobId=${id} inFlight=${inFlight} queueLength=${pendingSteps.length} maxConcurrent=${MAX_CONCURRENT}`
    );
  }
  processQueue();
  schedulePersist();
  return job;
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return false;
  for (let i = pendingSteps.length - 1; i >= 0; i--) {
    if (pendingSteps[i].jobId === id) pendingSteps.splice(i, 1);
  }
  updateJob(id, { status: 'cancelled' });
  console.log(`[job] cancelled id=${id}`);
  return true;
}

// ---------- HTTP: read body ----------
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > maxBytes) reject(new Error('Body too large'));
      else resolve(body);
    });
  });
}

// ---------- Routes ----------
async function handlePostJobs(req, res, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  try {
    const job = createJob(parsed);
    sendJson(res, 201, job);
  } catch (e) {
    const msg = e?.message ?? String(e);
    sendJson(res, 400, { error: msg });
  }
}

function handleGetJobs(res) {
  const list = Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  sendJson(res, 200, list);
}

function handleGetJob(id, res) {
  const job = jobs.get(id);
  if (!job) {
    sendJson(res, 404, { error: 'Job not found' });
    return;
  }
  sendJson(res, 200, job);
}

function handlePostJobsCancel(id, res) {
  const ok = cancelJob(id);
  if (!ok) {
    sendJson(res, 404, { error: 'Job not found or already finished' });
    return;
  }
  const job = jobs.get(id);
  sendJson(res, 200, job);
}

function handleGetRpd(res) {
  sendJson(res, 200, { today: getTodayRPD(), limit: RPD_DAILY_LIMIT });
}

function handleGetHealth(res) {
  const today = getTodayRPD();
  const pendingOrRunning = getPendingOrRunningCount();
  const payload = {
    ok: true,
    rpdToday: today,
    rpdLimit: RPD_DAILY_LIMIT,
    jobsTotal: jobs.size,
    jobsPendingOrRunning: pendingOrRunning,
    inFlight,
    queueLength: pendingSteps.length,
  };
  sendJson(res, 200, payload);
}

function handleGetMetrics(res) {
  const today = getTodayRPD();
  let pending = 0;
  let running = 0;
  for (const j of jobs.values()) {
    if (j.status === 'pending') pending++;
    else if (j.status === 'running') running++;
  }
  const lines = [
    `bulk_image_rpd_today ${today}`,
    `bulk_image_rpd_limit ${RPD_DAILY_LIMIT}`,
    `bulk_image_jobs_total ${jobs.size}`,
    `bulk_image_jobs_pending ${pending}`,
    `bulk_image_jobs_running ${running}`,
    `bulk_image_queue_length ${pendingSteps.length}`,
    `bulk_image_inflight ${inFlight}`,
  ];
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(lines.join('\n'));
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const corsOk = applyCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    if (!corsOk) sendJson(res, 403, { error: 'Origin not allowed' });
    else {
      res.writeHead(204);
      res.end();
    }
    return;
  }
  if (!corsOk) {
    sendJson(res, 403, { error: 'Origin not allowed' });
    return;
  }

  const path = (req.url || '/').split('?')[0];
  const pathParts = path.slice(1).split('/').filter(Boolean); // ['jobs'] or ['jobs', ':id']

  if (path === '/proxy/gemini/generate-content' && req.method === 'POST') {
    try {
      const body = await readBody(req, MAX_JOBS_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }
      const { model, contents, config } = parsed || {};
      if (!model || !contents) {
        sendError(res, 400, 'Missing model or contents');
        return;
      }
      try {
        const response = await proxyGenerateContent(model, contents, config);
        sendJson(res, 200, response);
      } catch (e) {
        const msg = e?.message ?? String(e);
        console.error('[proxy] gemini generate-content error:', msg);
        sendError(res, 500, msg);
      }
    } catch {
      sendError(res, 500, 'Request error');
    }
    return;
  }

  if (path === '/healthz' && req.method === 'GET') {
    handleGetHealth(res);
    return;
  }

  if (path === '/metrics' && req.method === 'GET') {
    handleGetMetrics(res);
    return;
  }

  if (path === '/rpd' && req.method === 'GET') {
    handleGetRpd(res);
    return;
  }

  if (pathParts[0] === 'jobs') {
    if (pathParts.length === 1 && req.method === 'GET') {
      handleGetJobs(res);
      return;
    }
    if (pathParts.length === 1 && req.method === 'POST') {
      try {
        const body = await readBody(req, MAX_JOBS_BODY_BYTES);
        await handlePostJobs(req, res, body);
      } catch (e) {
        if (e?.message === 'Body too large') sendJson(res, 413, { error: 'Request body too large', max: MAX_JOBS_BODY_BYTES });
        else sendJson(res, 500, { error: 'Request error' });
      }
      return;
    }
    if (pathParts.length === 2 && pathParts[1]) {
      const id = pathParts[1];
      if (req.method === 'GET') {
        handleGetJob(id, res);
        return;
      }
    }
    if (pathParts.length === 3 && pathParts[1] && pathParts[2] === 'cancel' && req.method === 'POST') {
      handlePostJobsCancel(pathParts[1], res);
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found. Use POST /jobs, GET /jobs, GET /jobs/:id, POST /jobs/:id/cancel, GET /rpd' });
});

loadPersisted().then(() => {
  server.listen(PORT, BIND_HOST, () => {
    console.log(`[bulk-image-api] http://${BIND_HOST}:${PORT} (RPD limit: ${RPD_DAILY_LIMIT}, concurrent: ${MAX_CONCURRENT}${DATA_DIR ? `, persist: ${DATA_DIR}` : ''})`);
  });
});
