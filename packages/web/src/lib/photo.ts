import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from './api'
import { getErrorMessage } from './error'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const ACCEPTED_EXT = /\.(jpe?g|png|webp|gif)$/i
const MAX_INPUT_BYTES = 12 * 1024 * 1024
const AVATAR_SIZE = 1024

/**
 * The largest pick we will even try to handle.
 *
 * Deliberately generous. A pick between this and the 5 MB server cap is not
 * rejected: the shared axios interceptor downscales it before the request goes
 * out. Refusing at 5 MB instead (as the KYC screens used to) rejected ordinary
 * phone photos that would have uploaded fine after resizing, and the user saw
 * "file too large" for a photo that was never actually too large to send.
 */
export const MAX_RAW_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * Whether a picked file is an image we can upload.
 *
 * Extension-tolerant on purpose, matching the server's own filter: Android's
 * picker routinely hands back a valid JPEG with an empty or generic
 * (`application/octet-stream`) MIME, and a strict `type.startsWith('image/')`
 * check turned those into "please upload an image file" for a perfectly good
 * photo. MIME wins when it is a real image type; otherwise the name decides.
 */
export function isImageFile(file: File): boolean {
  if (/^image\//i.test(file.type || '')) return true
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name || '')
}

/**
 * Android's document/camera picker can return a valid JPEG with an empty MIME
 * type, which the strict `file.type` allow-list rejected before the user even
 * saw a preview ("image upload does not work"). Fall back to the extension.
 */
function looksLikeAcceptedImage(file: File): boolean {
  if (file.type && ACCEPTED_TYPES.includes(file.type)) return true
  // A valid image can still arrive with a generic or stale MIME
  // (`application/octet-stream`, `image/heic`, ...). Android's picker does this
  // routinely, and only trusting `file.type` rejected a perfectly good photo
  // with "Please choose a JPEG, PNG, WebP or GIF image". The extension is the
  // tie-breaker whenever the declared type is not one we accept.
  return ACCEPTED_EXT.test(file.name || '')
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    // Bound the decode: a capture that fires neither load nor error would hang
    // the avatar/cover spinner forever on the Android WebView.
    const timer = window.setTimeout(() => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('Timed out reading that image. Try another file.'))
    }, 15000)
    img.onload = () => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image. Try another file.'))
    }
    img.src = url
  })
}

/**
 * Validate + center-crop square + downscale + JPEG-compress an avatar.
 * Phone photos are routinely 3-8 MB (backend caps at 5 MB); without this
 * every large upload fails with a generic error.
 */
export async function prepareAvatar(file: File): Promise<{ blob: Blob; previewUrl: string }> {
  if (!looksLikeAcceptedImage(file)) {
    throw new Error('Please choose a JPEG, PNG, WebP or GIF image.')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is too large (over 12 MB). Pick a smaller one.')
  }
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (side < 64) throw new Error('That image is too small. Pick a clearer photo.')
  const scale = Math.min(1, AVATAR_SIZE / side)
  const out = Math.round(side * scale)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser cannot process images.')
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('Could not process that image. Try another file.')
  return { blob, previewUrl: URL.createObjectURL(blob) }
}

export async function uploadAvatar(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('photo', blob, 'avatar.jpg')
  const res = await api.post('/users/profile-photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  const avatarUrl = res.data?.data?.avatarUrl as string | undefined
  if (!avatarUrl) throw new Error('Upload finished but no photo URL came back. Please retry.')
  return avatarUrl
}

/** Remove the profile photo. Owners may do this at any time. */
export async function removeAvatar(): Promise<void> {
  await api.delete('/users/profile-photo')
}

const COVER_MAX_W = 1600
const COVER_MAX_BYTES = 8 * 1024 * 1024

/**
 * Landscape cover prep: validate, downscale to max 1600px wide, JPEG.
 * No cropping — the full frame is kept, CSS object-cover handles display.
 */
export async function prepareCover(file: File): Promise<{ blob: Blob; previewUrl: string }> {
  if (!looksLikeAcceptedImage(file)) {
    throw new Error('Please choose a JPEG, PNG, WebP or GIF image.')
  }
  if (file.size > COVER_MAX_BYTES) {
    throw new Error('That image is too large (over 8 MB). Pick a smaller one.')
  }
  const img = await loadImage(file)
  const scale = Math.min(1, COVER_MAX_W / img.naturalWidth)
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser cannot process images.')
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) throw new Error('Could not process that image. Try another file.')
  return { blob, previewUrl: URL.createObjectURL(blob) }
}

interface AvatarUpload {
  previewUrl: string | null
  uploading: boolean
  /** Set while the member is framing a freshly-picked photo. */
  cropFile: File | null
  pick: (file: File | undefined) => Promise<void>
  /** Accept the cropped result from the framing dialog. */
  applyCrop: (blob: Blob) => void
  cancelCrop: () => void
  confirm: () => Promise<string | null>
  cancel: () => void
  /** Clear the stored photo. Resolves false when the server refused. */
  remove: () => Promise<boolean>
}

/**
 * Shared avatar flow: pick -> frame -> preview -> confirm/upload.
 * `onUploaded(avatarUrl)` must persist the URL (updateUser) — the hook
 * never reports fake success: confirm() returns null on any failure.
 * `onRemoved()` runs after the stored photo is cleared.
 */
export function useAvatarUpload(
  onUploaded: (avatarUrl: string) => void,
  onRemoved?: () => void,
): AvatarUpload {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const blobRef = useRef<Blob | null>(null)
  const toastId = useRef<string | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const pick = useCallback(async (file: File | undefined) => {
    if (!file) return
    if (!looksLikeAcceptedImage(file)) {
      toast.error('Please choose a JPEG, PNG, WebP or GIF image.')
      return
    }
    if (file.size > MAX_RAW_UPLOAD_BYTES) {
      toast.error('That image is too large (over 25 MB). Pick a smaller one.')
      return
    }
    // Frame first, render on confirm: the member chooses the crop instead of
    // the old silent centre-crop.
    setCropFile(file)
  }, [])

  const applyCrop = useCallback((blob: Blob) => {
    blobRef.current = blob
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(blob)
    })
    setCropFile(null)
  }, [])

  const cancelCrop = useCallback(() => setCropFile(null), [])

  const cancel = useCallback(() => {
    blobRef.current = null
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [])

  const confirm = useCallback(async () => {
    const blob = blobRef.current
    if (!blob) return null
    setUploading(true)
    toastId.current = toast.loading('Uploading photo…')
    try {
      const avatarUrl = await uploadAvatar(blob)
      onUploaded(avatarUrl)
      toast.success('Photo updated!', { id: toastId.current })
      cancel()
      return avatarUrl
    } catch (err) {
      toast.error(getErrorMessage(err, 'Upload failed. Please retry.'), {
        id: toastId.current,
      })
      return null
    } finally {
      setUploading(false)
    }
  }, [onUploaded, cancel])

  const remove = useCallback(async () => {
    setUploading(true)
    toastId.current = toast.loading('Removing photo…')
    try {
      await removeAvatar()
      onRemoved?.()
      toast.success('Photo removed.', { id: toastId.current })
      return true
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not remove your photo.'), {
        id: toastId.current,
      })
      return false
    } finally {
      setUploading(false)
    }
  }, [onRemoved])

  return { previewUrl, uploading, cropFile, pick, applyCrop, cancelCrop, confirm, cancel, remove }
}
