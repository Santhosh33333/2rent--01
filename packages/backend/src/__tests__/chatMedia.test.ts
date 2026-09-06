import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({
  prisma: {
    community: { findUnique: vi.fn() },
    communityMember: { findUnique: vi.fn() },
    communityPost: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
    communityComment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
  },
}));

import { classifyChatFile, resolveChatMedia } from '../services/chatUploadService';

describe('chat media helpers (spec 103)', () => {
  it('classifies images', () => {
    expect(classifyChatFile('123e4567-e89b-12d3-a456-426614174000.jpg')).toBe('IMAGE');
    expect(classifyChatFile('123e4567-e89b-12d3-a456-426614174000.png')).toBe('IMAGE');
    expect(classifyChatFile('123e4567-e89b-12d3-a456-426614174000.webp')).toBe('IMAGE');
  });

  it('classifies voice notes', () => {
    expect(classifyChatFile('123e4567-e89b-12d3-a456-426614174000.ogg')).toBe('VOICE');
    expect(classifyChatFile('123e4567-e89b-12d3-a456-426614174000.m4a')).toBe('VOICE');
    expect(classifyChatFile('123e4567-e89b-12d3-a456-426614174000.mp3')).toBe('VOICE');
  });

  it('REJECTS disallowed and malicious filenames', () => {
    expect(classifyChatFile('note.exe')).toBeNull();
    expect(classifyChatFile('note.pdf')).toBeNull();
    expect(resolveChatMedia(null)).toBeNull();
    expect(resolveChatMedia('/uploads/chat/../../etc/passwd')).toBeNull();
    expect(resolveChatMedia('/uploads/private/123e4567-e89b-12d3-a456-426614174000.jpg')).toBeNull();
    expect(resolveChatMedia('/uploads/chat/not-a-uuid.jpg')).toBeNull();
  });
});
