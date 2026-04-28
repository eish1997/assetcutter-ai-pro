import { createServer } from 'node:http';
import { ensureRepositoryRoot } from './repositoryVolume.js';
import { handleRequest } from './httpHandler.js';

export type CompanionHttpServer = {
  port: number;
  close: () => Promise<void>;
};

export function startCompanionHttpServer(port: number): Promise<CompanionHttpServer> {
  ensureRepositoryRoot();

  const server = createServer((req, res) => {
    void handleRequest(req, res, port);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({
        port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
