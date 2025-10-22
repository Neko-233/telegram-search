import type { CorePagination } from '@tg-search/common'

import type { CoreContext } from '../context'
import type { CoreMessage } from '../utils/message'

import { useLogger } from '@guiiai/logg'
import { Err, Ok } from '@unbird/result'
import { Api } from 'telegram'

export interface MessageEventToCore {
  'message:fetch': (data: FetchMessageOpts) => void
  'message:fetch:abort': (data: { taskId: string }) => void
  'message:fetch:specific': (data: { chatId: string, messageIds: number[] }) => void
  'message:send': (data: { chatId: string, content: string }) => void
}

export interface MessageEventFromCore {
  'message:fetch:progress': (data: { taskId: string, progress: number }) => void
  'message:data': (data: { messages: CoreMessage[] }) => void
}

export type MessageEvent = MessageEventFromCore & MessageEventToCore

export interface FetchMessageOpts {
  chatId: string
  pagination: CorePagination

  startTime?: Date
  endTime?: Date

  // Filter
  skipMedia?: boolean
  messageTypes?: string[]

  // Incremental export
  minId?: number
  maxId?: number
}

export type MessageService = ReturnType<typeof createMessageService>

export function createMessageService(ctx: CoreContext) {
  const logger = useLogger('core:message:service')

  const { getClient, withError } = ctx

  async function* fetchMessages(
    chatId: string,
    options: Omit<FetchMessageOpts, 'chatId'>,
  ): AsyncGenerator<Api.Message> {
    if (!await getClient().isUserAuthorized()) {
      logger.error('User not authorized')
      return
    }

    const limit = options.pagination.limit
    const minId = options?.minId
    const maxId = options?.maxId

    logger.withFields({
      chatId,
      limit,
      minId,
      maxId,
    }).verbose('Fetch messages options')

    try {
      logger.withFields({ limit }).debug('Fetching messages from Telegram server')
      const messages = await getClient()
        .getMessages(chatId, {
          limit,
          minId,
          maxId,
          addOffset: options.pagination.offset, // TODO: rename this
        })

      if (messages.length === 0) {
        logger.error('Get messages failed or returned empty data')
        return Err(new Error('Get messages failed or returned empty data'))
      }

      for (const message of messages) {
        // Skip empty messages
        if (message instanceof Api.MessageEmpty) {
          continue
        }

        yield message
      }
    }
    catch (error) {
      return Err(withError(error, 'Fetch messages failed'))
    }
  }

  async function sendMessage(chatId: string, content: string) {
    const message = await getClient()
      .invoke(new Api.messages.SendMessage({
        peer: chatId,
        message: content,
      }))

    return Ok(message)
  }

  async function fetchSpecificMessages(chatId: string, messageIds: number[]): Promise<Api.Message[]> {
    if (!await getClient().isUserAuthorized()) {
      logger.error('User not authorized')
      return []
    }

    if (messageIds.length === 0) {
      return []
    }

    try {
      logger.withFields({ chatId, messageIds: messageIds.length }).debug('Fetching specific messages from Telegram')

      // Telegram API getMessages can accept an array of message IDs
      const messages = await getClient().getMessages(chatId, {
        ids: messageIds,
      })

      // Filter out empty messages
      return messages.filter(message => !(message instanceof Api.MessageEmpty))
    }
    catch (error) {
      logger.withError(withError(error, 'Fetch specific messages failed') as Error).error('Failed to fetch specific messages')
      return []
    }
  }

  return {
    fetchMessages,
    sendMessage,
    fetchSpecificMessages,
  }
}
