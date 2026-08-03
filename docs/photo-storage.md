# Photo storage

Owners upload photos of their units/services; the bot sends them as real WhatsApp images when a
customer asks to see one.

## Where the files live

A **Railway Volume** — persistent disk attached to the backend service. This is storage the stack
already had, which is why it was chosen over adding an object-storage vendor: a B&B with four units
and eight photos each is about 16MB, so a thousand businesses is ~16GB. No new account, no new
credentials, nothing extra to misconfigure.

### One-time setup

1. Railway → the backend service → **Settings → Volumes → Add volume**, mount path `/data`.
2. Set `UPLOADS_DIR=/data/uploads` on that service.

Without `UPLOADS_DIR` pointing at a volume, uploads land on the container's ephemeral filesystem
and disappear on the next deploy. `validateEnv` warns when it isn't set.

## Two consequences, stated plainly

**Single instance.** A volume attaches to one service instance, so the backend can't be scaled
horizontally while this is in use. That constraint already existed — `conversationStore`'s
in-memory cache has the same property — but it is now load-bearing in a second place. If the app is
ever scaled out, both have to move together (object storage + Redis).

**Backups are ours.** A volume is not backed up the way Neon backs up the database. If it is lost,
owners re-upload their photos; nothing else in the product breaks. Worth a periodic copy if the
photo count ever gets large enough that re-uploading is a real burden.

## What happens to an uploaded file

`src/lib/storage.ts`, on every upload:

1. **Re-encoded to JPEG through sharp.** This does three jobs at once — HEIC from an iPhone becomes
   something WhatsApp and browsers can display; EXIF is dropped, which matters because a phone
   photo carries the GPS coordinates of the owner's home; and a file that claims to be an image but
   isn't fails here rather than when a customer asks to see photos.
2. **EXIF orientation applied first** (`.rotate()`), or portrait photos come out sideways once the
   orientation flag is stripped.
3. **Resized so the longest edge is ≤1600px**, without upscaling. A phone photo is 4000px wide;
   WhatsApp re-compresses anyway and nobody views these larger than a phone screen.
4. **Stored under a random filename** in `UPLOADS_DIR/<businessId>/`. Never the uploaded name:
   phones produce colliding names constantly (`IMG_0001.jpg`), and an owner-supplied name is
   attacker-controlled input in a filesystem path.

Limits: 8MB per file, 10 photos per service. WhatsApp itself rejects images over 5MB — the cap is
above that because the stored file is far smaller than the upload after processing.

## Serving

`express.static` at `/uploads`, with immutable year-long caching (a file is never rewritten, only
replaced under a new random name). Public and unauthenticated by necessity: WhatsApp fetches these
URLs from its own servers when the bot sends an image. Nothing sensitive is ever stored here — only
photos the owner intends customers to see — and the filenames are unguessable.

## Deletion

Files are deleted when a photo is removed and when its service is deleted (the service's photo list
is read *before* the row is deleted, or the files are orphaned with nothing pointing at them).

`deleteImageByUrl` re-derives the path and verifies it sits under that business's own folder, so a
tampered URL can't reach another business's files or anywhere else on disk. URLs that aren't ours —
services can also hold links the owner pasted from elsewhere — are ignored rather than treated as
local paths. Covered by tests in `storage.test.ts`.

## Moving to object storage later

The read/write surface is deliberately three functions (`saveImage`, `deleteImageByUrl`,
`publicUrl`). Swapping in S3 or Cloudflare R2 is a change to `storage.ts` and nothing else. The
reason to do it would be horizontal scaling, not cost — R2 would also be roughly free at this
volume.
