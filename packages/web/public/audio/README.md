# Song audio

This folder is where song files live, and `manifest.json` is what the app reads.

**The folder currently contains no audio.** The manifest is empty on purpose, and
the player shows "No music added yet" rather than a list of tracks that cannot
play. Nothing is listed here that does not exist on disk.

## Adding music

1. Put the file in this folder. Use mp3 (best reach) or m4a/aac.

   ```
   public/audio/ta-love-01.mp3
   ```

2. Add it to `manifest.json`:

   ```json
   {
     "id": "ta-love-01",
     "title": "Real track name",
     "artist": "Real performer",
     "language": "ta",
     "mood": "love",
     "src": "/audio/ta-love-01.mp3",
     "credit": "Name of the licensor",
     "license": "CC BY 4.0"
   }
   ```

3. The player picks it up on the next page load. There is no build step and no
   cache to bust, because the manifest is fetched at runtime.

## Why the manifest is not auto-scanned

A build-time glob would list whatever bytes happen to be in the folder, including
half-finished downloads, and a stray `.DS_Store` or a truncated file would become
a track the player offers and then fails on. An explicit manifest means the app
only ever promises audio that was deliberately published, and every entry carries
the credit and licence that has to travel with it.

## Licensing — read this before adding anything

Audio recordings are copyrighted even when the underlying song is traditional,
public domain, or written by you. A recording you did not make is not free to
host, and "instrumental" does not change that. So each entry needs a `license`
you can actually point at.

Acceptable:

- **Your own recordings.** You wrote it or paid for it and hold the rights.
- **CC0 / public domain.** E.g. Musopen, Free Music Archive entries marked CC0.
- **CC BY** with the credit recorded in `credit`. Share-alike on the audio file
  is fine; it does not reach the code.
- **Licensed stock.** Pixabay, Artlist, Epidemic Sound - check the tier actually
  permits web use and redistribution with the app.

Not acceptable:

- Commercial recordings ripped from films, albums, or streaming services. The
  composition and the master recording are separately owned, so a public-domain
  composition does not make a commercial recording free.
- Anything forwarded from another app or ripped from a video.
- A track you found by searching for "free tamil love song mp3".

Tamil-language material carries extra exposure: a large share of Tamil film music
is actively enforced, and devotional and classical material is often still under
licence even when the tradition is centuries old. Clearance is worth more than the
track.

## Formats

| Field | Note |
|---|---|
| `id` | Unique and stable. Changing it clears that track's shuffle history. |
| `language` | BCP-47 primary subtag only - `ta`, `en`, `hi`. Drives language matching. |
| `mood` | Free-form. `love` is the tag the love-song filter matches. |
| `src` | Root-relative, and must sit under `/audio/`. |

Keep files under ~8 MB each. These stream on mobile data, and a catalogue of
20 MB tracks will be skipped rather than played.
