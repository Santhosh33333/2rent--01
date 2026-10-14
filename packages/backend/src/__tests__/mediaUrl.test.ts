import { describe, it, expect } from 'vitest';
import { checkMediaUrl, describeMediaProblem } from '../services/mediaUrl';

// The rules a listening room relies on: our own files are fine, a direct https
// file is fine, and YouTube is refused because playback cannot be synchronised
// across devices — which is the whole point of a room.
describe('checkMediaUrl', () => {
  it('accepts a catalogue track under /audio/', () => {
    const r = checkMediaUrl('/audio/ta/love-song.mp3');
    expect(r).toEqual({ ok: true, kind: 'AUDIO', url: '/audio/ta/love-song.mp3' });
  });

  it('accepts an uploaded video under /uploads/', () => {
    const r = checkMediaUrl('/uploads/videos/party.mp4');
    expect(r).toEqual({ ok: true, kind: 'VIDEO', url: '/uploads/videos/party.mp4' });
  });

  it('accepts a direct https audio file', () => {
    const r = checkMediaUrl('https://cdn.example.com/song.m4a');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('AUDIO');
  });

  it('accepts a direct https video file', () => {
    const r = checkMediaUrl('https://cdn.example.com/clip.webm');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('VIDEO');
  });

  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://music.youtube.com/watch?v=abc',
    'https://www.youtube-nocookie.com/embed/abc',
  ])('refuses YouTube (%s) so a room never promises a sync it cannot keep', (url) => {
    const r = checkMediaUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe('youtube');
  });

  it('refuses plain http', () => {
    const r = checkMediaUrl('http://cdn.example.com/song.mp3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe('not_https');
  });

  it('refuses a data: URI', () => {
    const r = checkMediaUrl('data:audio/mp3;base64,AAAA');
    expect(r.ok).toBe(false);
  });

  it('refuses a root path outside /audio and /uploads', () => {
    const r = checkMediaUrl('/api/secrets.mp3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe('not_media');
  });

  it('refuses an https page that is not a media file', () => {
    const r = checkMediaUrl('https://example.com/page.html');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe('not_media');
  });

  it('refuses empty input', () => {
    const r = checkMediaUrl('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe('empty');
  });

  it('explains a YouTube refusal in a way the host can act on', () => {
    expect(describeMediaProblem('youtube')).toMatch(/YouTube/i);
    expect(describeMediaProblem('youtube')).toMatch(/sync/i);
  });
});
