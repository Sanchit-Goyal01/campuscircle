import sharp from 'sharp';

/**
 * Re-encodes an image as a JPEG of at most 2000 px. sharp drops EXIF, GPS and
 * other metadata unless `withMetadata` is called, so the output carries none.
 * `rotate()` applies the EXIF orientation first so the picture stays upright.
 * Throws when the input is not a decodable image.
 */
export function stripAndEncode(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
