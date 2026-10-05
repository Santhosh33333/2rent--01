import { describe, expect, it } from 'vitest';
import { listIndianRegions, resolveIndianRegion } from '../services/indiaRegions';
import { msUntilIstMidnight } from '../services/istMidnight';

/**
 * The film catalogue's location answer has to be right in both directions.
 *
 * Getting it wrong is not cosmetic: telling someone in Tamil Nadu they are in
 * West Bengal serves the wrong language's releases as their local list, and
 * telling someone in Dubai they are in Goa is worse than admitting the location
 * is not covered. So both "must match" and "must refuse to guess" are asserted.
 */
describe('resolveIndianRegion', () => {
  it('resolves major film centres to their own state', () => {
    const cases: Array<[string, number, number, string, string]> = [
      ['Chennai', 13.0827, 80.2707, 'TN', 'ta'],
      ['Coimbatore', 11.0168, 76.9558, 'TN', 'ta'],
      ['Kochi', 9.9312, 76.2673, 'KL', 'ml'],
      ['Thiruvananthapuram', 8.5241, 76.9366, 'KL', 'ml'],
      ['Bengaluru', 12.9716, 77.5946, 'KA', 'kn'],
      ['Hyderabad', 17.3850, 78.4867, 'TS', 'te'],
      ['Mumbai', 19.0760, 72.8777, 'MH', 'mr'],
      ['Kolkata', 22.5726, 88.3639, 'WB', 'bn'],
      ['Ahmedabad', 23.0225, 72.5714, 'GJ', 'gu'],
      ['Guwahati', 26.1445, 91.7362, 'AS', 'as'],
    ];
    for (const [label, lat, lng, code, language] of cases) {
      const r = resolveIndianRegion(lat, lng);
      expect(`${label}:${r.code}:${r.languages[0]}`).toBe(`${label}:${code}:${language}`);
    }
  });

  it('still resolves coordinates that are away from any anchor', () => {
    // Nearest-centroid is approximate by design, so the edge of a state has to
    // still land in that state.
    const r = resolveIndianRegion(35.5, 74.5); // far north Kashmir
    expect(r.inRange).toBe(true);
    expect(r.code).toBe('JK');
  });

  it('refuses to guess when the point is outside the coverage area', () => {
    for (const [lat, lng] of [
      [25.2048, 55.2708], // Dubai
      [51.5074, -0.1278], // London
      [1.3521, 103.8198], // Singapore
      [20.0, 63.0], // open sea
    ]) {
      const r = resolveIndianRegion(lat, lng);
      expect(r.inRange).toBe(false);
      expect(r.code).toBe('');
      expect(r.reason).toBeTruthy();
    }
  });

  it('reports no region rather than throwing on unusable coordinates', () => {
    expect(resolveIndianRegion(null, null).inRange).toBe(false);
    expect(resolveIndianRegion(undefined, undefined).inRange).toBe(false);
    expect(resolveIndianRegion(Number.NaN, 80).inRange).toBe(false);
  });

  it('always lists the English fallback last so a query is never wasted', () => {
    const tamil = resolveIndianRegion(13.0827, 80.2707);
    expect(tamil.languages).toContain('en');
    expect(tamil.languages[tamil.languages.length - 1]).toBe('en');
  });
});

describe('listIndianRegions', () => {
  it('covers the states and union territories', () => {
    const regions = listIndianRegions();
    expect(regions.length).toBeGreaterThanOrEqual(30);
    expect(regions.find((r) => r.code === 'TN')?.languages).toContain('ta');
    expect(regions.find((r) => r.code === 'KL')?.languages).toContain('ml');
  });

  it('has no duplicate codes', () => {
    const codes = listIndianRegions().map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('msUntilIstMidnight', () => {
  it('always returns a positive delay inside one day', () => {
    // A zero delay would spin the scheduler as fast as the event loop allows.
    for (let i = 0; i < 5; i++) {
      const ms = msUntilIstMidnight();
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(864e5);
    }
  });

  it('is stable across calls so it does not flicker between values', () => {
    const a = msUntilIstMidnight();
    const b = msUntilIstMidnight();
    expect(Math.abs(a - b)).toBeLessThan(2000);
  });
});