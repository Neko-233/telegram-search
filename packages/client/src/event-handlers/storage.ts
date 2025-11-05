import type { ClientRegisterEventHandler } from '.'

import { useChatStore } from '../stores/useChat'
import { useMessageStore } from '../stores/useMessage'
import { prefillChatAvatarIntoStore } from '../utils/avatar-cache'

export function registerStorageEventHandlers(
  registerEventHandler: ClientRegisterEventHandler,
) {
  registerEventHandler('storage:dialogs', (data) => {
    const chatStore = useChatStore()
    chatStore.chats = data.dialogs
    // Prefill avatars from persistent cache for better initial UX
    Promise.resolve().then(async () => {
      for (const chat of chatStore.chats) {
        await prefillChatAvatarIntoStore(chat.id)
      }
    })
  })

  registerEventHandler('storage:messages', ({ messages }) => {
    useMessageStore().pushMessages(messages)
  })

  // Wait for result event
  registerEventHandler('storage:search:messages:data', (_) => {})
  registerEventHandler('storage:messages:context', (_) => {})
}
