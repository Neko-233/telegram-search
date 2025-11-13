import type { ComputedRef, Ref } from 'vue'

import { prefillChatAvatarIntoStore, prefillUserAvatarIntoStore, useAvatarStore, useBridgeStore } from '@tg-search/client'
import { onMounted, unref, watch } from 'vue'

type MaybeRef<T> = T | Ref<T> | ComputedRef<T>

/**
 * Ensure a user's avatar is available when the component mounts.
 * Behavior:
 * - Prefills from IndexedDB cache first.
 * - If still missing, triggers network fetch via centralized avatar store.
 * - Re-runs when `userId` changes.
 */
export function useEnsureUserAvatar(userId: MaybeRef<string | number | undefined>): void {
  const avatarStore = useAvatarStore()

  async function ensure() {
    const id = unref(userId)
    if (!id)
      return
    const key = String(id)

    // 1. Check in-memory cache first
    const url = avatarStore.getUserAvatarUrl(id)
    if (url) {
      return
    }

    // 2. Check if a prefill is already in-flight for this userId
    if (avatarStore.inflightUserPrefillIds.has(key)) {
      return
    }

    // 3. Mark this userId as being prefilled to prevent duplicate work
    avatarStore.inflightUserPrefillIds.add(key)

    let prefillFileId: string | undefined
    try {
      // Attempt to prefill from IndexedDB.
      const prefillSuccess = await prefillUserAvatarIntoStore(key)

      // If prefill succeeded, get the fileId for core layer cache priming
      if (prefillSuccess) {
        prefillFileId = avatarStore.getUserAvatarFileId(id)
      }
    }
    catch {
      /* ignore prefill error and continue */
    }
    finally {
      // 4. Always remove the prefill lock when done, whether it succeeded or failed
      avatarStore.inflightUserPrefillIds.delete(key)
    }

    // If prefill failed, a final check on the store before network fetch as a safeguard.
    const finalUrl = avatarStore.getUserAvatarUrl(id)
    if (!finalUrl) {
      // Get fileId if available for core layer cache validation
      const fileId = avatarStore.getUserAvatarFileId(id)
      avatarStore.ensureUserAvatar(String(id), fileId)
    }
    else {
      const fileId = prefillFileId || avatarStore.getUserAvatarFileId(id)

      // If prefill succeeded, use the front-end data to preheat the core layer's LRU cache.
      if (fileId) {
        const bridgeStore = useBridgeStore()
        bridgeStore.sendEvent('entity:avatar:prime-cache', { userId: key, fileId })
      }
    }
  }

  onMounted(ensure)
  watch(() => unref(userId), ensure)
}

/**
 * Ensure a chat's avatar on component mount.
 * Behavior:
 * - Prefills from IndexedDB cache using chatId.
 * - If cache invalid or missing, triggers prioritized fetch with fileId.
 * - Watches `chatId`/`fileId` to re-run when they change.
 */
export function useEnsureChatAvatar(chatId: MaybeRef<string | number | undefined>, fileId?: MaybeRef<string | number | undefined>): void {
  const avatarStore = useAvatarStore()

  async function ensure() {
    const cid = unref(chatId)
    const fidRaw = unref(fileId)
    const fid = fidRaw != null ? String(fidRaw) : undefined
    if (!cid)
      return
    const valid = avatarStore.hasValidChatAvatar(String(cid), fid)
    if (valid)
      return
    try {
      // Attempt to prefill from IndexedDB.
      const prefillSuccess = await prefillChatAvatarIntoStore(String(cid))
      // After prefilling, if the avatar is now valid (correct fileId), we can stop.
      if (avatarStore.hasValidChatAvatar(String(cid), fid))
        return

      // If prefill succeeded, use the front-end data to preheat the core layer's LRU cache.
      if (prefillSuccess) {
        const fileId = avatarStore.getChatAvatarFileId(cid)
        if (fileId) {
          const bridgeStore = useBridgeStore()
          bridgeStore.sendEvent('entity:chat-avatar:prime-cache', { chatId: String(cid), fileId })
        }
      }
    }
    catch {
      /* ignore prefill error and continue */
    }

    // If prefill failed or the loaded avatar was outdated, trigger network fetch.
    if (!avatarStore.hasValidChatAvatar(String(cid), fid))
      avatarStore.ensureChatAvatar(String(cid), fid)
  }

  onMounted(ensure)
  watch([() => unref(chatId), () => unref(fileId)], ensure)
}

/**
 * Ensure a user's avatar immediately without lifecycle hooks.
 * Use when you need to trigger avatar availability from watchers or events.
 */
export async function ensureUserAvatarImmediate(userId: string | number | undefined): Promise<void> {
  const avatarStore = useAvatarStore()
  if (!userId)
    return
  const key = String(userId)
  // 1. Check in-memory cache first
  const url = avatarStore.getUserAvatarUrl(userId)
  if (url)
    return
  // 2. Check if a prefill is already in-flight for this userId
  if (avatarStore.inflightUserPrefillIds.has(key))
    return
  // 3. Mark this userId as being prefilled to prevent duplicate work
  avatarStore.inflightUserPrefillIds.add(key)

  try {
    // Attempt to prefill from IndexedDB. If successful, prime core cache and return.
    const prefillSuccess = await prefillUserAvatarIntoStore(key)
    if (prefillSuccess) {
      const fileId = avatarStore.getUserAvatarFileId(userId)
      if (fileId) {
        const bridgeStore = useBridgeStore()
        bridgeStore.sendEvent('entity:avatar:prime-cache', { userId: key, fileId })
      }
      return
    }
  }
  catch {
    /* ignore */
  }
  finally {
    // 4. Always remove the prefill lock when done, whether it succeeded or failed
    avatarStore.inflightUserPrefillIds.delete(key)
  }

  // If prefill failed, a final check on the store before network fetch as a safeguard.
  if (!avatarStore.getUserAvatarUrl(userId))
    avatarStore.ensureUserAvatar(String(userId), avatarStore.getUserAvatarFileId(userId))
}

/**
 * Ensure a chat's avatar immediately without lifecycle hooks.
 * Safe to call outside of setup() contexts.
 */
export async function ensureChatAvatarImmediate(chatId: string | number | undefined, fileId?: string | number | undefined): Promise<void> {
  const avatarStore = useAvatarStore()
  if (!chatId)
    return
  const fid = fileId != null ? String(fileId) : undefined
  const valid = avatarStore.hasValidChatAvatar(String(chatId), fid)
  if (valid)
    return
  try {
    // Attempt to prefill from IndexedDB.
    await prefillChatAvatarIntoStore(String(chatId))
    // After prefilling, if the avatar is now valid (correct fileId), we can stop.
    if (avatarStore.hasValidChatAvatar(String(chatId), fid))
      return
  }
  catch {
    /* ignore */
  }

  // If prefill failed or the loaded avatar was outdated, trigger network fetch.
  if (!avatarStore.hasValidChatAvatar(String(chatId), fid))
    avatarStore.ensureChatAvatar(String(chatId), fid)
}
