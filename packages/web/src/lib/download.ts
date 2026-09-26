import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * Save a generated file (PDF, CSV, QR image) on web and in the Android app.
 *
 * Why this exists: the usual `URL.createObjectURL(blob)` + `<a download>` trick
 * silently does nothing inside an Android WebView. The WebView has no download
 * manager, so the blob URL is never resolved and the tap appears to do nothing.
 *
 * On native the blob is written to real app storage with the Filesystem plugin
 * and then handed to the system Share sheet, which is the only route that both
 * works under modern scoped storage and lets the user actually choose a
 * destination (Downloads, Drive, email, ...).
 */

function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** Strip characters that are illegal in file names on Android/iOS. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'nabri-download';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read the file data.'));
        return;
      }
      // Strip the "data:<mime>;base64," prefix.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file data.'));
    reader.readAsDataURL(blob);
  })
}

function saveOnWeb(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the download has already started.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function saveOnNative(blob: Blob, fileName: string): Promise<'shared' | 'saved'> {
  const base64 = await blobToBase64(blob);
  const path = `downloads/${fileName}`;
  const written = await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  const canShare = await Share.canShare();
  if (canShare.value) {
    await Share.share({
      title: fileName,
      dialogTitle: 'Save or share',
      url: written.uri,
    });
    return 'shared';
  }
  return 'saved'
}

/**
 * Save a blob. Returns how it was delivered so callers can word their message
 * correctly ("shared" means the user got the system sheet, not a silent save).
 */
export async function saveBlob(
  blob: Blob,
  fileName: string
): Promise<'downloaded' | 'shared' | 'saved'> {
  const name = safeFileName(fileName);

  if (!isNative()) {
    saveOnWeb(blob, name);
    return 'downloaded';
  }

  try {
    return await saveOnNative(blob, name);
  } catch (err) {
    // Filesystem can fail when the cache dir is unavailable; fall back to the
    // WebView path so the user still gets a chance rather than a dead button.
    console.warn('[download] native save failed, falling back to web path', err);
    saveOnWeb(blob, name);
    return 'downloaded';
  }
}

/** Rasterise an SVG element to a PNG blob, for "download QR as image". */
export async function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  const serializer = new XMLSerializer();
  const markup = serializer.serializeToString(svg);
  const width = svg.viewBox.baseVal.width || 176;
  const height = svg.viewBox.baseVal.height || 176;

  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not render the QR image.'));
      img.src = url;
    });

    const scale = 4; // crisp when printed or zoomed
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This device cannot render the QR image.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the QR image.'))),
        'image/png'
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
