import type { ClientRegisterEventHandlerFn } from '.'

import { useAvatarStore } from '../stores/useAvatar'
import { useChatStore } from '../stores/useChat'
import { persistChatAvatar } from '../utils/avatar-cache'
import { optimizeAvatarBlob } from '../utils/image'

/**
 * Register dialog-related client event handlers.
 * Handles base dialog data and incremental avatar bytes -> blobUrl conversion.
 */
export function registerDialogEventHandlers(
  registerEventHandler: ClientRegisterEventHandlerFn,
) {
  // Base dialog list
  registerEventHandler('dialog:data', (data) => {
    useChatStore().chats = data.dialogs
  })

  // Incremental avatar updates
  registerEventHandler('dialog:avatar:data', async (data) => {
    const chatStore = useChatStore()
    const avatarStore = useAvatarStore()

    // Reconstruct buffer from JSON-safe payload
    let buffer: Uint8Array | undefined
    try {
      if ((data.byte as any)?.data?.length) buffer = new Uint8Array((data.byte as any).data)
      else buffer = data.byte as Uint8Array
    }
    catch {}

    if (!buffer) {
      // Use warn to comply with lint rule: allow only warn/error
      console.warn('[Avatar] Missing byte for chat avatar')
      return
    }

    // Optimize and create blob URL
    const blob = await optimizeAvatarBlob(buffer, data.mimeType)
    const url = URL.createObjectURL(blob)

    // Persist optimized chat avatar
    try {
      await persistChatAvatar(data.chatId, blob, data.mimeType)
    }
    catch {}

    // Update chat store fields
    const chat = chatStore.chats.find(c => c.id === data.chatId)
    if (chat) {
      chat.avatarBlobUrl = url
      if (data.fileId) chat.avatarFileId = data.fileId
      chat.avatarUpdatedAt = new Date()
    }

    // Populate centralized avatar cache as well
    avatarStore.setChatAvatar(data.chatId, { blobUrl: url, fileId: data.fileId, mimeType: data.mimeType })

    console.warn('[Avatar] Updated chat avatar', { chatId: data.chatId, fileId: data.fileId })
  })
}
