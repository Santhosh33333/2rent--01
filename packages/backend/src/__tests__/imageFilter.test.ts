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

import { imageFilter } from '../middleware/upload';

function run(originalname: string, mimetype: string) {
  const file = { originalname, mimetype } as Express.Multer.File;
  let accepted = false;
  let error: Error | null = null;
  imageFilter({} as Express.Request, file, ((err: Error | null, ok?: boolean) => {
    error = err;
    accepted = !!ok;
  }) as multer.FileFilterCallback);
  return { file, accepted, error: error as Error | null };
}

describe('imageFilter', () => {
  it('accepts a normal image name + type', () => {
    expect(run('photo.jpg', 'image/jpeg').accepted).toBe(true);
    expect(run('shot.PNG', 'image/png').accepted).toBe(true);
    expect(run('pic.webp', 'image/webp').accepted).toBe(true);
    expect(run('anim.gif', 'image/gif').accepted).toBe(true);
  });

  it('accepts an image whose MIME is empty/octet-stream (Android picker)', () => {
    // This is the case that used to fail: a valid photo with a good name but a
    // generic MIME from the Capacitor WebView.
    expect(run('IMG_20260101_120000.jpg', 'application/octet-stream').accepted).toBe(true);
    expect(run('IMG_20260101_120000.jpg', '').accepted).toBe(true);
  });

  it('accepts an image whose name lacks an extension but MIME is known', () => {
    const { accepted, error, file } = run('image', 'image/jpeg');
    expect(accepted).toBe(true);
    expect(error).toBeNull();
    // Name is normalised so the stored blob keeps a servable extension.
    expect(file.originalname).toBe('image.jpg');
  });

  it('rejects non-images and unidentifiable uploads', () => {
    expect(run('statement.pdf', 'application/pdf').accepted).toBe(false);
    expect(run('note.exe', 'application/octet-stream').accepted).toBe(false);
    // No image extension and no usable MIME: cannot be trusted as an image.
    expect(run('image', 'application/octet-stream').accepted).toBe(false);
    expect(run('document.txt', 'text/plain').accepted).toBe(false);
  });
});
