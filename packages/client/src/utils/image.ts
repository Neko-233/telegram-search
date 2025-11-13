/**
 * Convert raw bytes and mime type to a Blob.
 * Designed for browser environments where avatar images arrive as Uint8Array.
 */
export function bytesToBlob(byte: Uint8Array, mimeType: string): Blob {
  // Ensure BlobPart is an ArrayBuffer (not ArrayBufferLike) to satisfy TS types.
  // Copy into a fresh ArrayBuffer to avoid offset/length issues.
  const buf = new ArrayBuffer(byte.byteLength)
  const view = new Uint8Array(buf)
  view.set(byte)
  return new Blob([buf], { type: mimeType })
}

export interface OptimizeOptions {
  maxSize?: number
  quality?: number
}

/**
 * Check whether the given avatar bytes are decodable as an image.
 * Returns true if `createImageBitmap` succeeds, false otherwise.
 */
export async function canDecodeAvatar(byte: Uint8Array | undefined, mimeType: string | undefined): Promise<boolean> {
  if (!byte || !mimeType)
    return false
  const blob = bytesToBlob(byte, mimeType)
  try {
    const imageBitmap = await createImageBitmap(blob)
    return !!imageBitmap
  }
  catch {
    return false
  }
}
