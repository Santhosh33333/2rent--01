import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ImagePlus, Video, X } from "lucide-react";
import { postApi } from "../../lib/api";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // backend MAX_FILE_SIZE
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // backend MAX_VIDEO_SIZE

const VISIBILITIES = [
  { key: "PUBLIC", label: "Everyone" },
  { key: "FOLLOWERS", label: "Friends" },
  { key: "PRIVATE", label: "Only me" },
];

type PendingMedia =
  | { kind: "image"; file: File; url: string }
  | { kind: "video"; file: File; url: string };

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const res = (err as { response?: { data?: { message?: string; error?: string } } }).response?.data;
    return res?.message || res?.error || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function NewPostPage() {
  const navigate = useNavigate();
  const postsOn = useFeatureFlag("POSTS", true);

  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [media, setMedia] = useState<PendingMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  if (!postsOn) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold font-display">New post</h1>
        <div className="rounded-3xl border border-dashed border-surface-300 bg-surface-100 p-8 text-center dark:border-surface-700 dark:bg-surface-900">
          <p className="text-xs font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
            Not configured
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-surface-600 dark:text-surface-400">
            Posting is behind the POSTS feature flag and is not switched on for this deployment.
          </p>
        </div>
      </div>
    );
  }

  const pickImage = (file?: File | null) => {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Photos are limited to 5 MB on this build.");
      return;
    }
    if (media?.kind === "image") URL.revokeObjectURL(media.url);
    setMedia({ kind: "image", file, url: URL.createObjectURL(file) });
    setError("");
  };

  const pickVideo = (file?: File | null) => {
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      setError("Videos are limited to 25 MB — keep clips short.");
      return;
    }
    if (media?.kind === "video") URL.revokeObjectURL(media.url);
    setMedia({ kind: "video", file, url: URL.createObjectURL(file) });
    setError("");
  };

  const removeMedia = () => {
    if (media) URL.revokeObjectURL(media.url);
    setMedia(null);
  };

  const publish = async () => {
    const text = content.trim();
    if (!text && !media) {
      setError("Add some text, a photo or a video before publishing.");
      return;
    }
    if (text.length > 2000) {
      setError("Text is limited to 2,000 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let imageUrl: string | null = null;
      let videoUrl: string | null = null;
      if (media?.kind === "video") {
        const up = await postApi.uploadVideo(media.file);
        videoUrl = up.data?.data?.videoUrl ?? null;
      } else if (media?.kind === "image") {
        const up = await postApi.uploadImage(media.file);
        imageUrl = up.data?.data?.imageUrl ?? null;
      }
      const res = await postApi.create({ content: text, imageUrl, videoUrl, visibility });
      if (!res.data?.success) {
        setError(res.data?.message || "Could not publish");
        return;
      }
      navigate("/feed", { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, "Could not publish. Check the video size — max 25 MB."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-display">New post</h1>
        <Link to="/feed" className="text-sm font-medium text-surface-500 hover:text-surface-800 dark:hover:text-surface-200">
          Cancel
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-surface-200 bg-white p-5 shadow-card dark:border-surface-800 dark:bg-surface-900">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={2000}
          placeholder="What's on your mind?"
          rows={5}
          className="w-full resize-none rounded-2xl border border-surface-200 bg-surface-50 p-4 text-[15px] text-surface-900 outline-none placeholder:text-surface-400 focus:border-primary-400 dark:border-surface-700 dark:bg-surface-800 dark:text-white"
        />

        {media ? (
          <div className="relative mt-4 overflow-hidden rounded-2xl bg-black">
            {media.kind === "image" ? (
              <img src={media.url} alt="Selected" className="max-h-80 w-full object-contain" />
            ) : (
              <video src={media.url} controls className="max-h-80 w-full" />
            )}
            <button
              type="button"
              onClick={removeMedia}
              className="absolute right-3 top-3 flex items-center gap-1 rounded-xl bg-black/60 px-3 py-1.5 text-xs font-semibold text-white"
            >
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickImage(e.target.files?.[0])}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => pickVideo(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={busy || media?.kind === "video"}
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center gap-2 rounded-2xl border border-surface-200 px-4 py-2.5 text-sm font-medium text-surface-700 transition hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            <ImagePlus className="h-4 w-4" /> {media?.kind === "image" ? "Change photo" : "Add photo"}
          </button>
          <button
            type="button"
            disabled={busy || media?.kind === "image"}
            onClick={() => videoInputRef.current?.click()}
            className="flex items-center gap-2 rounded-2xl border border-surface-200 px-4 py-2.5 text-sm font-medium text-surface-700 transition hover:bg-surface-100 disabled:opacity-40 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            <Video className="h-4 w-4" /> {media?.kind === "video" ? "Change video" : "Add video"}
          </button>
        </div>

        <p className="mt-2 text-xs text-surface-400">
          Photo max 5 MB · video max 25 MB — one media item per post.
        </p>

        <p className="mt-5 text-sm font-semibold text-surface-700 dark:text-surface-300">Who can see this?</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {VISIBILITIES.map((v) => {
            const active = visibility === v.key;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setVisibility(v.key)}
                className={`rounded-2xl border px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300"
                    : "border-surface-200 text-surface-600 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Link
            to="/feed"
            className="rounded-2xl border border-surface-200 px-5 py-2.5 text-sm font-semibold text-surface-700 transition hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            Cancel
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish()}
            className="rounded-2xl bg-primary-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition hover:bg-primary-600 disabled:opacity-50"
          >
            {busy ? "Publishing…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}