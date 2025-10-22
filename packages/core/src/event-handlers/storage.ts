import type { CoreContext } from '../context'
import type { DBRetrievalMessages } from '../models'
import type { CoreDialog } from '../services'
import type { CoreMessage } from '../utils/message'

import { useLogger } from '@guiiai/logg'

import { convertToCoreRetrievalMessages, fetchChats, fetchMessageContextWithPhotos, fetchMessagesWithPhotos, getChatMessagesStats, recordChats, recordMessagesWithMedia, retrieveMessages } from '../models'
import { embedContents } from '../utils/embed'

/**
 * Check if a message has no media attached
 */
function hasNoMedia(message: CoreMessage): boolean {
  return !message.media || message.media.length === 0
}

export function registerStorageEventHandlers(ctx: CoreContext) {
  const { emitter } = ctx
  const logger = useLogger('core:storage:event')

  emitter.on('storage:fetch:messages', async ({ chatId, pagination }) => {
    logger.withFields({ chatId, pagination }).verbose('Fetching messages')
    const messages = (await fetchMessagesWithPhotos(chatId, pagination)).unwrap()
    emitter.emit('storage:messages', { messages })
  })

  emitter.on('storage:fetch:message-context', async ({ chatId, messageId, before = 20, after = 20 }) => {
    const safeBefore = Math.max(0, before)
    const safeAfter = Math.max(0, after)

    logger.withFields({ chatId, messageId, before: safeBefore, after: safeAfter }).verbose('Fetching message context')

    const messages = (await fetchMessageContextWithPhotos({ chatId, messageId, before: safeBefore, after: safeAfter })).unwrap()

    emitter.emit('storage:messages:context', { chatId, messageId, messages })

    // After emitting the initial messages, identify messages that might be missing media
    // and trigger a fetch from Telegram to download them
    // We only fetch messages that have no media in the database, as media is optional
    // The media resolver will check if media already exists before downloading
    const messageIdsToFetch = messages
      .filter(hasNoMedia)
      .map(m => Number.parseInt(m.platformMessageId))
      .filter(id => !Number.isNaN(id))

    if (messageIdsToFetch.length > 0) {
      logger.withFields({ messageIds: messageIdsToFetch.length }).verbose('Fetching messages from Telegram to check for missing media')

      // Fetch these specific messages from Telegram which will download any missing media
      // This is done asynchronously and will update the messages once media is downloaded
      emitter.emit('message:fetch:specific', {
        chatId,
        messageIds: messageIdsToFetch,
      })
    }
  })

  emitter.on('storage:record:messages', async ({ messages }) => {
    logger.withFields({ messages: messages.length }).verbose('Recording messages')
    logger.withFields(
      messages
        .map(m => ({
          ...m,
          vectors: {
            vector1536: m.vectors.vector1536?.length,
            vector1024: m.vectors.vector1024?.length,
            vector768: m.vectors.vector768?.length,
          },
        })),
    ).debug('Recording messages')
    await recordMessagesWithMedia(messages)
  })

  emitter.on('storage:fetch:dialogs', async () => {
    logger.verbose('Fetching dialogs')

    const dbChats = (await fetchChats())?.unwrap()
    const chatsMessageStats = (await getChatMessagesStats())?.unwrap()

    logger.withFields({ dbChatsSize: dbChats.length, chatsMessageStatsSize: chatsMessageStats.length }).verbose('Chat message stats')

    const dialogs = dbChats.map((chat) => {
      const chatMessageStats = chatsMessageStats.find(stats => stats.chat_id === chat.chat_id)
      return {
        id: Number(chat.chat_id),
        name: chat.chat_name,
        type: chat.chat_type,
        messageCount: chatMessageStats?.message_count,
      } satisfies CoreDialog
    })

    emitter.emit('storage:dialogs', { dialogs })
  })

  emitter.on('storage:record:dialogs', async ({ dialogs }) => {
    logger.withFields({
      size: dialogs.length,
      users: dialogs.filter(d => d.type === 'user').length,
      groups: dialogs.filter(d => d.type === 'group').length,
      channels: dialogs.filter(d => d.type === 'channel').length,
    }).verbose('Recording dialogs')

    await recordChats(dialogs)
  })

  emitter.on('storage:search:messages', async (params) => {
    logger.withFields({ params }).verbose('Searching messages')

    if (params.content.length === 0) {
      return
    }

    let dbMessages: DBRetrievalMessages[] = []
    if (params.useVector) {
      let embedding: number[] = []
      const embeddingResult = (await embedContents([params.content])).orUndefined()
      if (embeddingResult)
        embedding = embeddingResult.embeddings[0]

      dbMessages = (await retrieveMessages(params.chatId, { embedding, text: params.content }, params.pagination)).expect('Failed to retrieve messages')
    }
    else {
      dbMessages = (await retrieveMessages(params.chatId, { text: params.content }, params.pagination)).expect('Failed to retrieve messages')
    }

    logger.withFields({ messages: dbMessages.length }).verbose('Retrieved messages')
    logger.withFields(dbMessages).debug('Retrieved messages')

    const coreMessages = convertToCoreRetrievalMessages(dbMessages)

    emitter.emit('storage:search:messages:data', { messages: coreMessages })
  })
}
