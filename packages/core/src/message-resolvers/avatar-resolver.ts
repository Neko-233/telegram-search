/* eslint-disable unicorn/prefer-node-protocol */
import type { Result } from '@unbird/result'
import type { Dialog } from 'telegram/tl/custom/dialog'

import type { MessageResolver, MessageResolverOpts } from '.'
import type { CoreContext } from '../context'

import { Buffer } from 'buffer'

import { useLogger } from '@guiiai/logg'
import { Ok } from '@unbird/result'
import { Api } from 'telegram'

/**
 * Shared avatar cache entry.
 * Stores last `fileId`, `mimeType`, and raw `byte` for reuse.
 */
interface AvatarCacheEntry {
  fileId?: string
  mimeType?: string
  byte?: Buffer
  updatedAt?: number
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

  // In-memory caches
  const userAvatarCache = new Map<string, AvatarCacheEntry>()
  const chatAvatarCache = new Map<number, AvatarCacheEntry>()
  const dialogEntityCache = new Map<number, Api.User | Api.Chat | Api.Channel>()

  // In-flight dedup sets
  const inflightUsers = new Set<string>()
  const inflightChats = new Set<number>()

  // Global cache keyed by avatar fileId to deduplicate across user/chat paths
  // Stores the latest bytes and mime type to allow reuse without re-downloading
  const fileIdCache = new Map<string, { byte: Buffer, mimeType: string, updatedAt: number }>()
  // In-flight downloads keyed by fileId, so concurrent requests share a single download promise
  const inflightFileIds = new Map<string, Promise<{ byte: Buffer, mimeType: string }>>()

  // Global concurrency limiter state for user avatar fetches
  // Limit how many user avatar downloads run at the same time
  const USER_CONCURRENCY_LIMIT = 4
  const userQueue: Array<() => Promise<void>> = []
  let userActiveCount = 0

  /**
   * Drain the user avatar queue respecting the global concurrency limit.
   * Starts queued tasks until `USER_CONCURRENCY_LIMIT` is reached.
   */
  function drainUserQueue(): void {
    while (userActiveCount < USER_CONCURRENCY_LIMIT && userQueue.length > 0) {
      const task = userQueue.shift()!
      userActiveCount++
      task().catch((err) => {
        logger.withError(err as Error).warn('User avatar task failed')
      })
    }
  }

  /**
   * Ensure avatar bytes are available for a given fileId using a global cache and in-flight deduplication.
   * If cached, returns immediately; otherwise starts one download shared by all concurrent callers.
   */
  async function ensureFileIdBytes(
    fileId: string,
    download: () => Promise<Buffer | undefined>,
  ): Promise<{ byte: Buffer, mimeType: string } | undefined> {
    const cached = fileIdCache.get(fileId)
    if (cached)
      return { byte: cached.byte, mimeType: cached.mimeType }

    let p = inflightFileIds.get(fileId)
    if (!p) {
      p = (async () => {
        const byte = await download()
        if (!byte)
          throw new Error('avatar-byte-missing')
        const mimeType = 'image/jpeg'
        fileIdCache.set(fileId, { byte, mimeType, updatedAt: Date.now() })
        return { byte, mimeType }
      })()
      inflightFileIds.set(fileId, p)
    }

    try {
      return await p
    }
    finally {
      inflightFileIds.delete(fileId)
    }
  }

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
   */
  async function downloadSmallAvatar(entity: Api.User | Api.Chat | Api.Channel): Promise<Buffer | undefined> {
    let buffer: Buffer | Uint8Array | undefined
    try {
      buffer = await getClient().downloadProfilePhoto(entity, { isBig: false }) as Buffer
    }
    catch (err) {
      logger.withError(err as Error).debug('downloadProfilePhoto failed, trying fallback')
      const photo = (entity as any).photo
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
        if (cached.byte && cached.mimeType) {
          emitter.emit('entity:avatar:data', { userId: key, byte: cached.byte, mimeType: cached.mimeType, fileId })
          // Ensure global fileId cache has bytes for cross-path reuse
          fileIdCache.set(fileId, { byte: cached.byte, mimeType: cached.mimeType, updatedAt: cached.updatedAt ?? Date.now() })
        }
        return
      }
      // Cross-cache short-circuit: reuse dialog-side cached bytes if available
      try {
        const idNum = (entity as any)?.id?.toJSNumber?.()
        if (idNum && fileId) {
          const chatCached = chatAvatarCache.get(idNum)
          if (chatCached && chatCached.fileId === fileId && chatCached.byte && chatCached.mimeType) {
            userAvatarCache.set(key, { fileId, mimeType: chatCached.mimeType, byte: chatCached.byte, updatedAt: Date.now() })
            fileIdCache.set(fileId, { byte: chatCached.byte, mimeType: chatCached.mimeType, updatedAt: chatCached.updatedAt ?? Date.now() })
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

      const result = await ensureFileIdBytes(fileId, async () => downloadSmallAvatar(entity))
      if (!result) {
        logger.withFields({ userId: key }).verbose('No avatar available for user')
        return
      }

      userAvatarCache.set(key, { fileId, mimeType: result.mimeType, byte: result.byte, updatedAt: Date.now() })
      emitter.emit('entity:avatar:data', { userId: key, byte: result.byte, mimeType: result.mimeType, fileId })
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
          if (entity && (entity as any).id?.toJSNumber)
            dialogEntityCache.set((entity as any).id.toJSNumber(), entity)
        }
        catch {}
      }
      if (!entity)
        return

      const fileId = resolveAvatarFileId(entity)
      const cached = chatAvatarCache.get(idNum)
      if (cached && cached.fileId && fileId && cached.fileId === fileId) {
        logger.withFields({ chatId: idNum }).verbose('Single avatar cache hit; skip emit')
        // Populate global fileId cache for cross-path reuse to avoid re-downloads
        if (cached.byte && cached.mimeType) {
          fileIdCache.set(fileId, { byte: cached.byte, mimeType: cached.mimeType, updatedAt: cached.updatedAt ?? Date.now() })
          // If the entity is a User, also update user-side cache for cross-path reuse
          try {
            if (entity instanceof Api.User && (entity as any).id?.toJSNumber) {
              const uid = String((entity as any).id.toJSNumber())
              userAvatarCache.set(uid, { fileId, mimeType: cached.mimeType, byte: cached.byte, updatedAt: cached.updatedAt ?? Date.now() })
            }
          }
          catch {}
        }
        return
      }

      if (!fileId) {
        logger.withFields({ chatId: idNum }).verbose('No avatar available for single dialog fetch')
        return
      }

      const result = await ensureFileIdBytes(fileId, async () => downloadSmallAvatar(entity))
      if (!result) {
        logger.withFields({ chatId: idNum }).verbose('No avatar available for single dialog fetch')
        return
      }

      chatAvatarCache.set(idNum, { fileId, mimeType: result.mimeType, byte: result.byte, updatedAt: Date.now() })
      // If the entity is a User, also update user-side cache for cross-path reuse
      try {
        if (entity instanceof Api.User && (entity as any).id?.toJSNumber) {
          const uid = String((entity as any).id.toJSNumber())
          userAvatarCache.set(uid, { fileId, mimeType: result.mimeType, byte: result.byte, updatedAt: Date.now() })
        }
      }
      catch {}
      emitter.emit('dialog:avatar:data', { chatId: idNum, byte: result.byte, mimeType: result.mimeType, fileId })
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
          const id = dialog.entity.id?.toJSNumber?.()
          if (!id)
            continue

          const fileId = resolveAvatarFileId(dialog.entity as Api.User | Api.Chat | Api.Channel)

          const cached = chatAvatarCache.get(id)
          // If cache exists and fileId unchanged, skip network and emit to reduce noise.
          if (cached && cached.fileId && fileId && cached.fileId === fileId) {
            logger.withFields({ chatId: id }).verbose('Avatar cache hit; skip emit')
            // Populate global fileId cache for cross-path reuse to avoid re-downloads
            if (cached.byte && cached.mimeType) {
              fileIdCache.set(fileId, { byte: cached.byte, mimeType: cached.mimeType, updatedAt: cached.updatedAt ?? Date.now() })
              // If entity is a User, also update user-side cache for cross-path reuse
              try {
                const ent = dialog.entity as Api.User | Api.Chat | Api.Channel
                if (ent instanceof Api.User && (ent as any).id?.toJSNumber) {
                  const uid = String((ent as any).id.toJSNumber())
                  userAvatarCache.set(uid, { fileId, mimeType: cached.mimeType, byte: cached.byte, updatedAt: cached.updatedAt ?? Date.now() })
                }
              }
              catch {}
            }
            continue
          }

          if (!fileId) {
            logger.withFields({ chatId: id }).verbose('No avatar available for dialog')
            continue
          }

          const result = await ensureFileIdBytes(fileId, async () => downloadSmallAvatar(dialog.entity as Api.User | Api.Chat | Api.Channel))
          if (!result) {
            logger.withFields({ chatId: id }).verbose('No avatar available for dialog')
            continue
          }

          chatAvatarCache.set(id, { fileId, mimeType: result.mimeType, byte: result.byte, updatedAt: Date.now() })
          // If entity is a User, also update user-side cache for cross-path reuse
          try {
            const ent = dialog.entity as Api.User | Api.Chat | Api.Channel
            if (ent instanceof Api.User && (ent as any).id?.toJSNumber) {
              const uid = String((ent as any).id.toJSNumber())
              userAvatarCache.set(uid, { fileId, mimeType: result.mimeType, byte: result.byte, updatedAt: Date.now() })
            }
          }
          catch {}
          emitter.emit('dialog:avatar:data', { chatId: id, byte: result.byte, mimeType: result.mimeType, fileId })
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

      await Promise.all(uniqueUserIds.map(id => helper.fetchUserAvatar(id)))

      // No message mutations to persist
      return Ok([] as never[])
    },
  }
}
