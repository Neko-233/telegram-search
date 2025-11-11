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
  /**
   * Read numeric config from environment without using global `process`.
   * Uses `require("process")` defensively with a try/catch to work in browser builds.
   * Accepts zero; rejects non-finite or negative numbers.
   */
  function getEnvNumber(name: string, fallback: number): number {
    let raw: string | undefined
    try {
      // eslint-disable-next-line ts/no-require-imports
      const proc = require('process') as { env?: Record<string, string | undefined> }
      raw = proc?.env?.[name]
    }
    catch {
      raw = undefined
    }
    const n = raw != null ? Number(raw) : Number.NaN
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }

  // --- TTL & Capacity Configuration (conservative defaults) ---
  const FILEID_SOFT_TTL_MS = getEnvNumber('AVATAR_FILEID_SOFT_TTL_MS', 12 * 60 * 60 * 1000) // 12h
  const FILEID_HARD_TTL_MS = getEnvNumber('AVATAR_FILEID_HARD_TTL_MS', 36 * 60 * 60 * 1000) // 36h
  const USER_SOFT_TTL_MS = getEnvNumber('AVATAR_USER_SOFT_TTL_MS', 48 * 60 * 60 * 1000) // 48h
  const USER_HARD_TTL_MS = getEnvNumber('AVATAR_USER_HARD_TTL_MS', 7 * 24 * 60 * 60 * 1000) // 7d
  const CHAT_SOFT_TTL_MS = getEnvNumber('AVATAR_CHAT_SOFT_TTL_MS', 48 * 60 * 60 * 1000) // 48h
  const CHAT_HARD_TTL_MS = getEnvNumber('AVATAR_CHAT_HARD_TTL_MS', 7 * 24 * 60 * 60 * 1000) // 7d

  const FILEID_MAX_ENTRIES = getEnvNumber('AVATAR_FILEID_MAX_ENTRIES', 7000)
  const USER_ENTRY_BUDGET = getEnvNumber('AVATAR_USER_ENTRY_BUDGET', 4000)
  const CHAT_ENTRY_BUDGET = getEnvNumber('AVATAR_CHAT_ENTRY_BUDGET', 4000)

  const REFRESH_JITTER_MS = getEnvNumber('AVATAR_REFRESH_JITTER_MS', 500)

  // 使用 tiny-lru 实现 LRU 缓存，自动过期和淘汰
  const userAvatarCache = lru<AvatarCacheEntry>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)
  const chatAvatarCache = lru<AvatarCacheEntry>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)
  const dialogEntityCache = lru<Api.User | Api.Chat | Api.Channel>(MAX_AVATAR_CACHE_SIZE, AVATAR_CACHE_TTL)

  // In-flight dedup sets
  const inflightUsers = new Set<string>()
  const inflightChats = new Set<number>()

  // 并发控制队列
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
   * Safely extract a numeric id from a Telegram entity.
   * Supports gramJS BigInteger (`toJSNumber`), native `bigint`, and `number`.
   */
  function getEntityIdNumber(entity: Api.User | Api.Chat | Api.Channel | undefined): number | undefined {
    if (!entity)
      return undefined
    const idVal = (entity as unknown as { id?: unknown }).id
    if (idVal == null)
      return undefined
    if (typeof idVal === 'number')
      return idVal
    if (typeof idVal === 'bigint') {
      const n = Number(idVal)
      return Number.isFinite(n) ? n : undefined
    }
    const maybe = idVal as { toJSNumber?: () => number }
    if (typeof maybe.toJSNumber === 'function') {
      try {
        const n = maybe.toJSNumber()
        return Number.isFinite(n) ? n : undefined
      }
      catch {}
    }
    return undefined
  }

  /**
   * Convert an entity's `photo` to a media input acceptable by `downloadMedia`.
   * Falls back to `undefined` when the shape is not compatible.
   */
  function resolveEntityPhotoMedia(entity: Api.User | Api.Chat | Api.Channel): Api.TypeMessageMedia | undefined {
    const photo = (entity as unknown as { photo?: unknown }).photo
    if (!photo)
      return undefined
    return photo as unknown as Api.TypeMessageMedia
  }

  /**
   * Download small profile photo for the given entity.
   * Falls back to `downloadMedia` when `downloadProfilePhoto` fails.
   * 使用队列控制并发
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
   * Fetch and emit a user's avatar bytes, with cache and in-flight dedup.
   * Emits `entity:avatar:data` on success.
   */
  async function fetchUserAvatar(userId: string): Promise<void> {
    const key = String(Number(userId) || userId)
    if (inflightUsers.has(key))
      return
    inflightUsers.add(key)

    // Enqueue the actual download work and try to start it
    return new Promise<void>((resolve) => {
      userQueue.push(async () => {
        try {
          await performUserAvatarFetch(key)
        }
        finally {
          inflightUsers.delete(key)
          userActiveCount--
          drainUserQueue()
          resolve()
        }
      })
      drainUserQueue()
    })
  }

  /**
   * Perform the actual user avatar fetch work with cache check and emit.
   * Intended to be called from the queue runner.
   */
  async function performUserAvatarFetch(key: string): Promise<void> {
    try {
      const entity = await getClient().getEntity(key) as Api.User
      const fileId = resolveAvatarFileId(entity)

      const cached = userAvatarCache.get(key)
      if (cached && cached.fileId && fileId && cached.fileId === fileId) {
        logger.withFields({ userId: key }).verbose('User avatar cache hit')
        const nowMs = now()
        if (cached.hardExpiresAt && nowMs > cached.hardExpiresAt) {
          // fall through to refresh
        }
        else if (cached.byte && cached.mimeType) {
          emitter.emit('entity:avatar:data', { userId: key, byte: cached.byte, mimeType: cached.mimeType, fileId })
          // Ensure global fileId cache has bytes for cross-path reuse
          fileIdCache.set(fileId, { byte: cached.byte, mimeType: cached.mimeType, updatedAt: cached.updatedAt ?? nowMs })
          if (cached.softExpiresAt && nowMs > cached.softExpiresAt)
            scheduleFileIdRefresh(fileId, async () => downloadSmallAvatar(entity))
          return
        }
      }
      // Cross-cache short-circuit: reuse dialog-side cached bytes if available
      try {
        const idNum = getEntityIdNumber(entity)
        if (idNum && fileId) {
          const chatCached = chatAvatarCache.get(String(idNum))
          if (chatCached && chatCached.fileId === fileId && chatCached.byte && chatCached.mimeType) {
            const meta = makeMetaForBytes(chatCached.byte, USER_SOFT_TTL_MS, USER_HARD_TTL_MS)
            userAvatarCache.set(key, { fileId, mimeType: chatCached.mimeType, byte: chatCached.byte, updatedAt: meta.updatedAt, softExpiresAt: meta.softExpiresAt, hardExpiresAt: meta.hardExpiresAt })
            fileIdCache.set(fileId, { byte: chatCached.byte, mimeType: chatCached.mimeType, updatedAt: chatCached.updatedAt ?? now() })
            emitter.emit('entity:avatar:data', { userId: key, byte: chatCached.byte, mimeType: chatCached.mimeType, fileId })
            return
          }
        }
      }
      catch {}
      if (!entity || !fileId) {
        logger.withFields({ userId: key }).verbose('No avatar available for user')
        return
      }

      const mimeType = 'image/jpeg'
      userAvatarCache.set(key, { fileId, mimeType, byte })

      emitter.emit('entity:avatar:data', { userId: key, byte, mimeType, fileId })
    }
    catch (error) {
      logger.withError(error as Error).warn('Failed to fetch avatar for user')
    }
  }

  /**
   * Fetch and emit a single dialog avatar bytes, with cache and in-flight dedup.
   * Emits `dialog:avatar:data` on success.
   */
  async function fetchDialogAvatar(chatId: string | number, opts: { entityOverride?: Api.User | Api.Chat | Api.Channel } = {}): Promise<void> {
    try {
      const idNum = typeof chatId === 'string' ? Number(chatId) : chatId
      if (!idNum)
        return

      if (inflightChats.has(idNum))
        return
      inflightChats.add(idNum)

      let entity = opts.entityOverride ?? dialogEntityCache.get(idNum)
      if (!entity) {
        entity = await getClient().getEntity(String(chatId)) as Api.User | Api.Chat | Api.Channel
        // Cache entity for future single fetches
        try {
          // eslint-disable-next-line ts/no-explicit-any
          if (entity && (entity as any).id?.toJSNumber)
            // eslint-disable-next-line ts/no-explicit-any
            dialogEntityCache.set((entity as any).id.toJSNumber(), entity)
        }
        catch {}
      }
      if (!entity)
        return

      const fileId = resolveAvatarFileId(entity)
      const cached = chatAvatarCache.get(String(idNum))
      if (cached && cached.fileId && fileId && cached.fileId === fileId) {
        logger.withFields({ chatId: idNum }).verbose('Single avatar cache hit; skip emit')
        // Populate global fileId cache for cross-path reuse to avoid re-downloads
        if (cached.byte && cached.mimeType) {
          const nowMs = now()
          fileIdCache.set(fileId, { byte: cached.byte, mimeType: cached.mimeType, updatedAt: cached.updatedAt ?? nowMs })
          // If the entity is a User, also update user-side cache for cross-path reuse
          try {
            const uidNum = getEntityIdNumber(entity)
            if (entity instanceof Api.User && uidNum != null) {
              const uid = String(uidNum)
              const metaUser = makeMetaForBytes(cached.byte, USER_SOFT_TTL_MS, USER_HARD_TTL_MS)
              userAvatarCache.set(uid, { fileId, mimeType: cached.mimeType, byte: cached.byte, updatedAt: metaUser.updatedAt, softExpiresAt: metaUser.softExpiresAt, hardExpiresAt: metaUser.hardExpiresAt })
            }
          }
          catch {}
          if (cached.softExpiresAt && nowMs > cached.softExpiresAt)
            scheduleFileIdRefresh(fileId, async () => downloadSmallAvatar(entity))
        }
        return
      }

      if (!fileId) {
        logger.withFields({ chatId: idNum }).verbose('No avatar available for single dialog fetch')
        return
      }

      const mimeType = 'image/jpeg'
      chatAvatarCache.set(idNum, { fileId, mimeType, byte })

      emitter.emit('dialog:avatar:data', { chatId: idNum, byte, mimeType, fileId })
    }
    catch (error) {
      logger.withError(error as Error).warn('Failed to fetch single avatar for dialog')
    }
    finally {
      try {
        const id = typeof chatId === 'string' ? Number(chatId) : chatId
        if (id)
          inflightChats.delete(id as number)
      }
      catch {}
    }
  }

  /**
   * Batch fetch avatars for a list of dialogs with concurrency.
   * Emits incremental `dialog:avatar:data` events as each item completes.
   * Default concurrency is 4 to reduce burst network and I/O load.
   */
  async function fetchDialogAvatars(dialogList: Dialog[], concurrency = 4): Promise<void> {
    const total = dialogList.length
    if (total === 0)
      return

    async function worker() {
      while (dialogList.length > 0) {
        const dialog = dialogList.shift()!
        if (!dialog?.entity)
          continue

        try {
          const id = getEntityIdNumber(dialog.entity as Api.User | Api.Chat | Api.Channel)
          if (!id)
            continue

          const fileId = resolveAvatarFileId(dialog.entity as Api.User | Api.Chat | Api.Channel)

          const cached = chatAvatarCache.get(String(id))
          // If cache exists and fileId unchanged, skip network and emit to reduce noise.
          if (cached && cached.fileId && fileId && cached.fileId === fileId) {
            logger.withFields({ chatId: id }).verbose('Avatar cache hit; skip emit')
            // Populate global fileId cache for cross-path reuse to avoid re-downloads
            if (cached.byte && cached.mimeType) {
              const nowMs = now()
              fileIdCache.set(fileId, { byte: cached.byte, mimeType: cached.mimeType, updatedAt: cached.updatedAt ?? nowMs })
              // If entity is a User, also update user-side cache for cross-path reuse
              try {
                const ent = dialog.entity as Api.User | Api.Chat | Api.Channel
                const uidNum = getEntityIdNumber(ent)
                if (ent instanceof Api.User && uidNum != null) {
                  const uid = String(uidNum)
                  const metaUser = makeMetaForBytes(cached.byte, USER_SOFT_TTL_MS, USER_HARD_TTL_MS)
                  userAvatarCache.set(uid, { fileId, mimeType: cached.mimeType, byte: cached.byte, updatedAt: metaUser.updatedAt, softExpiresAt: metaUser.softExpiresAt, hardExpiresAt: metaUser.hardExpiresAt })
                }
              }
              catch {}
              if (cached.softExpiresAt && nowMs > cached.softExpiresAt)
                scheduleFileIdRefresh(fileId, async () => downloadSmallAvatar(dialog.entity as Api.User | Api.Chat | Api.Channel))
            }
            continue
          }

          if (!fileId) {
            logger.withFields({ chatId: id }).verbose('No avatar available for dialog')
            continue
          }

          const mimeType = 'image/jpeg'
          chatAvatarCache.set(id, { fileId, mimeType, byte })

          emitter.emit('dialog:avatar:data', { chatId: id, byte, mimeType, fileId })
        }
        catch (error) {
          logger.withError(error as Error).warn('Failed to fetch avatar for dialog')
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker())
    await Promise.allSettled(workers)
  }

  return {
    fetchUserAvatar,
    fetchDialogAvatar,
    fetchDialogAvatars,
    dialogEntityCache,
    // 导出清理方法供外部调用
    clearCache: () => {
      userAvatarCache.clear()
      chatAvatarCache.clear()
      dialogEntityCache.clear()
      logger.log('Avatar cache manually cleared')
    },
    getCacheStats: () => ({
      userAvatars: userAvatarCache.size,
      chatAvatars: chatAvatarCache.size,
      entities: dialogEntityCache.size,
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

      // 使用并发控制，避免同时下载过多头像
      // fetchUserAvatar 内部已经通过 downloadQueue 控制了并发
      await Promise.all(uniqueUserIds.map(id => helper.fetchUserAvatar(id)))

      // 记录缓存状态（调试用）
      const stats = helper.getCacheStats()
      logger.debug('Avatar cache stats', stats)

      // No message mutations to persist
      return Ok([] as never[])
    },
  }
}
/**
 * Remove a key from a tiny-lru cache with compatibility across versions.
 * Uses `.delete` when available, otherwise `.remove`.
 */
/**
 * Delete a key from a tiny-lru instance in a version-compatible way.
 * Supports both v10 (`remove`) and v11+ (`delete`) methods.
 */
function lruDeleteKey(cache: unknown, key: string): void {
  const c = cache as { delete?: (k: string) => void, remove?: (k: string) => void }
  if (typeof c.delete === 'function')
    c.delete(key)
  else if (typeof c.remove === 'function')
    c.remove(key)
}
