import type { ClientRegisterEventHandler } from '.'

import { useBridgeStore } from '../composables/useBridge'
import { useAvatarStore } from '../stores/useAvatar'
import { persistUserAvatar } from '../utils/avatar-cache'
import { bytesToBlob, canDecodeAvatar } from '../utils/image'

/**
 * Register entity-related client event handlers.
 * Maps core events to client stores and performs avatar byte -> blobUrl conversion.
 */
export function registerEntityEventHandlers(
  registerEventHandler: ClientRegisterEventHandler,
) {
  registerEventHandler('entity:me:data', (data) => {
    useBridgeStore().getActiveSession()!.me = data
  })

  // User avatar bytes -> blob url
  registerEventHandler('entity:avatar:data', async (data: { userId: string, byte: Uint8Array | { data: number[] }, mimeType: string, fileId?: string }) => {
    const avatarStore = useAvatarStore()

    let buffer: Uint8Array | undefined
    try {
      if ((data.byte as any)?.data?.length)
        buffer = new Uint8Array((data.byte as any).data)
      else buffer = data.byte as Uint8Array
    }
    catch (error) {
      // Warn-only logging to comply with lint rules
      console.warn('[Avatar] Failed to reconstruct user avatar byte', { userId: data.userId }, error)
    }

    if (!buffer) {
      // Use warn to comply with lint rule: allow only warn/error
      console.warn('[Avatar] Missing byte for user avatar')
      // Clear in-flight flag to avoid repeated sends
      avatarStore.markUserFetchCompleted(data.userId)
      return
    }

    // Decode-check: only set src when image is decodable; otherwise let component fallback
    const decodable = await canDecodeAvatar(buffer, data.mimeType)
    if (!decodable) {
      // Clear in-flight flag even if image is not decodable
      avatarStore.markUserFetchCompleted(data.userId)
      return
    }
    // Convert bytes to Blob directly (optimization step removed)
    const blob = bytesToBlob(buffer, data.mimeType)
    const url = URL.createObjectURL(blob)

    // Persist optimized blob into IndexedDB for cache-first load next time
    try {
      await persistUserAvatar(data.userId, blob, data.mimeType)
    }
    catch (error) {
      // Warn-only logging to comply with lint rules
      console.warn('[Avatar] persistUserAvatar failed', { userId: data.userId }, error)
    }

    avatarStore.setUserAvatar(data.userId, { blobUrl: url, fileId: data.fileId, mimeType: data.mimeType })

    // Clear in-flight flag after successful update
    avatarStore.markUserFetchCompleted(data.userId)

    // console.warn('[Avatar] Updated user avatar', { userId: data.userId, fileId: data.fileId })
  })
}
