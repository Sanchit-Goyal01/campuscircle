import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { stripAndEncode } from "../../src/modules/issues/photos";

const base = () => sharp({ create: { width: 100, height: 80, channels: 3, background: "#336699" } });

describe("stripAndEncode", () => {
  test("removes EXIF and GPS", async () => {
    const withExif = await base().jpeg().withMetadata({ exif: { IFD0: { Copyright: "secret" } } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await stripAndEncode(withExif);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
    expect(out.toString("latin1")).not.toContain("secret");
  });

  test("shrinks to 2000 px and never enlarges", async () => {
    const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#fff" } }).png().toBuffer();
    expect((await sharp(await stripAndEncode(big)).metadata()).width).toBe(2000);
    const small = await base().png().toBuffer();
    expect((await sharp(await stripAndEncode(small)).metadata()).width).toBe(100);
  });

  test("rejects a non-image buffer", async () => {
    await expect(stripAndEncode(Buffer.from("not an image at all"))).rejects.toThrow();
  });

  test("rejects SVG and GIF content", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(stripAndEncode(svg)).rejects.toThrow();
    const gif = await base().gif().toBuffer();
    await expect(stripAndEncode(gif)).rejects.toThrow();
  });

  test("rejects an image over the pixel limit", async () => {
    const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: "#000" } }).png().toBuffer();
    await expect(stripAndEncode(bomb)).rejects.toThrow();
  });
});
