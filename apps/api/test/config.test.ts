import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

const environment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://localhost/releasedesk_test',
  SESSION_SECRET: 'test-only-secret-with-at-least-32-characters',
};

describe('browser origin configuration', () => {
  it('normalizes a pasted root URL to the origin browsers send', () => {
    expect(
      readConfig({ ...environment, APP_ORIGIN: 'https://ReleaseDesk.example:443/' }).APP_ORIGIN,
    ).toBe('https://releasedesk.example');
    expect(
      readConfig({ ...environment, NODE_ENV: 'development', APP_ORIGIN: 'http://localhost:5173/' })
        .APP_ORIGIN,
    ).toBe('http://localhost:5173');
  });

  it.each([
    'not-a-url',
    'https://releasedesk.example/releases',
    'https://releasedesk.example/?preview=true',
    'https://releasedesk.example/#workspace',
    'https://user:password@releasedesk.example',
    'ftp://releasedesk.example',
  ])('rejects a URL that cannot be a browser origin', (APP_ORIGIN) => {
    expect(() => readConfig({ ...environment, APP_ORIGIN })).toThrow(/APP_ORIGIN/);
  });
});
