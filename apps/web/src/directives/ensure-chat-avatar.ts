import type { DirectiveBinding } from 'vue'

import { prefillChatAvatarIntoStore, useAvatarStore } from '@tg-search/client'

interface EnsureChatAvatarPayload { chatId: string | number, fileId?: string }

/**
 * v-ensure-chat-avatar: When the bound element enters viewport, ensure the chat avatar is loaded.
 * - Prefills from IndexedDB if possible
 * - Triggers prioritized fetch via websocket if still missing
 */
export const ensureChatAvatarDirective = {
  /**
   * Observe element entering viewport and ensure its chat avatar is present.
   * - Prefills from IndexedDB first
   * - Triggers prioritized fetch if still missing
   */
  mounted(el: HTMLElement, binding: DirectiveBinding<EnsureChatAvatarPayload>) {
    const payload = binding.value
    if (!payload)
      return

    const { chatId, fileId } = payload
    const avatarStore = useAvatarStore()

    const tryEnsure = async () => {
      try {
        const valid = avatarStore.hasValidChatAvatar(String(chatId), fileId)
        if (valid)
          return
        await prefillChatAvatarIntoStore(String(chatId))
        const stillMissing = !avatarStore.hasValidChatAvatar(String(chatId), fileId)
        if (stillMissing)
          avatarStore.ensureChatAvatar(String(chatId), fileId)
      }
      catch {
        avatarStore.ensureChatAvatar(String(chatId), fileId)
      }
    }

    /**
     * Find nearest scrollable ancestor to use as observer root.
     * Ensures visibility detection aligns with the virtual list container.
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
        if (entry.isIntersecting) {
          tryEnsure()
        }
      }
    }, { root, rootMargin: '200px' })

    io.observe(el)
    // @ts-expect-error store observer on element for cleanup
    el.__ensureAvatarObserver = io
  },
  /**
   * Disconnect IntersectionObserver when element is unmounted
   * to avoid leaks and unnecessary work.
   */
  unmounted(el: HTMLElement) {
    // @ts-expect-error retrieve observer for cleanup
    const io: IntersectionObserver | undefined = el.__ensureAvatarObserver
    io?.disconnect()
  },
}
