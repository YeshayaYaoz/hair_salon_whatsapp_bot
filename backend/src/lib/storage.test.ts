import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import sharp from "sharp";

let dir: string;

/** The module reads UPLOADS_DIR and APP_URL at import time, so each test imports it fresh. */
async function loadStorage() {
  vi.resetModules();
  process.env.UPLOADS_DIR = dir;
  process.env.APP_URL = "https://api.example.com";
  return import("./storage.js");
}

/** A real 3000x2000 PNG, so the resize and re-encode paths are actually exercised. */
async function samplePng(width = 3000, height = 2000): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 160 } } })
    .png()
    .toBuffer();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tori-uploads-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("saveImage", () => {
  it("stores the file under the business's own folder and returns an absolute URL", async () => {
    const { saveImage } = await loadStorage();
    const saved = await saveImage("biz1", await samplePng(), "IMG_0001.png");

    expect(saved.url).toMatch(/^https:\/\/api\.example\.com\/uploads\/biz1\/[a-z0-9-]+\.jpg$/);
    expect(saved.key.startsWith("biz1/")).toBe(true);
    expect(existsSync(join(dir, saved.key))).toBe(true);
  });

  it("shrinks a phone-sized photo down to the display cap", async () => {
    const { saveImage } = await loadStorage();
    const saved = await saveImage("biz1", await samplePng(4032, 3024), "big.png");
    const meta = await sharp(join(dir, saved.key)).metadata();

    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1600);
    // Aspect ratio has to survive, or units look stretched in the customer's chat.
    expect(meta.width! / meta.height!).toBeCloseTo(4032 / 3024, 1);
  });

  it("does not upscale a photo that is already small", async () => {
    const { saveImage } = await loadStorage();
    const saved = await saveImage("biz1", await samplePng(400, 300), "small.png");
    const meta = await sharp(join(dir, saved.key)).metadata();
    expect(meta.width).toBe(400);
  });

  it("re-encodes everything to JPEG, which is what strips the phone's GPS EXIF", async () => {
    const { saveImage } = await loadStorage();
    const saved = await saveImage("biz1", await samplePng(), "photo.png");
    const meta = await sharp(join(dir, saved.key)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("never reuses the uploaded filename", async () => {
    const { saveImage } = await loadStorage();
    const a = await saveImage("biz1", await samplePng(100, 100), "IMG_0001.png");
    const b = await saveImage("biz1", await samplePng(100, 100), "IMG_0001.png");
    // Phones produce colliding names constantly, and the name is attacker-controlled input.
    expect(a.key).not.toBe(b.key);
    expect(a.key).not.toContain("IMG_0001");
  });

  it("rejects a file that isn't an image instead of storing it", async () => {
    const { saveImage, UnsupportedImageError } = await loadStorage();
    await expect(saveImage("biz1", Buffer.from("not an image at all"), "evil.jpg")).rejects.toBeInstanceOf(
      UnsupportedImageError
    );
  });

  it("keeps businesses in separate folders", async () => {
    const { saveImage } = await loadStorage();
    const a = await saveImage("biz1", await samplePng(100, 100), "a.png");
    const b = await saveImage("biz2", await samplePng(100, 100), "b.png");
    expect(a.key.split("/")[0]).toBe("biz1");
    expect(b.key.split("/")[0]).toBe("biz2");
  });
});

describe("deleteImageByUrl", () => {
  it("deletes a file this app stored", async () => {
    const { saveImage, deleteImageByUrl } = await loadStorage();
    const saved = await saveImage("biz1", await samplePng(100, 100), "a.png");
    await deleteImageByUrl("biz1", saved.url);
    expect(existsSync(join(dir, saved.key))).toBe(false);
  });

  it("ignores external URLs — services can hold pasted links we don't own", async () => {
    const { deleteImageByUrl } = await loadStorage();
    await expect(deleteImageByUrl("biz1", "https://someone-elses-site.com/photo.jpg")).resolves.toBeUndefined();
  });

  it("refuses to delete another business's file", async () => {
    const { saveImage, deleteImageByUrl } = await loadStorage();
    const victim = await saveImage("biz2", await samplePng(100, 100), "a.png");
    // biz1 asking to delete a URL that resolves into biz2's folder.
    await deleteImageByUrl("biz1", victim.url);
    expect(existsSync(join(dir, victim.key))).toBe(true);
  });

  it("refuses a traversal escape out of the uploads root", async () => {
    const { deleteImageByUrl } = await loadStorage();
    const outside = join(dir, "outside.txt");
    writeFileSync(outside, "keep me");
    mkdirSync(join(dir, "biz1"), { recursive: true });

    await deleteImageByUrl("biz1", "https://api.example.com/uploads/biz1/../outside.txt");
    expect(existsSync(outside)).toBe(true);
  });

  it("is a no-op for a file that's already gone", async () => {
    const { deleteImageByUrl } = await loadStorage();
    await expect(
      deleteImageByUrl("biz1", "https://api.example.com/uploads/biz1/never-existed.jpg")
    ).resolves.toBeUndefined();
  });
});
