import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { registerTools, canInvoke, listToolsForRole, type AgentToolDef } from '../agent/toolRegistry'

/**
 * Guards the permission ladder for delegated admin accounts.
 *
 * The registry shipped with `if (isAdminTier) return true` ahead of the roles
 * allowlist. That made the allowlist dead code for exactly the accounts it exists
 * to restrict: a delegated admin holding the STATS section could have reached any
 * future tool declared `roles: ["ADMIN"]`, because their admin tier short-circuited
 * the check before it ran.
 *
 * These tests register throwaway tools so they exercise the real predicate rather
 * than a copy of it, and they clean up so later suites see a fixed registry.
 */

const created: string[] = []

function makeTool(overrides: Partial<AgentToolDef>): AgentToolDef {
  const tool: AgentToolDef = {
    name: `test_tool_${created.length}_${Math.random().toString(36).slice(2, 8)}`,
    description: 'throwaway',
    inputSchema: z.object({}).strict(),
    permission: 'admin',
    category: 'admin',
    confirmationRequired: false,
    handler: async () => ({ ok: true }),
    ...overrides,
  }
  created.push(tool.name)
  registerTools([tool])
  return tool
}

describe('admin tool delegation', () => {
  it('keeps a full admin out of a tool reserved for another role', () => {
    const tool = makeTool({ roles: ['SUPPORT'] })

    expect(canInvoke(tool, 'ADMIN', true)).toBe(false)
    expect(canInvoke(tool, 'SUPPORT', true)).toBe(true)
  })

  it('keeps a delegated admin with no rights to a reserved tool out', () => {
    const tool = makeTool({ roles: ['ADMIN'] })

    // The exact regression: ADMIN tier, but not in the allowlist.
    expect(canInvoke(tool, 'SUPPORT', true)).toBe(false)
    expect(canInvoke(tool, 'ADMIN', true)).toBe(true)
  })

  it('hides a reserved tool from a delegated admin in the schema list', () => {
    const tool = makeTool({ roles: ['ADMIN'] })

    const supportAdminSchemas = listToolsForRole('SUPPORT', true)
    expect(supportAdminSchemas.some((t) => t.name === tool.name)).toBe(false)

    const realAdminSchemas = listToolsForRole('ADMIN', true)
    expect(realAdminSchemas.some((t) => t.name === tool.name)).toBe(true)
  })

  it('leaves tools without an allowlist reachable by admin tier', () => {
    const tool = makeTool({})

    expect(canInvoke(tool, 'SUPPORT', true)).toBe(true)
    expect(canInvoke(tool, 'ADMIN', true)).toBe(true)
  })

  it('still blocks a non-admin caller even when their role is in the allowlist', () => {
    const tool = makeTool({ roles: ['USER', 'SUPPORT'] })

    // The allowlist says "these roles may", never "at any tier". permission
    // "admin" still has to be cleared, so a plain user stays locked out.
    expect(canInvoke(tool, 'USER', false)).toBe(false)
    expect(canInvoke(tool, 'SUPPORT', false)).toBe(false)
    expect(canInvoke(tool, 'USER', true)).toBe(true)
  })

  it('still keeps a plain user below the admin tier', () => {
    const tool = makeTool({ permission: 'admin' })

    expect(canInvoke(tool, 'USER', false)).toBe(false)
    expect(canInvoke(tool, 'PARTNER', false)).toBe(false)
    expect(canInvoke(tool, 'USER', true)).toBe(true)
  })
})