import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  clearSessionCookie,
  cookieDomainAttr,
  serializeSessionCookie,
} from '../server/auth-session.js';

describe('auth-session cookies', () => {
  const prev = process.env.AUTH_COOKIE_DOMAIN;

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTH_COOKIE_DOMAIN;
    else process.env.AUTH_COOKIE_DOMAIN = prev;
  });

  it('cookieDomainAttr empty when unset', () => {
    delete process.env.AUTH_COOKIE_DOMAIN;
    expect(cookieDomainAttr()).toBe('');
  });

  it('cookieDomainAttr normalizes bare domain', () => {
    process.env.AUTH_COOKIE_DOMAIN = 'adrazzo.com';
    expect(cookieDomainAttr()).toBe('; Domain=.adrazzo.com');
  });

  it('serializeSessionCookie includes Domain when configured', () => {
    process.env.AUTH_COOKIE_DOMAIN = '.adrazzo.com';
    const line = serializeSessionCookie('tok', 60_000);
    expect(line).toContain('ac_session=');
    expect(line).toContain('; Domain=.adrazzo.com');
    expect(line).toContain('HttpOnly');
  });

  it('clearSessionCookie clears with domain', () => {
    process.env.AUTH_COOKIE_DOMAIN = 'adrazzo.com';
    const line = clearSessionCookie();
    expect(line).toContain('Max-Age=0');
    expect(line).toContain('; Domain=.adrazzo.com');
  });
});
