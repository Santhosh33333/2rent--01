/**
 * Client-side image downscaling for uploads.
 *
 * Kept dependency-free on purpose: it is imported by the shared axios client
 * (`api.ts`), which several modules in turn import, so it must not pull in the
 * api module back and create a cycle.
 */

/**
 * True for a picked file that is worth resizing: an image that is large enough
 * to plausibly blow a server size cap. Small files (already-processed avatars
 * and covers) and non-images are left alone, so this never re-encodes an image
 * that was already prepared.
 *
 * The 1.5 MB floor is deliberately below the 5 MB server cap: anything under it
 * is safe to send as-is, and re-encoding a photo that is already fine only costs
 * quality and time.
 */
export function isLargeUncompressedImage(value: unknown): value is File {
  if (typeof File === 'undefined' || !(value instanceof File)) return false
  if (value.size < 1_500_000) return false;
  const type = value.type || '';
  if (type.startsWith('image/')) {
    // An animated GIF is flattened to a single frame by a canvas, so leave it.
    return value.type !== 'image/gif';
  }
  // Android's document picker sometimes hands back an empty MIME type; fall
  // back to the filename so those large photos are still shrunk.
  return /\.(jpe?g|png|webp|bmp)$/i.test(value.name || '');
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    // A decode that fires neither load nor error (seen with a few HEIC/RAW
    // captures in the Android WebView) would otherwise hang the request
    // interceptor forever, so the upload spinner never resolves and the pick
    // looks like it silently did nothing. Bound the wait.
    const timer = window.setTimeout(() => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('Timed out reading that image.'))
    }, 15000)
    img.onload = () => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image.'))
    }
    img.src = url
  })
}

/**
 * Downscale + JPEG-compress a picked image so it comfortably fits the server's
 * upload cap, returning a `.jpg` File.
 *
 * Never throws: on any failure (undecodable format such as HEIC, a canvas the
 * browser refuses) it returns the original file, so a compression hiccup can
 * never turn a working upload into a hard failure.
 */
export async function compressImageFile(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<File> {
  try {
    const mime = file.type || ''
    const looksLikeImage =
      mime.startsWith('image/') || /\.(jpe?g|png|webp|bmp)$/i.test(file.name || '')
    // Android's document picker sometimes hands back an empty MIME type for a
    // perfectly valid large JPEG. Requiring `image/*` here made those photos
    // skip compression entirely, then bounce off the server's size cap, which
    // is exactly the "image upload does not work" case on a phone.
    if (!looksLikeImage || mime === 'image/gif') return file
    const img = await loadImage(file)
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    if (!longest) return file
    const scale = Math.min(1, maxDim / longest)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!blob) return file
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/** True for a File that is an image by extension but carries no MIME type. */
export function hasUnknownImageType(value: unknown): boolean {
  return (
    typeof File !== 'undefined' &&
    value instanceof File &&
    !value.type &&
    /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(value.name || '')
  )
}

/**
 * Re-label a picked File that lost its MIME type.
 *
 * Android's camera/document picker sometimes returns a real JPEG with an empty
 * `type`. The browser then sends that multipart part as
 * `application/octet-stream`, and any server-side image filter rejects it —
 * which is the "image upload does not work" report on a phone. Re-attach the
 * correct type from the filename so every upload site (KYC, chat, posts,
 * payment proof, covers) accepts it. Non-files and unknown extensions pass
 * through untouched.
 */
export function normalizeImagePart(value: FormDataEntryValue): FormDataEntryValue {
  if (typeof File === 'undefined' || !(value instanceof File)) return value
  if (value.type) return value
  const match = /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.exec(value.name || '')
  if (!match) return value
  const ext = match[1].toLowerCase()
  const type =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'bmp'
            ? 'image/bmp'
            : ext === 'heic' || ext === 'heif'
              ? 'image/heic'
              : 'image/jpeg'
  try {
    return new File([value], value.name, { type, lastModified: value.lastModified })
  } catch {
    return value
  }
}
