import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from './api'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_INPUT_BYTES = 12 * 1024 * 1024
const AVATAR_SIZE = 1024

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
  if (!ACCEPTED_TYPES.includes(file.type)) {
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

interface AvatarUpload {
  previewUrl: string | null
  uploading: boolean
  pick: (file: File | undefined) => Promise<void>
  confirm: () => Promise<string | null>
  cancel: () => void
}

/**
 * Shared avatar flow: pick -> validate/process -> preview -> confirm/upload.
 * `onUploaded(avatarUrl)` must persist the URL (updateUser) — the hook
 * never reports fake success: confirm() returns null on any failure.
 */
export function useAvatarUpload(onUploaded: (avatarUrl: string) => void): AvatarUpload {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
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
    try {
      const { blob, previewUrl: url } = await prepareAvatar(file)
      blobRef.current = blob
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not use that photo.')
    }
  }, [])

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
      toast.error(err instanceof Error ? err.message : 'Upload failed — tap to retry.', {
        id: toastId.current,
      })
      return null
    } finally {
      setUploading(false)
    }
  }, [onUploaded, cancel])

  return { previewUrl, uploading, pick, confirm, cancel }
}
