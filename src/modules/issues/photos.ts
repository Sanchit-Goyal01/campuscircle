import sharp from 'sharp';

// Refuses decompression bombs: a tiny file that declares a huge canvas.
const MAX_PIXELS = 40_000_000;

/**
 * Re-encodes an image as a JPEG of at most 2000 px. sharp drops EXIF, GPS and
 * other metadata unless `withMetadata` is called, so the output carries none.
 * `rotate()` applies the EXIF orientation first so the picture stays upright.
 * Throws when the input is not a decodable image.
 */
export async function stripAndEncode(input: Buffer): Promise<Buffer> {
  const { format } = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw new Error('Unsupported image format');
  return sharp(input, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
