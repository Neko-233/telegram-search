import type { ComputedRef, Ref } from 'vue'

import { prefillChatAvatarIntoStore, prefillUserAvatarIntoStore, useAvatarStore } from '@tg-search/client'
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
    const url = avatarStore.getUserAvatarUrl(id)
    if (url)
      return
    try {
      await prefillUserAvatarIntoStore(String(id))
    }
    catch {
      /* ignore prefill error and continue */
    }
    const stillMissing = !avatarStore.getUserAvatarUrl(id)
    if (stillMissing)
      avatarStore.ensureUserAvatar(String(id))
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
      await prefillChatAvatarIntoStore(String(cid))
    }
    catch {
      /* ignore prefill error and continue */
    }
    const stillMissing = !avatarStore.hasValidChatAvatar(String(cid), fid)
    if (stillMissing)
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
  const url = avatarStore.getUserAvatarUrl(userId)
  if (url)
    return
  try {
    await prefillUserAvatarIntoStore(String(userId))
  }
  catch {
    /* ignore */
  }
  const stillMissing = !avatarStore.getUserAvatarUrl(userId)
  if (stillMissing)
    avatarStore.ensureUserAvatar(String(userId))
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
    await prefillChatAvatarIntoStore(String(chatId))
  }
  catch {
    /* ignore */
  }
  const stillMissing = !avatarStore.hasValidChatAvatar(String(chatId), fid)
  if (stillMissing)
    avatarStore.ensureChatAvatar(String(chatId), fid)
}
