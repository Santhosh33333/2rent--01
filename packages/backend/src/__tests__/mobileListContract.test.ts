import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the mobile list-payload contract.
 *
 * The mobile screens read list endpoints with expressions like
 * `data?.data?.bookings ?? data?.data ?? []` and cast the result to `any[]`.
 * That only works while an endpoint returns a bare array. The moment an endpoint
 * switches to the paginated `{ items, total, page, limit }` shape, the
 * `?? []` fallback hands a plain object to `Array.prototype.find`/`map` and the
 * whole screen throws and renders blank -- which is exactly what happened to the
 * partner dashboard ("Recent Jobs" missing) because `GET /partner/bookings`
 * paginates. The chat thread was the quieter version of the same bug: it read
 * `data.data.messages` against a `{ items }` response, so it silently rendered
 * an empty thread rather than crashing.
 *
 * `toList` is now the only sanctioned way to read a list payload, so these
 * assertions fail if a `?? []` cast creeps back into a mobile screen.
 */
const APP = join(__dirname, '../../../mobile/app');
const read = (p: string) => readFileSync(join(APP, p), 'utf8');

const SCREENS: Array<[string, string]> = [
  ['(tabs)/partner.tsx', 'partner jobs + nearby bookings'],
  ['(tabs)/bookings.tsx', 'my bookings'],
  ['(tabs)/index.tsx', 'home dashboard active bookings'],
  ['(tabs)/wallet.tsx', 'wallet transactions'],
  ['(tabs)/messages.tsx', 'conversation list'],
  ['(tabs)/explore.tsx', 'discovery people'],
  ['chat/[conversationId].tsx', 'message history'],
];

describe('mobile list payloads are normalized', () => {
  it.each(SCREENS)('%s reads its list through toList (%s)', (file) => {
    const src = read(file);
    expect(src).toMatch(/toList\(/);
    // The unguarded `?? []` + `as any[]` cast is the exact defect.
    expect(src).not.toMatch(/\?\?\s*\[\]\s*as\s+any\[\]/);
    expect(src).not.toMatch(/as\s+any\[\]/);
  });

  it('normalizes bare arrays, named keys and paginated envelopes alike', () => {
    const api = readFileSync(join(__dirname, '../../../mobile/src/lib/api.ts'), 'utf8');
    expect(api).toMatch(/export function toList/);
    // The keys a paginated `{ items, ... }` or enveloped response can hide
    // behind, probed in order after any key the call site names explicitly.
    for (const key of ['items', 'transactions', 'results', 'data']) {
      expect(api).toContain(`'${key}'`);
    }
    // Named collections the call sites pass through explicitly.
    expect(read('(tabs)/partner.tsx')).toContain("toList(jobsQ.data?.data, 'bookings')");
    expect(read('(tabs)/messages.tsx')).toContain("toList(data?.data, 'conversations')");
    expect(read('(tabs)/explore.tsx')).toContain("toList(data?.data, 'people')");
    expect(read('chat/[conversationId].tsx')).toContain("toList(data?.data, 'messages')");
    expect(read('(tabs)/wallet.tsx')).toContain("toList(txQ.data?.data, 'transactions')");
  });

  it('exports toList from the module every screen already imports', () => {
    for (const [file] of SCREENS) {
      expect(read(file)).toMatch(/import\s*\{[^}]*toList[^}]*\}\s*from\s*'[^']*lib\/api'/);
    }
  });
});
