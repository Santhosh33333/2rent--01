import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression tests for partner proximity.
 *
 * The radius filter previously kept partners whose coordinates were null, so a
 * "partners near me" search could return someone at an unknown distance with
 * nearestKm: null. That presents an unverified distance as a real one, so those
 * partners are now excluded from the results and counted separately.
 */

const partnerFindMany = vi.fn()

vi.mock('../config/database', () => ({
  prisma: {
    partner: {
      findMany: (...args: unknown[]) => partnerFindMany(...args),
    },
  },
}))

import { listTools } from '../agent/toolRegistry'
import { runAgentTool } from '../agent/toolRouter'
import '../agent/tools/userTools' // registers the read-only user tools on import
import type { AgentToolContext } from '../agent/toolRegistry'

/** 1 degree of latitude is roughly 111 km, so these offsets give predictable distances. */
const CHENNAI = { latitude: 13.0827, longitude: 80.2707 }

function ctx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    userId: 'user-1',
    role: 'USER',
    accountRole: 'USER',
    isAdminTier: false,
    sessionId: 'sess-1',
    location: CHENNAI,
    ...overrides,
  }
}

/** Shape matches the tool's `select`, including the nested owner relation. */
function partner(overrides: Record<string, unknown>) {
  return {
    id: 'p1',
    latitude: null as number | null,
    longitude: null as number | null,
    rating: 4.5,
    averageRating: 4.5,
    completedJobs: 0,
    providesWalking: true,
    providesCarry: false,
    user: { id: 'u1', fullName: 'Partner', city: 'Chennai' },
    ...overrides,
  }
}

interface SearchResult {
  totalFound: number
  radiusKm: number | null
  nearestKm: number | null
  excludedForMissingLocation?: number
  partners: Array<{ id: string }>
}

async function search(args: Record<string, unknown>, context = ctx()) {
  const outcome = await runAgentTool(context, { toolName: 'search_partners', args })
  expect(outcome.status).toBe('success')
  if (outcome.status !== 'success') throw new Error('expected success')
  return outcome.data as SearchResult
}

describe('search_partners proximity', () => {
  beforeEach(() => {
    partnerFindMany.mockReset()
  })

  it('is registered as a user tool', () => {
    expect(listTools().some((t) => t.name === 'search_partners')).toBe(true)
  })

  it('excludes partners with no stored coordinates from a radius search', async () => {
    partnerFindMany.mockResolvedValue([
      partner({ id: 'close', latitude: 13.09, longitude: 80.27 }),
      partner({ id: 'no-coords', latitude: null, longitude: null }),
    ])

    const result = await search({ radiusKm: 10 })

    expect(result.partners.map((p) => p.id)).toEqual(['close'])
    expect(result.totalFound).toBe(1)
    // Withheld but reported, so the reply can be honest rather than silently short.
    expect(result.excludedForMissingLocation).toBe(1)
  })

  it('excludes a partner with only one coordinate populated', async () => {
    // A half-populated pair cannot be projected, so it counts as unknown.
    partnerFindMany.mockResolvedValue([
      partner({ id: 'half', latitude: 13.09, longitude: null }),
    ])

    const result = await search({ radiusKm: 10 })

    expect(result.totalFound).toBe(0)
    expect(result.nearestKm).toBeNull()
    expect(result.excludedForMissingLocation).toBe(1)
  })

  it('excludes partners beyond the requested radius', async () => {
    partnerFindMany.mockResolvedValue([
      partner({ id: 'near', latitude: 13.09, longitude: 80.27 }),
      partner({ id: 'far', latitude: 15.0, longitude: 80.27 }), // ~213 km away
    ])

    const result = await search({ radiusKm: 10 })

    expect(result.partners.map((p) => p.id)).toEqual(['near'])
    expect(result.nearestKm).toBeGreaterThan(0)
    expect(result.nearestKm).toBeLessThan(10)
  })

  it('reports no radius and no nearest distance when searching by city', async () => {
    partnerFindMany.mockResolvedValue([partner({ id: 'anywhere' })])

    const result = await search({ city: 'Chennai' }, ctx({ location: undefined }))

    // A city match has no verified distance, so none is claimed.
    expect(result.radiusKm).toBeNull()
    expect(result.nearestKm).toBeNull()
    expect(result.totalFound).toBe(1)
  })

  it('asks for location instead of guessing when no city and no position are available', async () => {
    const outcome = await runAgentTool(ctx({ location: undefined }), {
      toolName: 'search_partners',
      args: {},
    })

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') throw new Error('expected failed')
    expect(outcome.code).toBe('LOCATION_REQUIRED')
    expect(partnerFindMany).not.toHaveBeenCalled()
  })
})