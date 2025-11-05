import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useBridgeStore } from '../composables/useBridge'

export interface AvatarEntry {
  id: string
  blobUrl?: string
  fileId?: string
  mimeType?: string
  updatedAt?: number
  expiresAt?: number
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Create a centralized avatar store for user and chat avatars.
 * Manages in-memory cache, TTL expiration, and provides helper methods
 * to retrieve and ensure avatar availability via core events.
 */
export const useAvatarStore = defineStore('avatar', () => {
  const websocketStore = useBridgeStore()

  // In-memory caches
  const userAvatars = ref<Map<string, AvatarEntry>>(new Map())
  const chatAvatars = ref<Map<string, AvatarEntry>>(new Map())

  /**
   * Get cached avatar blob URL for a user.
   * Returns undefined if missing or expired.
   */
  function getUserAvatarUrl(userId: string | number | undefined): string | undefined {
    if (!userId)
      return undefined
    const key = String(userId)
    const entry = userAvatars.value.get(key)
    if (!entry)
      return undefined
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      // Expired, cleanup and return undefined
      if (entry.blobUrl)
        URL.revokeObjectURL(entry.blobUrl)
      userAvatars.value.delete(key)
      return undefined
    }
    return entry.blobUrl
  }

  /**
   * Get cached avatar blob URL for a chat.
   * Returns undefined if missing or expired.
   */
  function getChatAvatarUrl(chatId: string | number | undefined): string | undefined {
    if (!chatId)
      return undefined
    const key = String(chatId)
    const entry = chatAvatars.value.get(key)
    if (!entry)
      return undefined
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      if (entry.blobUrl)
        URL.revokeObjectURL(entry.blobUrl)
      chatAvatars.value.delete(key)
      return undefined
    }
    return entry.blobUrl
  }

  /**
   * Set or update a user's avatar cache entry.
   * Accepts blob URL and metadata, and applies TTL by default.
   */
  function setUserAvatar(userId: string | number, data: { blobUrl: string, fileId?: string, mimeType?: string, ttlMs?: number }) {
    const key = String(userId)
    const ttl = data.ttlMs ?? DEFAULT_TTL_MS
    userAvatars.value.set(key, {
      id: key,
      blobUrl: data.blobUrl,
      fileId: data.fileId,
      mimeType: data.mimeType,
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttl,
    })
  }

  /**
   * Set or update a chat's avatar cache entry.
   * Accepts blob URL and metadata, and applies TTL by default.
   */
  function setChatAvatar(chatId: string | number, data: { blobUrl: string, fileId?: string, mimeType?: string, ttlMs?: number }) {
    const key = String(chatId)
    const ttl = data.ttlMs ?? DEFAULT_TTL_MS
    chatAvatars.value.set(key, {
      id: key,
      blobUrl: data.blobUrl,
      fileId: data.fileId,
      mimeType: data.mimeType,
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttl,
    })
  }

  /**
   * Ensure a user's avatar is available in cache.
   * If missing, triggers a lazy fetch via core event 'entity:avatar:fetch'.
   */
  function ensureUserAvatar(userId: string | number | undefined) {
    if (!userId)
      return
    const key = String(userId)
    const existing = userAvatars.value.get(key)
    if (existing && (!existing.expiresAt || Date.now() < existing.expiresAt))
      return
    try {
      websocketStore.sendEvent('entity:avatar:fetch', { userId: key })
    }
    catch (error) {
      console.warn('[Avatar] ensureUserAvatar sendEvent failed:', error)
    }
  }

  /**
   * Cleanup expired avatar entries and revoke their blob URLs.
   * Intended to be called periodically or on app lifecycle events.
   */
  function cleanupExpired() {
    const now = Date.now()

    for (const [key, entry] of userAvatars.value.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        if (entry.blobUrl)
          URL.revokeObjectURL(entry.blobUrl)
        userAvatars.value.delete(key)
      }
    }

    for (const [key, entry] of chatAvatars.value.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        if (entry.blobUrl)
          URL.revokeObjectURL(entry.blobUrl)
        chatAvatars.value.delete(key)
      }
    }
  }

  const size = computed(() => ({ users: userAvatars.value.size, chats: chatAvatars.value.size }))

  return {
    userAvatars,
    chatAvatars,
    size,
    getUserAvatarUrl,
    getChatAvatarUrl,
    setUserAvatar,
    setChatAvatar,
    ensureUserAvatar,
    cleanupExpired,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAvatarStore, import.meta.hot))
}
