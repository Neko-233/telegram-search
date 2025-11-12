import type { DirectiveBinding } from 'vue'

import { prefillUserAvatarIntoStore, useAvatarStore } from '@tg-search/client'

interface EnsureUserAvatarPayload { userId: string | number }

/**
 * ensure-user-avatar: Ensure user avatar only when element becomes visible.
 * - Prefills from IndexedDB cache first to avoid network when possible
 * - Triggers network fetch via websocket only if missing/expired
 * - Uses nearest scrollable ancestor as IntersectionObserver root for accuracy
 */
export const ensureUserAvatarDirective = {
  /**
   * Mount observer to detect visibility within the list/container viewport.
   * When intersecting, prefill then ensure the user's avatar in the store.
   */
  mounted(el: HTMLElement, binding: DirectiveBinding<EnsureUserAvatarPayload>) {
    const payload = binding.value
    if (!payload)
      return

    const { userId } = payload
    const avatarStore = useAvatarStore()

    /**
     * Try to ensure avatar: cache-first prefill, then network if still missing.
     */
    const tryEnsure = async () => {
      try {
        const url = avatarStore.getUserAvatarUrl(userId)
        if (url)
          return
        await prefillUserAvatarIntoStore(String(userId))
        const stillMissing = !avatarStore.getUserAvatarUrl(userId)
        if (stillMissing)
          avatarStore.ensureUserAvatar(String(userId))
      }
      catch {
        avatarStore.ensureUserAvatar(String(userId))
      }
    }

    /**
     * Find nearest scrollable ancestor to use as IntersectionObserver root.
     * This makes visibility detection relative to virtual list container.
     */
    const findScrollRoot = (node: HTMLElement | null): HTMLElement | null => {
      let current: HTMLElement | null = node
      while (current && current.parentElement) {
        const style = window.getComputedStyle(current)
        const overflowY = style.overflowY
        const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight
        if (isScrollable)
          return current
        current = current.parentElement as HTMLElement
      }
      return null
    }

    const root = findScrollRoot(el)
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting)
          tryEnsure()
      }
    }, { root, rootMargin: '200px' })

    io.observe(el)
    // @ts-expect-error store observer on element for cleanup
    el.__ensureUserAvatarObserver = io
  },
  /**
   * Disconnect the observer on unmount to avoid leaks.
   */
  unmounted(el: HTMLElement) {
    const io: IntersectionObserver | undefined = (el as any).__ensureUserAvatarObserver
    io?.disconnect()
  },
}
