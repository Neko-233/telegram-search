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
async function ensureUserAvatarCore(userIdRaw: string | number | undefined): Promise<void> {
  const avatarStore = useAvatarStore()
  const id = userIdRaw
  if (!id)
    return
  const key = String(id)
  const url = avatarStore.getUserAvatarUrl(id)
  if (url)
    return
  if (avatarStore.inflightUserPrefillIds.has(key))
    return
  avatarStore.inflightUserPrefillIds.add(key)
  try {
    const prefillSuccess = await prefillUserAvatarIntoStore(key)
    if (prefillSuccess) {
      const fileId = avatarStore.getUserAvatarFileId(id)
      if (fileId) {
        const bridgeStore = useBridgeStore()
        bridgeStore.sendEvent('entity:avatar:prime-cache', { userId: key, fileId })
      }
      return
    }
  }
  catch {}
  finally {
    avatarStore.inflightUserPrefillIds.delete(key)
  }
  if (!avatarStore.getUserAvatarUrl(id))
    avatarStore.ensureUserAvatar(String(id), avatarStore.getUserAvatarFileId(id))
}

export function useEnsureUserAvatar(userId: MaybeRef<string | number | undefined>): void {
  async function ensure() {
    await ensureUserAvatarCore(unref(userId))
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
async function ensureChatAvatarCore(chatIdRaw: string | number | undefined, fileIdRaw?: string | number | undefined): Promise<void> {
  const avatarStore = useAvatarStore()
  const cid = chatIdRaw
  const fid = fileIdRaw != null ? String(fileIdRaw) : undefined
  if (!cid)
    return
  const valid = avatarStore.hasValidChatAvatar(String(cid), fid)
  if (valid)
    return
  try {
    const prefillSuccess = await prefillChatAvatarIntoStore(String(cid))
    if (avatarStore.hasValidChatAvatar(String(cid), fid))
      return
    if (prefillSuccess) {
      const fileId2 = avatarStore.getChatAvatarFileId(cid)
      if (fileId2) {
        const bridgeStore = useBridgeStore()
        bridgeStore.sendEvent('entity:chat-avatar:prime-cache', { chatId: String(cid), fileId: fileId2 })
      }
    }
  }
  catch {}
  if (!avatarStore.hasValidChatAvatar(String(cid), fid))
    avatarStore.ensureChatAvatar(String(cid), fid)
}

export function useEnsureChatAvatar(chatId: MaybeRef<string | number | undefined>, fileId?: MaybeRef<string | number | undefined>): void {
  async function ensure() {
    await ensureChatAvatarCore(unref(chatId), unref(fileId))
  }
  onMounted(ensure)
  watch([() => unref(chatId), () => unref(fileId)], ensure)
}

/**
 * Ensure a user's avatar immediately without lifecycle hooks.
 * Use when you need to trigger avatar availability from watchers or events.
 */
export async function ensureUserAvatarImmediate(userId: string | number | undefined): Promise<void> {
  await ensureUserAvatarCore(userId)
}

/**
 * Ensure a chat's avatar immediately without lifecycle hooks.
 * Safe to call outside of setup() contexts.
 */
export async function ensureChatAvatarImmediate(chatId: string | number | undefined, fileId?: string | number | undefined): Promise<void> {
  await ensureChatAvatarCore(chatId, fileId)
}
