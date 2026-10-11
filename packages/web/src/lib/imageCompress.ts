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
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
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
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
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
