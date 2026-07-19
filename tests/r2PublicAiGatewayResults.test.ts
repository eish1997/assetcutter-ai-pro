import { beforeEach, describe, expect, it, vi } from 'vitest';

const awsMock = vi.hoisted(() => {
  const send = vi.fn();
  class S3Client {
    send = send;
  }
  class GetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class ListObjectsV2Command {
    constructor(public input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  class HeadObjectCommand {
    constructor(public input: unknown) {}
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  return {
    send,
    S3Client,
    GetObjectCommand,
    ListObjectsV2Command,
    DeleteObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
  };
});

vi.mock('@aws-sdk/client-s3', () => awsMock);

const { handleR2StorageRequest } = await import('../server/r2-storage-handlers.js');

function makeRes() {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    body: Buffer.alloc(0),
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    writeHead(status: number, h: Record<string, string>) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(h || {})) headers.set(k.toLowerCase(), String(v));
    },
    end(chunk?: unknown) {
      if (chunk == null) return;
      this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    },
  };
}

describe('R2 public AI Gateway result objects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'access';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'bucket';
  });

  it('streams public AI Gateway result objects without a session', async () => {
    awsMock.send.mockResolvedValueOnce({
      ContentType: 'image/png',
      Body: { transformToByteArray: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    });
    const req = {
      method: 'GET',
      url: '/api/r2/objects/public/ai-gateway-results/user/job/out.png',
      headers: { origin: 'http://localhost:5173' },
    };
    const res = makeRes();

    await handleR2StorageRequest(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.body.toString('hex')).toBe('89504e47');
    expect(awsMock.send.mock.calls[0]?.[0]).toBeInstanceOf(awsMock.GetObjectCommand);
    expect(awsMock.send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: 'bucket',
      Key: 'public/ai-gateway-results/user/job/out.png',
    });
  });

  it('keeps private objects behind the existing session check', async () => {
    const req = {
      method: 'GET',
      url: '/api/r2/objects/users/alice-user_1/workspace/projects/p/assets/out.png',
      headers: { origin: 'http://localhost:5173' },
    };
    const res = makeRes();

    await handleR2StorageRequest(req, res);

    expect(res.statusCode).toBe(401);
    expect(awsMock.send).not.toHaveBeenCalled();
  });
});
