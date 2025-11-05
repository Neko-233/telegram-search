/* eslint-disable unicorn/prefer-node-protocol */
import type { Result } from '@unbird/result'

import type { CoreContext } from '../context'
import type { CoreUserEntity } from '../types/events'

import { Buffer } from 'buffer'

import { useLogger } from '@guiiai/logg'
import { Ok } from '@unbird/result'
import { Api } from 'telegram'

import { resolveEntity } from '../utils/entity'

export type EntityService = ReturnType<typeof createEntityService>

export function createEntityService(ctx: CoreContext) {
  const { getClient, emitter } = ctx
  const logger = useLogger('core:entity')

  /**
   * In-memory avatar cache keyed by `userId` string.
   * Stores last `fileId`, `mimeType`, and raw `byte` to avoid redundant downloads.
   */
  const avatarCache = new Map<string, {
    fileId?: string
    mimeType?: string
    byte?: Buffer
    updatedAt?: number
  }>()

  async function getEntity(uid: string) {
    const user = await getClient().getEntity(uid)
    return user
  }

  async function getMeInfo(): Promise<Result<CoreUserEntity>> {
    const apiUser = await getClient().getMe()
    const result = resolveEntity(apiUser).expect('Failed to resolve entity') as CoreUserEntity
    emitter.emit('entity:me:data', result)
    return Ok(result)
  }

  /**
   * Download a user's small profile photo and emit incremental avatar bytes.
   * Uses Node.js Buffer to ensure JSON serialization over WebSocket.
   */
  async function fetchUserAvatar(userId: string) {
    try {
      const entity = await getClient().getEntity(userId)
      const id = (entity as any)?.id?.toJSNumber?.() ?? Number(userId)
      const key = String(id)

      // Discover fileId for caching
      let fileId: string | undefined
      try {
        if (entity instanceof Api.User && entity.photo && 'photoId' in entity.photo) {
          fileId = (entity.photo as Api.UserProfilePhoto).photoId?.toString()
        }
      }
      catch {}

      const cached = avatarCache.get(key)
      if (cached && cached.fileId && fileId && cached.fileId === fileId) {
        logger.withFields({ userId: key }).verbose('User avatar cache hit')
        if (cached.byte && cached.mimeType) {
          emitter.emit('entity:avatar:data', { userId: key, byte: cached.byte, mimeType: cached.mimeType, fileId })
        }
        return
      }

      let buffer: Buffer | Uint8Array | undefined
      try {
        buffer = await getClient().downloadProfilePhoto(entity, { isBig: false }) as Buffer
      }
      catch (err) {
        logger.withError(err as Error).debug('downloadProfilePhoto failed for user')
      }

      if (!buffer) {
        logger.withFields({ userId: key }).verbose('No avatar available for user')
        return
      }

      const byte: Buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
      const mimeType = 'image/jpeg'

      avatarCache.set(key, { fileId, mimeType, byte, updatedAt: Date.now() })
      emitter.emit('entity:avatar:data', { userId: key, byte, mimeType, fileId })
    }
    catch (error) {
      logger.withError(error as Error).warn('Failed to fetch avatar for user')
    }
  }

  return {
    getEntity,
    getMeInfo,
    fetchUserAvatar,
  }
}
