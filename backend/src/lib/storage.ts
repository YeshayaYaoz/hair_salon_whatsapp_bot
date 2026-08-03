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

/** Public base for serving files back. Must be absolute: WhatsApp fetches these URLs itself. */
const PUBLIC_BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

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
 * Deletes a stored image, given the URL held on the Service row.
 *
 * Returns silently for anything that isn't one of our own uploads — services can also hold pasted
 * external URLs, and those must obviously not be treated as local files. The key is re-derived and
 * checked to sit under the business's own folder, so a tampered URL can't reach another business's
 * files or anywhere else on disk.
 */
export async function deleteImageByUrl(businessId: string, url: string): Promise<void> {
  const prefix = `${PUBLIC_BASE}/uploads/`;
  if (!url.startsWith(prefix)) return; // an external URL the owner pasted — not ours to delete

  const key = url.slice(prefix.length);
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

/** Mount path for serving uploads back out. Exported so server.ts and this file can't disagree. */
export const UPLOADS_ROUTE = "/uploads";
export const UPLOADS_ROOT = UPLOADS_DIR;
