import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({
  prisma: {
    community: { findUnique: vi.fn() },
    communityMember: { findUnique: vi.fn() },
    communityPost: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
    communityComment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
  },
}));

import { canRead } from '../controllers/communityPostController';

describe('community read permissions (spec 104-105)', () => {
  it('PUBLIC communities are readable by anyone', () => {
    expect(canRead('PUBLIC', null)).toBe(true);
    expect(canRead('PUBLIC', 'MEMBER')).toBe(true);
  });

  it('PRIVATE communities are members-only', () => {
    expect(canRead('PRIVATE', null)).toBe(false);
    expect(canRead('PRIVATE', 'MEMBER')).toBe(true);
    expect(canRead('PRIVATE', 'OWNER')).toBe(true);
    expect(canRead('PRIVATE', 'MODERATOR')).toBe(true);
  });
});
