import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { photoApi, assetUrl, type GalleryPhoto } from '../../lib/api'
import { prepareCover } from '../../lib/photo'
import { getErrorMessage } from '../../lib/error'

const ACCEPT = 'image/*'

/**
 * Gallery photos, beyond the single profile avatar.
 *
 * Dating discovery swipes through this set, so it is deliberately a separate
 * list rather than an extension of the avatar: replacing your avatar should not
 * silently delete photos people can already see on your card.
 */
export function ProfilePhotosCard() {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [max, setMax] = useState(6)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await photoApi.list()
      setPhotos(res.data.data.photos)
      setMax(res.data.data.max)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not load your photos.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onPick = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      if (photos.length >= max) {
        toast.error(`You can show up to ${max} photos.`)
        return
      }
      setUploading(true)
      const toastId = toast.loading('Uploading photo…')
      try {
        // prepareCover keeps the whole frame (no crop): the card uses
        // object-cover, so cropping here would throw away the composition the
        // user chose, which is the opposite of what a gallery is for.
        const { blob, previewUrl } = await prepareCover(file)
        URL.revokeObjectURL(previewUrl)
        await photoApi.upload(blob)
        toast.success('Photo added.', { id: toastId })
        await load()
      } catch (err) {
        toast.error(getErrorMessage(err, 'Upload failed. Please retry.'), { id: toastId })
      } finally {
        setUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [photos.length, max, load],
  )

  const remove = useCallback(async (photo: GalleryPhoto) => {
    if (!window.confirm('Remove this photo? People will stop seeing it on your card.')) return
    setRemovingId(photo.id)
    try {
      await photoApi.remove(photo.id)
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
      toast.success('Photo removed.')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not remove that photo.'))
    } finally {
      setRemovingId(null)
    }
  }, [])

  const full = photos.length >= max

  return (
    <div className="glass-card-static p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="section-title flex items-center gap-2">
          <ImagePlus className="w-5 h-5 text-primary-500" />
          Profile Photos
        </h2>
        <span className="text-xs text-surface-500">
          {photos.length} of {max}
        </span>
      </div>
      <p className="text-xs text-surface-500 mb-4">
        These appear on your dating card, after your profile photo. Tap a card to open it full screen.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-surface-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-square overflow-hidden rounded-xl bg-surface-100 dark:bg-surface-800"
            >
              <img
                src={assetUrl(photo.url) || ''}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => remove(photo)}
                disabled={removingId === photo.id}
                aria-label="Remove photo"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 disabled:opacity-60"
              >
                {removingId === photo.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}

          {!full && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-surface-300 text-surface-500 transition hover:border-primary-400 hover:text-primary-500 disabled:opacity-60 dark:border-surface-700"
            >
              {uploading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ImagePlus className="w-5 h-5" />
              )}
              <span className="text-[11px] font-medium">{uploading ? 'Uploading…' : 'Add photo'}</span>
            </button>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />

      {full && !loading && (
        <p className="mt-3 text-xs text-surface-500">
          You have reached the limit. Remove one to add another.
        </p>
      )}
    </div>
  )
}
