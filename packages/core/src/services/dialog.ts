/* eslint-disable unicorn/prefer-node-protocol */
import type { Result } from '@unbird/result'
import type { Dialog } from 'telegram/tl/custom/dialog'

import type { CoreContext } from '../context'
import type { CoreDialog, DialogType } from '../types/dialog'

import { Buffer } from 'buffer'

import { useLogger } from '@guiiai/logg'
import { circularObject } from '@tg-search/common'
import { Err, Ok } from '@unbird/result'
import { Api } from 'telegram'

export type DialogService = ReturnType<typeof createDialogService>

export function createDialogService(ctx: CoreContext) {
  const { getClient, emitter } = ctx

  const logger = useLogger('core:dialog')

  /**
   * In-memory avatar cache keyed by `chatId`.
   * Stores last `fileId`, `mimeType`, and raw `byte` to avoid redundant downloads.
   * Note: `byte` uses Node.js `Buffer` to ensure JSON serialization over WebSocket.
   */
  const avatarCache = new Map<number, {
    fileId?: string
    mimeType?: string
    byte?: Buffer
    updatedAt?: number
  }>()

  /**
   * Convert a Telegram `Dialog` to minimal `CoreDialog` data.
   * Includes avatar metadata where available (no bytes).
   *
   * @returns Ok result with normalized dialog fields or Err on unknown dialog.
   */
  function resolveDialog(dialog: Dialog): Result<{
    id: number
    name: string
    type: DialogType
    avatarFileId?: string
    avatarUpdatedAt?: Date
  }> {
    const { isGroup, isChannel, isUser } = dialog
    let type: DialogType
    if (isGroup) {
      type = 'group'
    }
    else if (isChannel) {
      type = 'channel'
    }
    else if (isUser) {
      type = 'user'
    }
    else {
      logger.withFields({ dialog: circularObject(dialog) }).warn('Unknown dialog')
      return Err('Unknown dialog')
    }

    const id = dialog.entity?.id
    if (!id) {
      logger.withFields({ dialog: circularObject(dialog) }).warn('Unknown dialog with no id')
      return Err('Unknown dialog with no id')
    }

    let { name } = dialog
    if (!name) {
      name = id.toString()
    }

    // Extract avatar fileId if possible for cache hinting
    let avatarFileId: string | undefined
    try {
      if (dialog.entity instanceof Api.User && dialog.entity.photo && 'photoId' in dialog.entity.photo) {
        avatarFileId = (dialog.entity.photo as Api.UserProfilePhoto).photoId?.toString()
      }
      else if ((dialog.entity instanceof Api.Chat || dialog.entity instanceof Api.Channel) && dialog.entity.photo && 'photoId' in dialog.entity.photo) {
        avatarFileId = (dialog.entity.photo as Api.ChatPhoto).photoId?.toString()
      }
    }
    catch {}

    return Ok({
      id: id.toJSNumber(),
      name,
      type,
      avatarFileId,
      avatarUpdatedAt: undefined,
    })
  }

  /**
   * Fetch dialogs and emit base data. Then asynchronously fetch avatars.
   *
   * This emits `dialog:data` with the list of dialogs immediately.
   * Avatar bytes are downloaded in the background via `fetchDialogAvatars`.
   */
  async function fetchDialogs(): Promise<Result<CoreDialog[]>> {
    // TODO: use invoke api
    // TODO: use pagination
    // Total list has a total property
    const dialogList = await getClient().getDialogs()
    // const dialogs = await getClient().invoke(new Api.messages.GetDialogs({})) as Api.messages.Dialogs

    const dialogs: CoreDialog[] = []
    for (const dialog of dialogList) {
      if (!dialog.entity) {
        continue
      }

      const result = resolveDialog(dialog).orUndefined()
      if (!result) {
        continue
      }

      let messageCount = 0
      let lastMessage: string | undefined
      let lastMessageDate: Date | undefined
      const unreadCount = dialog.unreadCount

      if ('participantsCount' in dialog.entity) {
        messageCount = dialog.entity.participantsCount || 0
      }

      if (dialog.message) {
        lastMessage = dialog.message.message
        lastMessageDate = new Date(dialog.message.date * 1000)
      }

      dialogs.push({
        id: result.id,
        name: result.name,
        type: result.type,
        unreadCount,
        messageCount,
        lastMessage,
        lastMessageDate,
        avatarFileId: result.avatarFileId,
        avatarUpdatedAt: result.avatarUpdatedAt,
      })
    }

    useLogger().withFields({ count: dialogs.length }).verbose('Fetched dialogs')

    emitter.emit('dialog:data', { dialogs })

    // Kick off avatar download in background
    void fetchDialogAvatars(dialogList).catch(error => logger.withError(error).warn('Failed to fetch dialog avatars'))

    return Ok(dialogs)
  }

  /**
   * Download small avatars for each dialog with caching and emit incremental events.
   * Emits `dialog:avatar:data` per chat with raw bytes and mime type.
   *
   * Implementation detail: use Node.js `Buffer` as the emitted `byte` so that
   * it serializes to `{ type: 'Buffer', data: number[] }` over JSON. This ensures
   * the frontend can reconstruct a `Uint8Array` for blob creation reliably.
   */
  async function fetchDialogAvatars(dialogList: Dialog[]) {
    const CONCURRENCY = 8
    const total = dialogList.length
    let index = 0

    async function worker() {
      while (index < total) {
        const dialog = dialogList[index++]
        if (!dialog)
          return

        try {
          if (!dialog.entity)
            continue

          const id = dialog.entity.id?.toJSNumber?.() ?? undefined
          if (!id)
            continue

          // Discover fileId for caching
          let fileId: string | undefined
          try {
            if (dialog.entity instanceof Api.User && dialog.entity.photo && 'photoId' in dialog.entity.photo) {
              fileId = (dialog.entity.photo as Api.UserProfilePhoto).photoId?.toString()
            }
            else if ((dialog.entity instanceof Api.Chat || dialog.entity instanceof Api.Channel) && dialog.entity.photo && 'photoId' in dialog.entity.photo) {
              fileId = (dialog.entity.photo as Api.ChatPhoto).photoId?.toString()
            }
          }
          catch {}

          const cached = avatarCache.get(id)
          if (cached && cached.fileId && fileId && cached.fileId === fileId) {
            logger.withFields({ chatId: id }).verbose('Avatar cache hit')
            if (cached.byte && cached.mimeType) {
              emitter.emit('dialog:avatar:data', { chatId: id, byte: cached.byte, mimeType: cached.mimeType, fileId })
            }
            continue
          }

          // Attempt download: small profile photo
          let buffer: Buffer | Uint8Array | undefined
          try {
            buffer = await getClient().downloadProfilePhoto(dialog.entity, { isBig: false }) as Buffer
          }
          catch (err) {
            logger.withError(err as Error).debug('downloadProfilePhoto failed, trying fallback')
            const photo = (dialog.entity as any).photo
            if (photo) {
              try {
                buffer = await getClient().downloadMedia(photo, { thumb: -1 }) as Buffer
              }
              catch (err2) {
                logger.withError(err2 as Error).debug('downloadMedia fallback failed')
              }
            }
          }

          if (!buffer) {
            logger.withFields({ chatId: id }).verbose('No avatar available for dialog')
            continue
          }

          // Ensure the emitted byte is a Buffer so JSON.stringify produces { type: 'Buffer', data: number[] }
          const byte: Buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
          const mimeType = 'image/jpeg'

          avatarCache.set(id, { fileId, mimeType, byte, updatedAt: Date.now() })
          emitter.emit('dialog:avatar:data', { chatId: id, byte, mimeType, fileId })
        }
        catch (error) {
          logger.withError(error as Error).warn('Failed to fetch avatar for dialog')
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker())
    await Promise.allSettled(workers)
  }

  return {
    fetchDialogs,
    fetchDialogAvatars,
  }
}
