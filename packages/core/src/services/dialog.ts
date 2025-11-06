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
   * In-memory map of dialog entities keyed by `chatId`.
   * Helps resolve a single dialog entity quickly for prioritized avatar fetching.
   */
  const dialogEntities = new Map<number, Api.User | Api.Chat | Api.Channel>()

  /**
   * Track in-flight prioritized single avatar fetches per service instance.
   * Prevents duplicate downloads for the same `chatId` concurrently.
   */
  const inflightSingles = new Set<number>()

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

      // Cache entity for prioritized single fetch later
      try {
        const id = dialog.entity.id?.toJSNumber?.()
        if (id)
          dialogEntities.set(id, dialog.entity as Api.User | Api.Chat | Api.Channel)
      }
      catch {}

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
   * Notes on optimization:
   * - When the avatar `fileId` has NOT changed and an in-memory cache entry exists,
   *   we SKIP emitting `dialog:avatar:data` to avoid redundant updates.
   * - Only when cache is missing or `fileId` differs do we download and emit.
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
          // Optimization: if cache exists and fileId unchanged, skip emitting to reduce noise.
          if (cached && cached.fileId && fileId && cached.fileId === fileId) {
            logger.withFields({ chatId: id }).verbose('Avatar cache hit; skip emit')
            // No network download and no incremental event emission.
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

  /**
   * Fetch a single dialog's small avatar immediately and emit incremental update.
   *
   * Logic:
   * - Resolve dialog entity from in-memory map or via Telegram API.
   * - If cached and `fileId` unchanged, skip redundant emit.
   * - Dedupe concurrent requests for the same `chatId` to avoid wasted work.
   * - Download small avatar bytes and emit `dialog:avatar:data`.
   */
  async function fetchSingleDialogAvatar(chatId: string | number) {
    try {
      const idNum = typeof chatId === 'string' ? Number(chatId) : chatId
      if (!idNum)
        return

      // Dedupe: avoid concurrent duplicate single fetches for the same chat (instance-scoped)
      if (inflightSingles.has(idNum))
        return
      inflightSingles.add(idNum)

      // Resolve entity via cache or API
      let entity = dialogEntities.get(idNum)
      if (!entity) {
        entity = await getClient().getEntity(String(chatId)) as Api.User | Api.Chat | Api.Channel
        // Best-effort cache for future calls
        try {
          if (entity && (entity as any).id?.toJSNumber)
            dialogEntities.set((entity as any).id.toJSNumber(), entity)
        }
        catch {}
      }
      if (!entity)
        return

      // Discover fileId for caching hint
      let fileId: string | undefined
      try {
        if (entity instanceof Api.User && entity.photo && 'photoId' in entity.photo) {
          fileId = (entity.photo as Api.UserProfilePhoto).photoId?.toString()
        }
        else if ((entity instanceof Api.Chat || entity instanceof Api.Channel) && entity.photo && 'photoId' in entity.photo) {
          fileId = (entity.photo as Api.ChatPhoto).photoId?.toString()
        }
      }
      catch {}

      const cached = avatarCache.get(idNum)
      if (cached && cached.fileId && fileId && cached.fileId === fileId) {
        logger.withFields({ chatId: idNum }).verbose('Single avatar cache hit; skip emit')
        return
      }

      // Attempt download: small profile photo
      let buffer: Buffer | Uint8Array | undefined
      try {
        buffer = await getClient().downloadProfilePhoto(entity, { isBig: false }) as Buffer
      }
      catch (err) {
        logger.withError(err as Error).debug('downloadProfilePhoto failed, trying fallback(single)')
        const photo = (entity as any).photo
        if (photo) {
          try {
            buffer = await getClient().downloadMedia(photo, { thumb: -1 }) as Buffer
          }
          catch (err2) {
            logger.withError(err2 as Error).debug('downloadMedia fallback(single) failed')
          }
        }
      }

      if (!buffer) {
        logger.withFields({ chatId: idNum }).verbose('No avatar available for single dialog fetch')
        return
      }

      const byte: Buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
      const mimeType = 'image/jpeg'

      avatarCache.set(idNum, { fileId, mimeType, byte, updatedAt: Date.now() })
      emitter.emit('dialog:avatar:data', { chatId: idNum, byte, mimeType, fileId })
    }
    catch (error) {
      logger.withError(error as Error).warn('Failed to fetch single avatar for dialog')
    }
    finally {
      try {
        const id = typeof chatId === 'string' ? Number(chatId) : chatId
        if (id)
          inflightSingles.delete(id as number)
      }
      catch {}
    }
  }

  return {
    fetchDialogs,
    fetchDialogAvatars,
    fetchSingleDialogAvatar,
  }
}
