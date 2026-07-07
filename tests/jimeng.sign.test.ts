import { describe, expect, it } from 'vitest';
import {
  formatVolcXDate,
  sha256Hex,
  shortDateFromXDate,
  signVolcengineRequest,
  volcUriEncode,
} from '../server/jimeng-sign.js';

describe('jimeng-sign', () => {
  const fixedNow = new Date('2020-11-03T10:40:27.000Z');
  const accessKeyId = 'testAccessKeyId';
  const secretAccessKey = 'testSecretAccessKey';
  const host = 'visual.volcengineapi.com';

  it('formatVolcXDate 输出 UTC ISO8601', () => {
    expect(formatVolcXDate(fixedNow)).toBe('20201103T104027Z');
    expect(shortDateFromXDate('20201103T104027Z')).toBe('20201103');
  });

  it('volcUriEncode 保留未保留字符', () => {
    expect(volcUriEncode('Action')).toBe('Action');
    expect(volcUriEncode('2022-08-31')).toBe('2022-08-31');
  });

  it('sha256Hex 空串', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('固定 clock 下签名可复现', () => {
    const body = JSON.stringify({ req_key: 'jimeng_t2i_v40', prompt: 'hello' });
    const query = { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' };
    const a = signVolcengineRequest({
      method: 'POST',
      host,
      path: '/',
      query,
      body,
      accessKeyId,
      secretAccessKey,
      region: 'cn-north-1',
      service: 'cv',
      now: fixedNow,
    });
    const b = signVolcengineRequest({
      method: 'POST',
      host,
      path: '/',
      query,
      body,
      accessKeyId,
      secretAccessKey,
      region: 'cn-north-1',
      service: 'cv',
      now: fixedNow,
    });
    expect(a.authorization).toBe(b.authorization);
    expect(a.signature).toBe(b.signature);
    expect(a.authorization).toMatch(/^HMAC-SHA256 Credential=testAccessKeyId\/20201103\/cn-north-1\/cv\/request,/);
    expect(a.authorization).toContain('SignedHeaders=content-type;host;x-content-sha256;x-date');
    expect(a.xDate).toBe('20201103T104027Z');
    expect(a.xContentSha256).toBe(sha256Hex(body));
  });

  it('Query / Body 变化会改变签名', () => {
    const base = {
      method: 'POST',
      host,
      path: '/',
      query: { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' },
      accessKeyId,
      secretAccessKey,
      region: 'cn-north-1',
      service: 'cv',
      now: fixedNow,
    };
    const s1 = signVolcengineRequest({ ...base, body: '{"a":1}' });
    const s2 = signVolcengineRequest({ ...base, body: '{"a":2}' });
    expect(s1.signature).not.toBe(s2.signature);
  });
});
