import http from 'http';
import { handleR2StorageRequest, assertR2Config } from './r2-storage-handlers.js';

/** 优先 R2_API_PORT；未设时用 PORT（Render 等 PaaS）；默认 9003 */
const PORT = Number(process.env.R2_API_PORT || process.env.PORT) || 9003;
const BIND_HOST = (process.env.R2_API_BIND_HOST || '0.0.0.0').trim() || '0.0.0.0';

assertR2Config();

const server = http.createServer((req, res) => {
  handleR2StorageRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  });
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`[r2-storage-api] http://${BIND_HOST}:${PORT}`);
});
