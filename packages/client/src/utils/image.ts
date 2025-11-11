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
 * Avatar images do not need to be scaled or compressed; they are directly passed through as Blob.
 */
export async function optimizeAvatarBlob(byte: Uint8Array, mimeType: string, _options: OptimizeOptions = {}): Promise<Blob> {
  const originalBlob = bytesToBlob(byte, mimeType)
  // Only verify decodability
  try {
    const imageBitmap = await createImageBitmap(originalBlob)
    if (!imageBitmap)
      return originalBlob
  }
  catch {
    return originalBlob
  }

  return originalBlob
}
