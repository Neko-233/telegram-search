/* eslint-disable unicorn/prefer-node-protocol */
import type { Result } from '@unbird/result'
import type { Dialog } from 'telegram/tl/custom/dialog'

import type { MessageResolver, MessageResolverOpts } from '.'
import type { CoreContext } from '../context'

import { Buffer } from 'buffer'

import { useLogger } from '@guiiai/logg'
import { newQueue } from '@henrygd/queue'
import { Ok } from '@unbird/result'
import { Api } from 'telegram'
import { lru } from 'tiny-lru'

import { AVATAR_CACHE_TTL, AVATAR_DOWNLOAD_CONCURRENCY, MAX_AVATAR_CACHE_SIZE } from '../constants'

/**
 * Shared avatar cache entry.
 * Stores last `fileId`, `mimeType`, and raw `byte` for reuse.
 */
interface AvatarCacheEntry {
  fileId?: string
  mimeType?: string
  byte?: Buffer
}
/**
 * Per-context singleton store for avatar helper to avoid duplicated instances.
 */
const __avatarHelperSingleton = new WeakMap<CoreContext, ReturnType<typeof createAvatarHelper>>()

/**
 * Create shared avatar helper bound to a CoreContext.
 * Encapsulates caches and in-flight deduplication for users and dialogs.
 */
function createAvatarHelper(ctx: CoreContext) {
  const logger = useLogger('core:resolver:avatar')
  const { getClient, emitter } = ctx

  // Use tiny-lru to implement LRU cache with automatic expiration and eviction
  const userAvatarCache = lru<AvatarCacheEntry>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)
  const chatAvatarCache = lru<AvatarCacheEntry>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)
  const dialogEntityCache = lru<Api.User | Api.Chat | Api.Channel>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)
  // Negative caches (sentinels): record entities known to have no avatar
  const noUserAvatarCache = lru<boolean>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)
  const noChatAvatarCache = lru<boolean>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)
  // Global per-context fileId -> bytes cache to dedupe downloads across users/chats
  const fileIdByteCache = lru<{ byte: Buffer, mimeType: string }>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)

  // In-flight dedup sets
  const inflightUsers = new Set<string>()
  const inflightChats = new Set<string>()

  /**
   * Normalize id to a string key for caches and dedup.
   * Ensures consistent keys to avoid LRU misses due to type mismatch.
   */
  function toKey(id: string | number | undefined): string | undefined {
    if (id === undefined || id === null)
      return undefined
    const s = String(id)
    return s.length ? s : undefined
  }

  // Concurrency control queue
  const downloadQueue = newQueue(AVATAR_DOWNLOAD_CONCURRENCY)

  /**
   * Resolve avatar fileId for a Telegram entity.
   * Returns undefined if no photo is present.
   */
  function resolveAvatarFileId(entity: Api.User | Api.Chat | Api.Channel | undefined): string | undefined {
    try {
      if (!entity)
        return undefined

      if (entity instanceof Api.User && entity.photo && 'photoId' in entity.photo) {
        return (entity.photo as Api.UserProfilePhoto).photoId?.toString()
      }
      else if ((entity instanceof Api.Chat || entity instanceof Api.Channel) && entity.photo && 'photoId' in entity.photo) {
        return (entity.photo as Api.ChatPhoto).photoId?.toString()
      }
    }
    catch {}
    return undefined
  }

  /**
   * Download small profile photo for the given entity.
   * Falls back to `downloadMedia` when `downloadProfilePhoto` fails.
   * Use queue to control concurrency
   */
  async function downloadSmallAvatar(entity: Api.User | Api.Chat | Api.Channel): Promise<Buffer | undefined> {
    return downloadQueue.add(async () => {
      let buffer: Buffer | Uint8Array | undefined
      try {
        buffer = await getClient().downloadProfilePhoto(entity, { isBig: false }) as Buffer
      }
      catch (err) {
        logger.withError(err as Error).debug('downloadProfilePhoto failed, trying fallback')
        // eslint-disable-next-line ts/no-explicit-any
        const photo = (entity as Record<string, any>).photo
        if (photo) {
          try {
            buffer = await getClient().downloadMedia(photo, { thumb: -1 }) as Buffer
          }
          catch (err2) {
            logger.withError(err2 as Error).debug('downloadMedia fallback failed')
          }
        }
      }

      if (!buffer)
        return undefined

      // Ensure Buffer for JSON-safe serialization
      return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
    })
  }

  /**
   * Get avatar bytes by fileId with global dedup.
   * If the fileId was downloaded before, reuse bytes to avoid re-downloading.
   */
  async function getAvatarBytes(
    fileId: string | undefined,
    downloadFn: () => Promise<Buffer | undefined>,
  ): Promise<{ byte: Buffer, mimeType: string } | undefined> {
    // Allow downloads even when fileId is unavailable; only use fileId cache when present
    const mimeType = 'image/jpeg' // TODO: add lightweight file-type sniffing
    if (fileId) {
      const cached = fileIdByteCache.get(fileId)
      if (cached)
        return cached
    }
    const byte = await downloadFn()
    if (!byte)
      return undefined
    const result = { byte, mimeType }
    if (fileId)
      fileIdByteCache.set(fileId, result)
    return result
  }

  /**
   * Fetch and emit a user's avatar bytes, with cache and in-flight dedup.
   * Emits `entity:avatar:data` on success.
   * Optional expectedFileId allows early cache validation before entity fetch.
   */
  async function fetchUserAvatar(userId: string, expectedFileId?: string): Promise<void> {
    try {
      const key = String(Number(userId) || userId)
      // Negative cache early exit: skip repeated requests for users without avatars
      if (noUserAvatarCache.get(key)) {
        logger.withFields({ userId: key }).verbose('User has no avatar (sentinel); skip fetch')
        return
      }
      if (inflightUsers.has(key))
        return
      inflightUsers.add(key)

      // Early cache validation: if expectedFileId matches cached fileId, skip entity fetch and download
      if (expectedFileId) {
        const cached = userAvatarCache.get(key)
        logger.withFields({ userId: key, expectedFileId, cachedFileId: cached?.fileId }).verbose('User avatar early cache validation')
        if (cached && cached.fileId === expectedFileId) {
          logger.withFields({ userId: key, fileId: expectedFileId }).verbose('User avatar cache hit with expected fileId - SKIPPING DOWNLOAD')
          if (cached.byte && cached.mimeType) {
            emitter.emit('entity:avatar:data', { userId: key, byte: cached.byte, mimeType: cached.mimeType, fileId: expectedFileId })
          }
          return
        }
        else {
          logger.withFields({ userId: key, expectedFileId, cachedFileId: cached?.fileId, match: cached?.fileId === expectedFileId }).verbose('User avatar early cache validation FAILED - will download')
        }
      }
      else {
        logger.withFields({ userId: key }).verbose('No expectedFileId provided for early cache validation')
      }

      const entity = await getClient().getEntity(userId) as Api.User
      const fileId = resolveAvatarFileId(entity)
      logger.withFields({ userId: key, resolvedFileId: fileId }).verbose('Resolved fileId from entity')

      const cached = userAvatarCache.get(key)
      if (cached) {
        // Hit when fileId matches OR we previously cached bytes without a fileId
        if ((fileId && cached.fileId === fileId) || (!fileId && cached.byte && cached.mimeType)) {
          logger.withFields({ userId: key }).verbose('User avatar cache hit')
          if (cached.byte && cached.mimeType) {
            emitter.emit('entity:avatar:data', { userId: key, byte: cached.byte, mimeType: cached.mimeType, fileId })
          }
          return
        }
      }

      const result = entity ? await getAvatarBytes(fileId, () => downloadSmallAvatar(entity)) : undefined
      if (!result) {
        // Only record sentinel when we have no identifiable fileId and download yielded nothing
        if (!fileId) {
          noUserAvatarCache.set(key, true)
          logger.withFields({ userId: key }).verbose('User has no avatar; record sentinel and skip')
        }
        else {
          logger.withFields({ userId: key }).verbose('No avatar available for user')
        }
        return
      }

      userAvatarCache.set(key, { fileId, mimeType: result.mimeType, byte: result.byte })

      emitter.emit('entity:avatar:data', { userId: key, byte: result.byte, mimeType: result.mimeType, fileId })
    }
    catch (error) {
      logger.withError(error as Error).warn('Failed to fetch avatar for user')
    }
    finally {
      inflightUsers.delete(String(Number(userId) || userId))
    }
  }

  /**
   * Fetch and emit a single dialog avatar bytes, with cache and in-flight dedup.
   * Emits `dialog:avatar:data` on success.
   */
  async function fetchDialogAvatar(chatId: string | number, opts: { entityOverride?: Api.User | Api.Chat | Api.Channel } = {}): Promise<void> {
    try {
      const key = toKey(chatId)
      if (!key)
        return
      // Negative cache early exit for chats/channels without avatars
      if (noChatAvatarCache.get(key)) {
        logger.withFields({ chatId }).verbose('Chat has no avatar (sentinel); skip fetch')
        return
      }
      if (inflightChats.has(key))
        return
      inflightChats.add(key)

      let entity = opts.entityOverride ?? dialogEntityCache.get(key)
      if (!entity) {
        entity = await getClient().getEntity(String(chatId)) as Api.User | Api.Chat | Api.Channel
        // Cache entity for future single fetches
        try {
          // eslint-disable-next-line ts/no-explicit-any
          if (entity && (entity as any).id)
            // eslint-disable-next-line ts/no-explicit-any
            dialogEntityCache.set(String((entity as any).id.toJSNumber?.() ?? (entity as any).id), entity)
        }
        catch {}
      }
      if (!entity)
        return

      const fileId = resolveAvatarFileId(entity)
      const cached = chatAvatarCache.get(key)
      if (cached && ((fileId && cached.fileId === fileId) || (!fileId && cached.byte && cached.mimeType))) {
        logger.withFields({ chatId }).verbose('Single avatar cache hit; skip emit')
        return
      }

      const result = await getAvatarBytes(fileId, () => downloadSmallAvatar(entity))
      if (!result) {
        if (!fileId) {
          noChatAvatarCache.set(key, true)
          logger.withFields({ chatId }).verbose('Chat has no avatar; record sentinel and skip')
        }
        else {
          logger.withFields({ chatId }).verbose('No avatar available for single dialog fetch')
        }
        return
      }

      chatAvatarCache.set(key, { fileId, mimeType: result.mimeType, byte: result.byte })

      const idNum = typeof chatId === 'string' ? Number(chatId) : chatId
      emitter.emit('dialog:avatar:data', { chatId: idNum, byte: result.byte, mimeType: result.mimeType, fileId })
    }
    catch (error) {
      logger.withError(error as Error).warn('Failed to fetch single avatar for dialog')
    }
    finally {
      try {
        const key2 = toKey(chatId)
        if (key2)
          inflightChats.delete(key2)
      }
      catch {}
    }
  }

  /**
   * Batch fetch avatars for a list of dialogs.
   * Concurrency is governed exclusively by the internal `downloadQueue`.
   * This avoids a "queue of queues" situation and ensures steady throughput.
   */
  async function fetchDialogAvatars(dialogList: Dialog[]): Promise<void> {
    const total = dialogList.length
    if (total === 0)
      return

    // Create one task per dialog. Each task delegates concurrency to downloadQueue.
    const tasks = dialogList.map(async (dialog) => {
      if (!dialog?.entity)
        return

      try {
        const id = dialog.entity.id?.toJSNumber?.()
        if (!id)
          return
        const key = toKey(id)!

        // Early skip if sentinel says no avatar
        if (noChatAvatarCache.get(key)) {
          logger.withFields({ chatId: id }).verbose('Chat has no avatar (sentinel); skip batch fetch')
          return
        }

        const fileId = resolveAvatarFileId(dialog.entity as Api.User | Api.Chat | Api.Channel)
        const cached = chatAvatarCache.get(key)
        // If cache exists and fileId unchanged OR we have bytes cached without fileId, skip network.
        if (cached && ((fileId && cached.fileId === fileId) || (!fileId && cached.byte && cached.mimeType))) {
          logger.withFields({ chatId: id }).verbose('Avatar cache hit; skip emit')
          return
        }

        // Delegates concurrency via global downloadQueue, with fileId-level dedup
        const result = await getAvatarBytes(fileId, () => downloadSmallAvatar(dialog.entity as Api.User | Api.Chat | Api.Channel))
        if (!result) {
          if (!fileId) {
            noChatAvatarCache.set(key, true)
            logger.withFields({ chatId: id }).verbose('Chat has no avatar; record sentinel and skip batch fetch')
          }
          else {
            logger.withFields({ chatId: id }).verbose('No avatar available for dialog')
          }
          return
        }

        chatAvatarCache.set(key, { fileId, mimeType: result.mimeType, byte: result.byte })

        emitter.emit('dialog:avatar:data', { chatId: id, byte: result.byte, mimeType: result.mimeType, fileId })
      }
      catch (error) {
        logger.withError(error as Error).warn('Failed to fetch avatar for dialog')
      }
    })

    // Wait for all tasks to settle; errors are logged per-task
    await Promise.allSettled(tasks)
  }

  return {
    fetchUserAvatar,
    fetchDialogAvatar,
    fetchDialogAvatars,
    dialogEntityCache,
    // Prime the LRU cache with fileId information (without avatar bytes)
    primeUserAvatarCache: (userId: string, fileId: string) => {
      const key = String(Number(userId) || userId)
      // Only prime if we don't already have cached bytes
      const existing = userAvatarCache.get(key)
      if (!existing || !existing.byte) {
        logger.withFields({ userId: key, fileId }).verbose('Priming user avatar cache with fileId')
        userAvatarCache.set(key, { fileId, mimeType: '', byte: undefined })
      }
    },
    // Prime the LRU cache with chat avatar fileId information (without avatar bytes)
    primeChatAvatarCache: (chatId: string, fileId: string) => {
      const key = toKey(chatId)
      if (!key)
        return
      // Only prime if we don't already have cached bytes
      const existing = chatAvatarCache.get(key)
      if (!existing || !existing.byte) {
        logger.withFields({ chatId: key, fileId }).verbose('Priming chat avatar cache with fileId')
        chatAvatarCache.set(key, { fileId, mimeType: '', byte: undefined })
      }
    },
    // Export cleanup method for external invocation
    clearCache: () => {
      userAvatarCache.clear()
      chatAvatarCache.clear()
      dialogEntityCache.clear()
      noUserAvatarCache.clear()
      noChatAvatarCache.clear()
      fileIdByteCache.clear()
      logger.log('Avatar cache manually cleared')
    },
    getCacheStats: () => ({
      userAvatars: userAvatarCache.size,
      chatAvatars: chatAvatarCache.size,
      entities: dialogEntityCache.size,
      noUserAvatars: noUserAvatarCache.size,
      noChatAvatars: noChatAvatarCache.size,
      fileIdBytes: fileIdByteCache.size,
      maxSize: MAX_AVATAR_CACHE_SIZE,
      ttl: `${AVATAR_CACHE_TTL / 1000}s`,
    }),
  }
}

/**
 * Get or create a shared avatar helper instance bound to the provided context.
 */
export function useAvatarHelper(ctx: CoreContext) {
  let helper = __avatarHelperSingleton.get(ctx)
  if (!helper) {
    helper = createAvatarHelper(ctx)
    __avatarHelperSingleton.set(ctx, helper)
  }
  return helper
}

/**
 * Create AvatarResolver for message pipeline.
 * For each message, opportunistically fetch sender's avatar and emit bytes.
 * Returns no message mutations (Ok([])) to avoid duplicate storage writes.
 */
export function createAvatarResolver(ctx: CoreContext): MessageResolver {
  const logger = useLogger('core:resolver:avatar')
  const helper = useAvatarHelper(ctx)

  return {
    /**
     * Process messages and ensure user avatars are fetched lazily.
     */
    run: async (opts: MessageResolverOpts): Promise<Result<never[]>> => {
      logger.verbose('Executing avatar resolver')

      // Deduplicate by sender id to avoid repeated downloads within the same batch
      const uniqueUserIds = Array.from(new Set(opts.messages.map(m => String(m.fromId)).filter(Boolean)))

      // Use concurrency control to avoid downloading too many avatars simultaneously
      // fetchUserAvatar internally controls concurrency through downloadQueue
      await Promise.all(uniqueUserIds.map(id => helper.fetchUserAvatar(id)))

      // Log cache stats (for debugging)
      const stats = helper.getCacheStats()
      logger.debug('Avatar cache stats', stats)

      // No message mutations to persist
      return Ok([] as never[])
    },
  }
}
