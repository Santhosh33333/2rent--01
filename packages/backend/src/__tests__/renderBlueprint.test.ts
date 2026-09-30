import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAllowedOrigins, isOriginAllowed } from '../config/corsOrigins';

/**
 * Guards the value render.yaml actually deploys.
 *
 * The outage this covers was invisible from the dashboard: CORS_ORIGIN was
 * `sync: false`, so the deployed value came from a hand-typed dashboard entry
 * that nobody could see from the repo. Parsing the blueprint here means a
 * malformed or stale origin list fails a test instead of production.
 */
function blueprintValue(key: string): string | undefined {
  // render.yaml is at the repo root. Resolved from the package root rather than
  // via import.meta, which this package's CommonJS build rejects.
  const yaml = readFileSync(resolve(process.cwd(), '..', '..', 'render.yaml'), 'utf8');
  const lines = yaml.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- key: ${key}`);
  if (at === -1) return undefined;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^\s*- key: /.test(lines[i])) return undefined;
    const v = lines[i].match(/^\s*value:\s*(.+)$/);
    if (v) return v[1].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

describe('render.yaml CORS configuration', () => {
  const cors = blueprintValue('CORS_ORIGIN');
  const publicWeb = blueprintValue('PUBLIC_WEB_ORIGIN');

  it('commits a CORS_ORIGIN value instead of leaving it to the dashboard', () => {
    // sync: false here is what let the custom domain go missing in the first
    // place. The variable must now carry a committed value.
    expect(cors).toBeTruthy();
  });

  it('commits a PUBLIC_WEB_ORIGIN so payments return to the real site', () => {
    expect(publicWeb).toBeTruthy();
    expect(publicWeb).toBe('https://yuvers.in');
  });

  it('parses into the origins it claims to contain', () => {
    const list = parseAllowedOrigins(cors);
    expect(list).toEqual(
      expect.arrayContaining(['https://yuvers.in', 'https://www.yuvers.in']),
    );
  });

  it('allows the deployed domains', () => {
    const list = parseAllowedOrigins(cors);
    expect(isOriginAllowed('https://yuvers.in', list)).toBe(true);
    expect(isOriginAllowed('https://www.yuvers.in', list)).toBe(true);
  });

  it('keeps the apex and www distinct, and still rejects strangers', () => {
    const list = parseAllowedOrigins(cors);
    // A lookalike host must not ride along on the suffix.
    expect(isOriginAllowed('https://yuvers.in.evil.com', list)).toBe(false);
    expect(isOriginAllowed('http://yuvers.in', list)).toBe(false);
    expect(isOriginAllowed('https://evil.com', list)).toBe(false);
  });
});
