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
// Client-driven, on-demand avatar ensure flow.
// Shared helper that:
// 1) Short-circuits when cache is valid (TTL and optional fileId match)
// 2) Prefills memory from IndexedDB and primes server LRU (fileId)
// 3) Falls back to explicit fetch only when still invalid
async function ensureCore(
  idRaw: string | number | undefined,
  opts: {
    hasValid: (id: string, expectedFileId?: string) => boolean
    inflightPrefillIds?: Set<string>
    prefill: (id: string) => Promise<boolean>
    getFileId: (id: string | number | undefined) => string | undefined
    primeCache: (id: string, fileId: string) => void
    ensureFetch: (id: string, expectedFileId?: string) => void
    expectedFileId?: string
  },
): Promise<void> {
  const id = idRaw
  if (!id)
    return
  const key = String(id)
  if (opts.hasValid(key, opts.expectedFileId))
    return
  if (opts.inflightPrefillIds && opts.inflightPrefillIds.has(key))
    return
  if (opts.inflightPrefillIds)
    opts.inflightPrefillIds.add(key)
  try {
    const prefillSuccess = await opts.prefill(key)
    const fileId = opts.getFileId(id)
    if (prefillSuccess && fileId)
      opts.primeCache(key, fileId)
    if (opts.hasValid(key, opts.expectedFileId))
      return
  }
  catch (error) {
    console.warn('[useEnsureAvatar] Prefill avatar failed', error)
  }
  finally {
    if (opts.inflightPrefillIds)
      opts.inflightPrefillIds.delete(key)
  }
  if (!opts.hasValid(key, opts.expectedFileId))
    opts.ensureFetch(String(id), opts.expectedFileId)
}

async function ensureUserAvatarCore(userIdRaw: string | number | undefined): Promise<void> {
  const avatarStore = useAvatarStore()
  const bridgeStore = useBridgeStore()
  await ensureCore(userIdRaw, {
    hasValid: id => avatarStore.hasValidUserAvatar(id),
    inflightPrefillIds: avatarStore.inflightUserPrefillIds,
    prefill: id => prefillUserAvatarIntoStore(id),
    getFileId: id => avatarStore.getUserAvatarFileId(id),
    primeCache: (id, fileId) => bridgeStore.sendEvent('entity:avatar:prime-cache', { userId: id, fileId }),
    ensureFetch: (id, expected) => avatarStore.ensureUserAvatar(id, expected),
  })
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
  const bridgeStore = useBridgeStore()
  const expected = fileIdRaw != null ? String(fileIdRaw) : undefined
  await ensureCore(chatIdRaw, {
    hasValid: (id, exp) => avatarStore.hasValidChatAvatar(id, exp),
    prefill: id => prefillChatAvatarIntoStore(id),
    getFileId: id => avatarStore.getChatAvatarFileId(id),
    primeCache: (id, fileId) => bridgeStore.sendEvent('entity:chat-avatar:prime-cache', { chatId: id, fileId }),
    ensureFetch: (id, exp) => avatarStore.ensureChatAvatar(id, exp),
    expectedFileId: expected,
  })
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
