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
});
