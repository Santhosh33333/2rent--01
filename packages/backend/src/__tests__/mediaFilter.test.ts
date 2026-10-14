import { describe, it, expect, vi } from 'vitest';
import multer from 'multer';

// Establish a minimal environment before importing anything that pulls in
// config/env (which validates and refuses to load without the required vars).
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_32chars_minimum!';
  process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_32chars_minimum!';
});

// upload.ts builds its multer storage from blobStorageEngine -> prisma-backed
// blobStorage. The filter under test never touches storage, so stub it out to
// keep this a pure unit test.
vi.mock('../middleware/blobUpload', () => ({
  blobStorageEngine: () => ({}),
}));

import { mediaFilter } from '../middleware/upload';

function run(originalname: string, mimetype: string) {
  const file = { originalname, mimetype } as Express.Multer.File;
  let accepted = false;
  let error: Error | null = null;
  mediaFilter({} as Express.Request, file, ((err: Error | null, ok?: boolean) => {
    error = err;
    accepted = !!ok;
  }) as multer.FileFilterCallback);
  return { file, accepted, error: error as Error | null };
}

describe('mediaFilter', () => {
  it('accepts audio by extension', () => {
    for (const name of ['song.mp3', 'track.m4a', 'voice.ogg', 'solo.flac', 'mix.wav', 'clip.opus', 'tone.aac']) {
      const { accepted, error } = run(name, 'application/octet-stream');
      expect(error, name).toBeNull();
      expect(accepted, name).toBe(true);
    }
  });

  it('accepts video by extension', () => {
    for (const name of ['movie.mp4', 'clip.webm', 'recording.mov', 'short.m4v']) {
      const { accepted, error } = run(name, '');
      expect(error, name).toBeNull();
      expect(accepted, name).toBe(true);
    }
  });

  it('accepts by MIME when Android hands back a generic name, and normalises it', () => {
    const audio = run('audio', 'audio/mpeg');
    expect(audio.accepted).toBe(true);
    expect(audio.file.originalname).toBe('audio.mp3');

    const video = run('media', 'video/mp4');
    expect(video.accepted).toBe(true);
    expect(video.file.originalname).toBe('media.mp4');
  });

  it('rejects a non-media file', () => {
    const { accepted, error } = run('notes.txt', 'text/plain');
    expect(accepted).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/audio or video/i);
  });

  it('rejects an executable disguised with an audio-looking prefix', () => {
    // Anchoring matters: an un-anchored match would green-light this.
    const { accepted } = run('song.mp3.exe', 'application/octet-stream');
    expect(accepted).toBe(false);
  });
});
