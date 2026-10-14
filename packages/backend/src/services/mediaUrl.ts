/**
 * Media-URL rules for the listening/watch rooms.
 *
 * Kept in its own module because two different layers need the exact same
 * decision: the REST controller (when a host picks a track) and the socket
 * control handler (when the host changes it mid-session). Putting the check in
 * one place is what stops the two from drifting.
 *
 * What is allowed, and why:
 *   - Root-relative `/audio/...` — the licensed catalogue the music page already
 *     reads from.
 *   - Root-relative `/uploads/...` — a file uploaded to this app's own storage.
 *   - `https://` with a direct audio/video file extension — a host pointing at a
 *     file they are entitled to share.
 *   - A single YouTube video, normalised to its canonical `watch?v=<id>` URL.
 *     Rooms embed it through YouTube's own player and mirror the host's
 *     play/pause/seek, so playback stays together across devices. A video is
 *     required: a playlist or channel link has no single, deterministic
 *     position to synchronise, so it is refused rather than guessed at.
 *
 * What is refused, and why:
 *   - Plain `http://`, `data:` and `javascript:` — a room's media is fetched by
 *     every member's browser, so a non-https or executable source would be a
 *     mixed-content and XSS vector.
 */

export type MediaKind = "AUDIO" | "VIDEO" | "YOUTUBE";

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|opus|wav|flac)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|m3u8)(\?.*)?$/i;

/** A YouTube video id is exactly eleven URL-safe characters. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** The path shapes YouTube uses to carry a single video id. */
const YOUTUBE_PATH_ID = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Why a URL was refused, so the caller can say something useful. */
export type MediaUrlProblem = "youtube" | "not_https" | "not_media" | "empty";

export type MediaUrlCheck =
  | { ok: true; kind: MediaKind; url: string; videoId?: string }
  | { ok: false; problem: MediaUrlProblem };

/** Root-relative paths the app itself serves media from. */
function isOwnRootPath(url: string): boolean {
  return url.startsWith("/audio/") || url.startsWith("/uploads/");
}

/**
 * The single video id inside a YouTube URL, or null.
 *
 * Handles every spelling a share sheet produces: `watch?v=`, `youtu.be/<id>`,
 * `/embed/<id>`, `/shorts/<id>`, `/live/<id>` and `/v/<id>`. A URL that has no
 * id (a playlist, a channel, a search) returns null, because there is nothing to
 * synchronise.
 */
function youtubeVideoId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase();

  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return id && YOUTUBE_ID.test(id) ? id : null;
  }

  const v = parsed.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;

  const match = parsed.pathname.match(YOUTUBE_PATH_ID);
  return match ? match[1] : null;
}

/** Canonical, embed-friendly URL for a video id. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Classifies and validates a media URL.
 *
 * Returns the media kind when it is usable, or the reason it is not. The caller
 * surfaces the reason — "that's a YouTube playlist" is far more actionable than
 * a generic "invalid media".
 */
export function checkMediaUrl(raw: unknown): MediaUrlCheck {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url) return { ok: false, problem: "empty" };

  // Own files are accepted straight from the root path.
  if (url.startsWith("/")) {
    if (!isOwnRootPath(url)) return { ok: false, problem: "not_media" };
    if (AUDIO_EXT.test(url)) return { ok: true, kind: "AUDIO", url };
    if (VIDEO_EXT.test(url)) return { ok: true, kind: "VIDEO", url };
    return { ok: false, problem: "not_media" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problem: "not_media" };
  }

  if (parsed.protocol !== "https:") return { ok: false, problem: "not_https" };

  if (YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
    const id = youtubeVideoId(parsed);
    // A YouTube link with no single video (playlist, channel, search) has no
    // deterministic position, so it cannot be synced. Say so specifically.
    if (!id) return { ok: false, problem: "youtube" };
    return { ok: true, kind: "YOUTUBE", url: youtubeWatchUrl(id), videoId: id };
  }

  if (AUDIO_EXT.test(url)) return { ok: true, kind: "AUDIO", url };
  if (VIDEO_EXT.test(url)) return { ok: true, kind: "VIDEO", url };
  return { ok: false, problem: "not_media" };
}

/** Human-readable explanation for a refusal. */
export function describeMediaProblem(problem: MediaUrlProblem): string {
  switch (problem) {
    case "youtube":
      return "That YouTube link doesn't point to one video, so it can't be synced. Open the video and copy its link (with a video id).";
    case "not_https":
      return "Media must be an https link.";
    case "not_media":
      return "That doesn't look like an audio or video file. Use a direct .mp3 / .mp4 style link, a YouTube video link, or a file from /audio or /uploads.";
    default:
      return "Add a media link to start the room.";
  }
}
