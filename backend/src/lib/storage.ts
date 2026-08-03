import { mkdir, unlink, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import sharp from "sharp";

/**
 * Storage for owner-uploaded images (unit/service photos).
 *
 * Backed by a Railway Volume — persistent disk attached to the service, which is storage this
 * stack already has. That beats adding an object-storage vendor for the volume of data involved
 * here: a B&B with four units and eight photos each is about 16MB, so a thousand businesses is
 * ~16GB. It also means no new account, no new credentials, and no new thing that can be
 * misconfigured at 2am.
 *
 * Two consequences worth being explicit about:
 *
 * 1. A volume attaches to ONE service instance, so this rules out running several backend
 *    instances. That constraint already exists — conversationStore's in-memory cache has the same
 *    property (see its comment) — so this adds nothing new, but it is now load-bearing in a second
 *    place. If the app is ever scaled horizontally, both have to move at once.
 *
 * 2. Backups are ours. A volume is not backed up the way Neon backs up the database. Losing it
 *    means owners re-upload their photos; nothing else in the product breaks.
 *
 * The read/write surface is deliberately small (save/delete/publicUrl) so swapping in S3 or R2
 * later is a change to this file only.
 */

/** Where uploads live. On Railway this is the volume mount path; locally it's a gitignored dir. */
const UPLOADS_DIR = resolve(process.env.UPLOADS_DIR ?? "./uploads");

/**
 * Public base for serving files back. Must be absolute: WhatsApp fetches these URLs itself.
 *
 * PUBLIC_BACKEND_URL, not APP_URL. Express serves /uploads from THIS process; APP_URL points at the
 * dashboard, which is a different host and has no such route. Building URLs from it produced links
 * that 404'd — broken thumbnails for the owner, and a failed image send for every customer who
 * asked to see a unit.
 */
const PUBLIC_BASE = (process.env.PUBLIC_BACKEND_URL ?? process.env.APP_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** WhatsApp rejects images over 5MB. Reject earlier, with a message the owner can act on. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Longest edge after processing.
 *
 * A phone photo is 3-4MB and 4000px wide. WhatsApp re-compresses anyway, and nobody views these
 * larger than a phone screen, so storing the original wastes disk and makes every send slower for
 * no visible gain.
 */
const MAX_EDGE = 1600;

export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

/** Path on disk for a business's folder. businessId comes from the authenticated session, never
 * from the request body — that is what keeps this from being a path-traversal hole. */
function businessDir(businessId: string): string {
  return join(UPLOADS_DIR, businessId);
}

export interface SavedImage {
  /** Absolute URL, ready to hand to WhatsApp. */
  url: string;
  /** Stored so deletion doesn't have to parse the URL back into a path. */
  key: string;
  bytes: number;
}

/**
 * Normalises and stores one uploaded image.
 *
 * Everything is re-encoded to JPEG through sharp rather than stored as-is. That covers three
 * things at once: HEIC from an iPhone becomes something WhatsApp and browsers can display, EXIF
 * (which carries GPS coordinates from the owner's phone) is dropped, and a file that claims to be
 * an image but isn't fails here rather than when a customer asks to see photos.
 */
export async function saveImage(businessId: string, buffer: Buffer, originalName: string): Promise<SavedImage> {
  let processed: Buffer;
  try {
    processed = await sharp(buffer)
      // withoutEnlargement: a small photo stays its own size instead of being upscaled to blur.
      .rotate() // applies the EXIF orientation before that data is stripped, or portraits come out sideways
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    throw new UnsupportedImageError(`הקובץ "${originalName}" אינו תמונה תקינה או שהפורמט שלו אינו נתמך.`);
  }

  const dir = businessDir(businessId);
  await mkdir(dir, { recursive: true });

  // Random name, not the original: filenames from a phone collide constantly (IMG_0001.jpg), and
  // an owner-supplied name is attacker-controlled input in a filesystem path.
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.jpg`;
  await writeFile(join(dir, name), processed);

  const key = `${businessId}/${name}`;
  return { url: publicUrl(key), key, bytes: processed.length };
}

export function publicUrl(key: string): string {
  return `${PUBLIC_BASE}/uploads/${key}`;
}

/**
 * Re-points a stored upload URL at the current host.
 *
 * Absolute URLs were written into Service.imageUrls at upload time, so every row created while the
 * base was wrong still holds a dead link — and any future domain change would break them the same
 * way. Rewriting on read fixes both without a migration: the path after /uploads/ is the real
 * identifier, the host in front of it is disposable.
 *
 * Only touches URLs that look like our own uploads. A link the owner pasted from their website is
 * left exactly as it is.
 */
export function toPublicUploadUrl(url: string): string {
  const marker = "/uploads/";
  const at = url.indexOf(marker);
  if (at === -1) return url;
  // Guard against rewriting an external URL that merely happens to contain "/uploads/" — ours
  // always have a business-id segment and a generated filename directly after the marker.
  const key = url.slice(at + marker.length);
  if (!/^[\w-]+\/[\w-]+\.jpg$/.test(key)) return url;
  return `${PUBLIC_BASE}${marker}${key}`;
}

/**
 * Deletes a stored image, given the URL held on the Service row.
 *
 * Returns silently for anything that isn't one of our own uploads — services can also hold pasted
 * external URLs, and those must obviously not be treated as local files. The key is re-derived and
 * checked to sit under the business's own folder, so a tampered URL can't reach another business's
 * files or anywhere else on disk.
 */
export async function deleteImageByUrl(businessId: string, url: string): Promise<void> {
  // Matched on the path, not the full URL: rows written before PUBLIC_BASE was corrected carry a
  // different host, and those files still need deleting.
  const marker = "/uploads/";
  const at = url.indexOf(marker);
  if (at === -1) return; // an external URL the owner pasted — not ours to delete

  const key = url.slice(at + marker.length);
  const target = resolve(UPLOADS_DIR, key);
  const allowedDir = resolve(businessDir(businessId));
  if (!target.startsWith(allowedDir + "/")) {
    console.warn(`[storage] Refusing delete outside business dir: ${key}`);
    return;
  }

  await unlink(target).catch((err) => {
    // Already gone is the expected case on a retry, and is not worth failing a request over.
    if (err?.code !== "ENOENT") console.error("[storage] Failed to delete image:", key, err);
  });
}

/**
 * Startup check that the uploads directory is real, writable, and — most importantly — persistent.
 *
 * The failure this exists to catch is silent and slow: if the Railway volume isn't mounted, or is
 * mounted somewhere other than UPLOADS_DIR points at, uploads still succeed. They land on the
 * container's ephemeral disk and vanish on the next deploy. Nobody notices until an owner's photos
 * disappear and the bot starts sending broken images to their customers.
 *
 * A directory that exists but sits outside a mount cannot be distinguished from a mounted one at
 * this level, so this reports the resolved path and lets the log speak: if it doesn't look like
 * the volume's mount path, it isn't the volume.
 */
export async function checkUploadsDir(): Promise<void> {
  const probe = join(UPLOADS_DIR, ".write-probe");
  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(probe, "ok");
    await unlink(probe);
  } catch (err) {
    console.error(`\n✖ Uploads directory is not writable: ${UPLOADS_DIR}`);
    console.error(`  Owner photo uploads will fail. Check the Railway volume mount and UPLOADS_DIR.`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }

  if (!process.env.UPLOADS_DIR) {
    console.warn(
      `\n⚠ UPLOADS_DIR is not set — photos are being written to ${UPLOADS_DIR}, on the container's` +
        `\n  ephemeral disk. They WILL be deleted on the next deploy. Mount a Railway volume and set` +
        `\n  UPLOADS_DIR to its path.\n`
    );
    return;
  }

  console.log(`[storage] Uploads directory ready and writable: ${UPLOADS_DIR}`);
  // The other half of the setup, and the half that fails silently. Photo URLs are absolute and are
  // fetched by WhatsApp's servers and by the owner's browser, so if this base isn't the public
  // address of THIS backend, every photo is a broken image with no error anywhere.
  console.log(`[storage] Photo URLs will be built as: ${publicUrl("<businessId>/<file>.jpg")}`);
  if (!process.env.PUBLIC_BACKEND_URL) {
    console.warn(
      `⚠ PUBLIC_BACKEND_URL is not set — photo URLs fall back to APP_URL, which points at the` +
        ` dashboard. The dashboard does not serve /uploads, so photos will 404.`
    );
  }
  await checkPublicBaseReachable();
}

/**
 * Calls this server's own /health through PUBLIC_BASE, from the outside.
 *
 * Printing the URL wasn't enough: a base can look completely plausible and still be a domain whose
 * DNS no longer points anywhere — which is exactly what happened, and it cost a deploy cycle to
 * find. Photos are the only feature whose URLs leave the building, so nothing else notices, and
 * WhatsApp's failure to fetch an image is invisible on our side.
 *
 * Deliberately not fatal, and deliberately not retried: the server is fine, one feature isn't, and
 * a startup probe that can block a boot on someone else's DNS is worse than the bug it catches.
 */
async function checkPublicBaseReachable(): Promise<void> {
  // Localhost bases in development have nothing listening yet at this point in startup.
  if (PUBLIC_BASE.includes("localhost") || PUBLIC_BASE.includes("127.0.0.1")) return;
  try {
    const res = await fetch(`${PUBLIC_BASE}/health`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      console.log(`[storage] ${PUBLIC_BASE} is reachable — photo URLs will resolve.`);
      return;
    }
    console.error(
      `\n✖ ${PUBLIC_BASE}/health answered ${res.status}. That address does not appear to be this` +
        `\n  backend, so every photo URL will be broken for owners and for WhatsApp.` +
        `\n  Set PUBLIC_BACKEND_URL to this service's real public domain.\n`
    );
  } catch (err) {
    console.error(
      `\n✖ Could not reach ${PUBLIC_BASE}/health (${err instanceof Error ? err.message : String(err)}).` +
        `\n  Photo URLs are built from this address, so every photo will be broken.` +
        `\n  Set PUBLIC_BACKEND_URL to this service's real public domain.\n`
    );
  }
}

/** Mount path for serving uploads back out. Exported so server.ts and this file can't disagree. */
export const UPLOADS_ROUTE = "/uploads";
export const UPLOADS_ROOT = UPLOADS_DIR;
