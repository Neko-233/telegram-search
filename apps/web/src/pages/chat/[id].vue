<script setup lang="ts">
import type { CoreDialog, CoreMessage } from '@tg-search/core/types'

import { useBridge, useChatStore, useMessageStore, useSessionStore, useSettingsStore } from '@tg-search/client'
import { CoreEventType } from '@tg-search/core'
import { useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'

import EntityAvatar from '../../components/avatar/EntityAvatar.vue'
import SearchDialog from '../../components/SearchDialog.vue'
import SummaryDialog from '../../components/SummaryDialog.vue'
import VirtualMessageList from '../../components/VirtualMessageList.vue'

import { Button } from '../../components/ui/Button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/ContextMenu'
import { Input } from '../../components/ui/Input'
import { estimatePlaceholderPageLogicalHeight, useChatLayout } from '../../composables/use-chat-layout'
import { getChatLink } from '../../utils/telegram-links'

interface LoadedMessagePage {
  pageIndex: number
  minId: number
  maxId: number
  count: number
  messages: CoreMessage[]
  logicalHeight: number
  measuredHeight: number | null
  renderState: 'placeholder' | 'hydrated'
}

interface WorkspaceAnchor {
  itemKey: string
  itemType: 'separator' | 'message'
  messageUuid: string
  messageId: string
  pageIndex: number | null
  offsetWithinItem: number
}

interface WorkspaceProgressAnchor extends WorkspaceAnchor {
  scrollTop: number
  viewportSize: number
  workspaceHeight: number
  itemTop: number
  itemOffset: number
  offsetWithinPage: number
  offsetInWorkspace: number
  progressInWorkspace: number
}

const PAGE_WINDOW_SIZE = 2
const WORKSPACE_SHIFT_COOLDOWN_MS = 220
const OLDER_PLACEHOLDER_BUFFER_RATIO = 0.22
const USER_SCROLL_CANCEL_RESTORE_DELTA = 24

const { t } = useI18n()

const route = useRoute('/chat/:id')
const id = route.params.id

const chatStore = useChatStore()
const messageStore = useMessageStore()
const bridge = useBridge()
const { debugMode } = storeToRefs(useSettingsStore())
const { activeSessionId } = storeToRefs(useSessionStore())

const { sortedMessageIds, messageWindow, sortedMessageArray } = storeToRefs(messageStore)
const currentChat = computed<CoreDialog | undefined>(() => chatStore.getChat(id.toString()))
const chatTelegramLink = computed(() => {
  if (!currentChat.value)
    return null
  return getChatLink(currentChat.value)
})

const messageLimit = ref(100)
const messageOffset = ref(0)
const { isLoading: isLoadingMessages, fetchMessages } = messageStore.useFetchMessages(id.toString(), messageLimit.value)

const { height: windowHeight } = useWindowSize()

const isLoadingOlder = ref(false)
const isLoadingNewer = ref(false)
const canTriggerOlderAtTop = ref(false)
const canTriggerNewerAtBottom = ref(false)
const olderShiftLocked = ref(false)
const newerShiftLocked = ref(false)
const lastWorkspaceActionAt = ref(0)
const loadedPages = ref<LoadedMessagePage[]>([])
const pendingOlderPageIndexes = ref<number[]>([])
const visiblePageStart = ref(0)
const visiblePageEnd = ref(0)
const virtualListRef = ref<InstanceType<typeof VirtualMessageList>>()
const activeWorkspaceAnchor = ref<WorkspaceProgressAnchor | null>(null)

// @ts-expect-error: TODO: already used, fix it?
const searchDialogRef = ref<InstanceType<typeof SearchDialog> | null>(null)
const isGlobalSearchOpen = ref(false)

const messageInput = ref('')
const isContextMode = ref(false)
const isContextLoading = ref(false)

const targetMessageParams = computed(() => ({
  messageId: route.query.messageId as string | undefined,
  messageUuid: route.query.messageUuid as string | undefined,
}))

const displayedPages = computed(() => {
  if (isContextMode.value) {
    return []
  }

  if (loadedPages.value.length === 0) {
    return []
  }

  return loadedPages.value.slice(visiblePageStart.value, visiblePageEnd.value + 1)
})

const displayedMessagesWindow = ref<CoreMessage[]>([])
const previousDisplayedPageIndexes = ref<number[]>([])

const workspaceRenderSignature = computed(() => {
  if (isContextMode.value) {
    return `context:${sortedMessageIds.value.join(',')}`
  }

  return `pages:${displayedPages.value.map(page => `${page.pageIndex}:${page.minId}:${page.maxId}:${page.count}`).join('|')}`
})

const displayedMessages = computed(() => {
  if (isContextMode.value) {
    return sortedMessageArray.value
  }

  if (displayedPages.value.length === 0) {
    return sortedMessageArray.value
  }

  return displayedMessagesWindow.value
})

const placeholderMessageUuids = computed(() => {
  if (isContextMode.value) {
    return []
  }

  return displayedPages.value
    .filter(page => page.renderState === 'placeholder')
    .flatMap(page => page.messages.map(message => message.uuid))
})

const {
  layoutItems,
  pageMetrics: layoutPageMetrics,
  totalHeight: layoutTotalHeight,
  findLayoutItemByKey,
  findLayoutItemByMessageUuid,
  getPageMetric,
} = useChatLayout(displayedPages)

function workspacePageIndexes() {
  return displayedPages.value.map(page => page.pageIndex)
}

function findLoadedPage(pageIndex: number) {
  return loadedPages.value.find(page => page.pageIndex === pageIndex) ?? null
}

function markPagesHydrated(pageIndexes: number[], reason: string) {
  const pageIndexSet = new Set(pageIndexes)
  const hydratedPageIndexes: number[] = []

  loadedPages.value = loadedPages.value.map((page) => {
    if (!pageIndexSet.has(page.pageIndex) || page.renderState === 'hydrated') {
      return page
    }

    hydratedPageIndexes.push(page.pageIndex)
    return {
      ...page,
      renderState: 'hydrated',
    }
  })

  if (hydratedPageIndexes.length > 0) {
    console.info('[chat-page] page-hydration:update', {
      reason,
      hydratedPageIndexes,
      allHydratedPages: loadedPages.value.filter(page => page.renderState === 'hydrated').map(page => page.pageIndex),
    })
  }
}

function updateHydrationWindow(anchor: WorkspaceProgressAnchor | null, reason: string) {
  if (!anchor || anchor.pageIndex == null) {
    return
  }

  const anchorPage = findLoadedPage(anchor.pageIndex)
  if (!anchorPage) {
    return
  }

  const hydratePageIndexes = new Set<number>([anchor.pageIndex])
  const anchorPosition = findLoadedPagePosition(anchor.pageIndex)

  if (anchorPosition !== -1) {
    const newerNeighbor = loadedPages.value[anchorPosition + 1]
    if (newerNeighbor) {
      hydratePageIndexes.add(newerNeighbor.pageIndex)
    }

    const olderNeighbor = loadedPages.value[anchorPosition - 1]
    const pageProgress = anchor.offsetWithinPage / Math.max(anchorPage.logicalHeight, 1)
    const allowOlderBufferHydration = reason === 'scroll'
    if (allowOlderBufferHydration && olderNeighbor && pageProgress <= OLDER_PLACEHOLDER_BUFFER_RATIO) {
      hydratePageIndexes.add(olderNeighbor.pageIndex)
    }
  }

  markPagesHydrated([...hydratePageIndexes], reason)
}

function captureWorkspaceAnchor(reason: string, shouldLog = true): WorkspaceProgressAnchor | null {
  const anchor = virtualListRef.value?.captureLayoutAnchor()
  if (!anchor) {
    if (shouldLog) {
      console.info('[chat-page] workspace-anchor:capture-miss', { reason })
    }
    return null
  }

  const scrollMetrics = virtualListRef.value?.getScrollMetrics()
  if (!scrollMetrics) {
    if (shouldLog) {
      console.info('[chat-page] workspace-anchor:capture-miss', { reason, cause: 'scroll-metrics' })
    }
    return null
  }

  const layoutItem = findLayoutItemByKey(anchor.itemKey)
    ?? (anchor.messageUuid ? findLayoutItemByMessageUuid(anchor.messageUuid) : null)
  if (!layoutItem) {
    if (shouldLog) {
      console.info('[chat-page] workspace-anchor:capture-miss', {
        reason,
        cause: 'layout-item',
        messageUuid: anchor.messageUuid,
      })
    }
    return null
  }

  const pageIndex = layoutItem.pageIndex
  const pageMetric = getPageMetric(pageIndex)
  if (!pageMetric) {
    if (shouldLog) {
      console.info('[chat-page] workspace-anchor:capture-miss', {
        reason,
        cause: 'page-metric',
        itemKey: anchor.itemKey,
        itemType: anchor.itemType,
        messageUuid: anchor.messageUuid,
        pageIndex,
      })
    }
    return null
  }

  const offsetWithinPage = layoutItem.top - pageMetric.top + anchor.offsetWithinItem
  const offsetInWorkspace = layoutItem.top + anchor.offsetWithinItem
  const workspaceHeight = Math.max(layoutTotalHeight.value, 1)

  const workspaceAnchor: WorkspaceProgressAnchor = {
    itemKey: anchor.itemKey,
    itemType: anchor.itemType,
    messageUuid: anchor.messageUuid,
    messageId: anchor.messageId,
    pageIndex,
    offsetWithinItem: anchor.offsetWithinItem,
    scrollTop: scrollMetrics.scrollTop,
    viewportSize: scrollMetrics.viewportSize,
    workspaceHeight,
    itemTop: layoutItem.top,
    itemOffset: anchor.itemOffset,
    offsetWithinPage,
    offsetInWorkspace,
    progressInWorkspace: offsetInWorkspace / workspaceHeight,
  }

  if (shouldLog) {
    console.info('[chat-page] workspace-progress:capture', {
      reason,
      workspace: workspacePageIndexes(),
      ...workspaceAnchor,
    })
  }

  activeWorkspaceAnchor.value = workspaceAnchor
  return workspaceAnchor
}

async function restoreWorkspaceAnchor(
  reason: string,
  anchor: WorkspaceProgressAnchor | null,
  fromWorkspace: number[],
) {
  if (!anchor) {
    return
  }

  const layoutItem = findLayoutItemByKey(anchor.itemKey)
    ?? (anchor.messageUuid ? findLayoutItemByMessageUuid(anchor.messageUuid) : null)
  if (!layoutItem) {
    console.info('[chat-page] workspace-progress:restore-miss', {
      reason,
      cause: 'layout-item',
      itemKey: anchor.itemKey,
      messageUuid: anchor.messageUuid,
    })
    return
  }

  const pageMetric = getPageMetric(layoutItem.pageIndex)
  if (!pageMetric) {
    console.info('[chat-page] workspace-progress:restore-miss', {
      reason,
      cause: 'page-metric',
      messageUuid: anchor.messageUuid,
      pageIndex: layoutItem.pageIndex,
    })
    return
  }

  const nextOffsetInWorkspace = layoutItem.top + anchor.offsetWithinItem
  const nextWorkspaceHeight = Math.max(layoutTotalHeight.value, 1)
  const nextProgressInWorkspace = nextOffsetInWorkspace / nextWorkspaceHeight
  const restoreDebug = await virtualListRef.value?.restoreLayoutAnchor(anchor)

  console.info('[chat-page] workspace-progress:map', {
    reason,
    fromWorkspace,
    toWorkspace: workspacePageIndexes(),
    anchorMessageId: anchor.messageId,
    anchorMessageUuid: anchor.messageUuid,
    anchorPageIndex: layoutItem.pageIndex,
    offsetWithinPage: layoutItem.top - pageMetric.top + anchor.offsetWithinItem,
    previousOffsetInWorkspace: anchor.offsetInWorkspace,
    previousProgressInWorkspace: anchor.progressInWorkspace,
    nextOffsetInWorkspace,
    nextProgressInWorkspace,
    previousWorkspaceHeight: anchor.workspaceHeight,
    nextWorkspaceHeight,
    previousItemOffset: anchor.itemOffset,
    nextItemOffset: restoreDebug?.nextItemOffset ?? null,
    itemOffsetDelta: restoreDebug?.delta ?? null,
  })

  console.info('[chat-page] workspace-progress:apply', {
    reason,
    targetScrollTop: restoreDebug?.targetOffset ?? nextOffsetInWorkspace,
    messageUuid: anchor.messageUuid,
    messageId: anchor.messageId,
    pageIndex: layoutItem.pageIndex,
    offsetWithinItem: anchor.offsetWithinItem,
  })

  const appliedAnchor: WorkspaceProgressAnchor = {
    ...anchor,
    pageIndex: layoutItem.pageIndex,
    workspaceHeight: nextWorkspaceHeight,
    itemTop: layoutItem.top,
    itemOffset: restoreDebug?.nextItemOffset ?? anchor.itemOffset,
    offsetWithinPage: layoutItem.top - pageMetric.top + anchor.offsetWithinItem,
    offsetInWorkspace: nextOffsetInWorkspace,
    progressInWorkspace: nextProgressInWorkspace,
    scrollTop: restoreDebug?.targetOffset ?? nextOffsetInWorkspace,
  }

  activeWorkspaceAnchor.value = appliedAnchor
  updateHydrationWindow(appliedAnchor, `${reason}-apply`)
}

function syncDisplayedMessagesWindow(reason: string) {
  const nextPages = displayedPages.value
  const nextPageIndexes = nextPages.map(page => page.pageIndex)
  const previousPageIndexes = previousDisplayedPageIndexes.value

  if (isContextMode.value) {
    displayedMessagesWindow.value = sortedMessageArray.value
    previousDisplayedPageIndexes.value = []
    return
  }

  if (nextPages.length === 0) {
    displayedMessagesWindow.value = []
    previousDisplayedPageIndexes.value = []
    return
  }

  const previousMessagesById = new Map(
    displayedMessagesWindow.value.map(message => [message.platformMessageId, message]),
  )

  const nextMessages = nextPages.flatMap((page) => {
    return page.messages.map((message) => {
      return previousMessagesById.get(message.platformMessageId) ?? message
    })
  })

  const nextMessageIds = nextMessages.map(message => message.platformMessageId)
  const currentMessageIds = displayedMessagesWindow.value.map(message => message.platformMessageId)

  if (
    previousPageIndexes.length === nextPageIndexes.length
    && previousPageIndexes.every((pageIndex, index) => pageIndex === nextPageIndexes[index])
    && currentMessageIds.length === nextMessageIds.length
    && currentMessageIds.every((messageId, index) => messageId === nextMessageIds[index])
  ) {
    return
  }

  const previousPageSet = new Set(previousPageIndexes)
  const reusedPageIndexes = nextPageIndexes.filter(pageIndex => previousPageSet.has(pageIndex))
  const prependedPageIndexes = nextPageIndexes.filter(pageIndex => !previousPageSet.has(pageIndex) && pageIndex > Math.max(...previousPageIndexes, -Infinity))
  const appendedPageIndexes = nextPageIndexes.filter(pageIndex => !previousPageSet.has(pageIndex) && pageIndex < Math.min(...previousPageIndexes, Infinity))
  const reusedMessageCount = nextMessages.filter(message => previousMessagesById.has(message.platformMessageId)).length

  displayedMessagesWindow.value = nextMessages
  previousDisplayedPageIndexes.value = nextPageIndexes

  console.info('[chat-page] workspace-render:diff', {
    reason,
    fromWorkspace: previousPageIndexes,
    toWorkspace: nextPageIndexes,
    reusedPageIndexes,
    prependedPageIndexes,
    appendedPageIndexes,
    reusedMessageCount,
    totalMessageCount: nextMessages.length,
  })
}

watch(
  () => workspaceRenderSignature.value,
  () => {
    syncDisplayedMessagesWindow('workspace-update')
  },
  { immediate: true },
)

function logWorkspaceState(reason: string) {
  console.info('[chat-page] workspace:state', {
    reason,
    visible: [visiblePageStart.value, visiblePageEnd.value],
    loadedPageIndexes: loadedPages.value.map(page => page.pageIndex),
    workspacePageIndexes: workspacePageIndexes(),
  })
}

function logWorkspaceLocks(reason: string) {
  console.info('[chat-page] workspace:lock-state', {
    reason,
    olderArmed: canTriggerOlderAtTop.value,
    newerArmed: canTriggerNewerAtBottom.value,
    olderLocked: olderShiftLocked.value,
    newerLocked: newerShiftLocked.value,
  })
}

function isWorkspaceShiftCoolingDown() {
  return Date.now() - lastWorkspaceActionAt.value < WORKSPACE_SHIFT_COOLDOWN_MS
}

function clampVisiblePageWindow() {
  if (loadedPages.value.length === 0) {
    visiblePageStart.value = 0
    visiblePageEnd.value = 0
    return
  }

  visiblePageStart.value = Math.max(0, Math.min(visiblePageStart.value, loadedPages.value.length - 1))
  visiblePageEnd.value = Math.max(
    visiblePageStart.value,
    Math.min(visiblePageEnd.value, loadedPages.value.length - 1),
  )
}

function findLoadedPagePosition(pageIndex: number) {
  return loadedPages.value.findIndex(page => page.pageIndex === pageIndex)
}

function syncVisibleWindowToPageIndexes(targetPageIndexes: number[], desiredWindowSize = PAGE_WINDOW_SIZE) {
  if (loadedPages.value.length === 0) {
    visiblePageStart.value = 0
    visiblePageEnd.value = 0
    return
  }

  const targetPositions = Array.from(
    new Set(targetPageIndexes.map(findLoadedPagePosition).filter(position => position >= 0)),
  ).sort((a, b) => a - b)

  if (targetPositions.length === 0) {
    clampVisiblePageWindow()
    return
  }

  let start = targetPositions[0]
  let end = targetPositions[targetPositions.length - 1]

  if (end - start + 1 < desiredWindowSize && loadedPages.value.length > 1) {
    if (end < loadedPages.value.length - 1) {
      end += 1
    }
    else if (start > 0) {
      start -= 1
    }
  }

  visiblePageStart.value = start
  visiblePageEnd.value = Math.min(loadedPages.value.length - 1, Math.max(end, start))
}

function syncVisibleWindowToNewestPages() {
  if (loadedPages.value.length === 0) {
    visiblePageStart.value = 0
    visiblePageEnd.value = 0
    return
  }

  const newestPageIndexes = loadedPages.value
    .slice(-PAGE_WINDOW_SIZE)
    .map(page => page.pageIndex)

  syncVisibleWindowToPageIndexes(newestPageIndexes)
}

function queuePendingOlderPage(pageIndex: number) {
  if (pendingOlderPageIndexes.value.includes(pageIndex)) {
    return
  }

  pendingOlderPageIndexes.value = [...pendingOlderPageIndexes.value, pageIndex].sort((a, b) => a - b)
  console.info('[chat-page] older-load:queue-pending', {
    pageIndex,
    pendingOlderPageIndexes: pendingOlderPageIndexes.value,
  })
}

function consumePendingOlderPage(pageIndex: number) {
  if (!pendingOlderPageIndexes.value.includes(pageIndex)) {
    return
  }

  pendingOlderPageIndexes.value = pendingOlderPageIndexes.value.filter(index => index !== pageIndex)
  console.info('[chat-page] older-load:consume-pending', {
    pageIndex,
    pendingOlderPageIndexes: pendingOlderPageIndexes.value,
  })
}

async function revealPendingOlderPage() {
  if (pendingOlderPageIndexes.value.length === 0 || displayedPages.value.length === 0) {
    return false
  }

  const currentTopPageIndex = displayedPages.value[0]?.pageIndex
  if (currentTopPageIndex == null) {
    return false
  }

  const nextPendingPageIndex = pendingOlderPageIndexes.value
    .filter(pageIndex => pageIndex > currentTopPageIndex)
    .sort((a, b) => a - b)[0]

  if (nextPendingPageIndex == null) {
    return false
  }

  const workspaceAnchor = captureWorkspaceAnchor('reveal-pending-older')
  if (!workspaceAnchor || workspaceAnchor.pageIndex !== currentTopPageIndex) {
    console.info('[chat-page] older-load:skip-reveal-pending', {
      reason: 'anchor-not-in-overlap-page',
      currentTopPageIndex,
      anchorPageIndex: workspaceAnchor?.pageIndex ?? null,
      pendingOlderPageIndexes: pendingOlderPageIndexes.value,
    })
    return false
  }

  const fromWorkspace = workspacePageIndexes()
  syncVisibleWindowToPageIndexes([nextPendingPageIndex, currentTopPageIndex])
  syncDisplayedMessagesWindow('reveal-pending-older')
  consumePendingOlderPage(nextPendingPageIndex)
  await restoreWorkspaceAnchor('reveal-pending-older', workspaceAnchor, fromWorkspace)
  logWorkspaceState('reveal-pending-older')
  return true
}

function shiftVisiblePageWindow(direction: 'older' | 'newer') {
  if (loadedPages.value.length === 0) {
    return false
  }

  const fromVisible = [visiblePageStart.value, visiblePageEnd.value]
  const fromWorkspace = workspacePageIndexes()
  let workspaceAnchor: WorkspaceProgressAnchor | null = null

  if (direction === 'older') {
    if (visiblePageStart.value === 0) {
      return false
    }

    workspaceAnchor = captureWorkspaceAnchor(`shift-${direction}`)
    const overlapPageIndex = displayedPages.value[0]?.pageIndex ?? null
    if (!workspaceAnchor || workspaceAnchor.pageIndex !== overlapPageIndex) {
      console.info('[chat-page] page-window:skip-shift-older', {
        reason: 'anchor-not-in-overlap-page',
        overlapPageIndex,
        anchorPageIndex: workspaceAnchor?.pageIndex ?? null,
        workspace: fromWorkspace,
      })
      return false
    }

    visiblePageStart.value -= 1
    visiblePageEnd.value = Math.max(visiblePageStart.value, visiblePageEnd.value - 1)
  }
  else {
    if (visiblePageEnd.value >= loadedPages.value.length - 1) {
      return false
    }

    workspaceAnchor = captureWorkspaceAnchor(`shift-${direction}`)
    const overlapPageIndex = displayedPages.value[displayedPages.value.length - 1]?.pageIndex ?? null
    if (!workspaceAnchor || workspaceAnchor.pageIndex !== overlapPageIndex) {
      console.info('[chat-page] page-window:skip-shift-newer', {
        reason: 'anchor-not-in-overlap-page',
        overlapPageIndex,
        anchorPageIndex: workspaceAnchor?.pageIndex ?? null,
        workspace: fromWorkspace,
      })
      return false
    }

    visiblePageStart.value += 1
    visiblePageEnd.value = Math.min(loadedPages.value.length - 1, visiblePageEnd.value + 1)
  }

  lastWorkspaceActionAt.value = Date.now()
  console.info(`[chat-page] page-window:shift-${direction}`, {
    from: fromVisible,
    to: [visiblePageStart.value, visiblePageEnd.value],
    pageIndexes: workspacePageIndexes(),
  })
  syncDisplayedMessagesWindow(`shift-${direction}`)
  logWorkspaceState(`shift-${direction}`)
  void restoreWorkspaceAnchor(`shift-${direction}`, workspaceAnchor, fromWorkspace)
  return true
}

function upsertLoadedPage(page: LoadedMessagePage) {
  const previousWorkspace = workspacePageIndexes()
  const nextPages = loadedPages.value.filter(existingPage => existingPage.pageIndex !== page.pageIndex)
  nextPages.push(page)
  nextPages.sort((a, b) => b.pageIndex - a.pageIndex)
  loadedPages.value = nextPages

  if (previousWorkspace.length === 0 && loadedPages.value.length === 1) {
    visiblePageStart.value = 0
    visiblePageEnd.value = 0
  }
  else if (previousWorkspace.length > 0) {
    syncVisibleWindowToPageIndexes(previousWorkspace, previousWorkspace.length)
  }
  else {
    syncVisibleWindowToPageIndexes([page.pageIndex], 1)
  }
  logWorkspaceState('upsert-page')
}

function buildLoadedPage(pageIndex: number, messages: CoreMessage[]): LoadedMessagePage | null {
  const dedupedMessages = Array.from(
    new Map(messages.map(message => [message.platformMessageId, message])).values(),
  ).sort((a, b) => Number(a.platformMessageId) - Number(b.platformMessageId))

  const pageIds = dedupedMessages
    .map(message => Number(message.platformMessageId))
    .filter(id => Number.isFinite(id))

  if (pageIds.length === 0) {
    return null
  }

  return {
    pageIndex,
    minId: pageIds[0],
    maxId: pageIds[pageIds.length - 1],
    count: dedupedMessages.length,
    messages: dedupedMessages,
    logicalHeight: estimatePlaceholderPageLogicalHeight(dedupedMessages),
    measuredHeight: null,
    renderState: 'placeholder',
  }
}

// Header avatar is rendered via ChatAvatar wrapper

// Use ChatAvatar wrapper to handle ensure and rendering

// Initial load when component mounts
onMounted(async () => {
  const initialMessageId = targetMessageParams.value.messageId

  if (typeof initialMessageId === 'string' && initialMessageId.length > 0) {
    await openMessageContext(initialMessageId, targetMessageParams.value.messageUuid)
  }

  // Only load if there are no messages yet and we are not in context mode
  if (!isContextMode.value && sortedMessageIds.value.length === 0) {
    await loadOlderMessages()
    syncVisibleWindowToNewestPages()
    logWorkspaceState('mounted-initial-load')
  }
})

// When switching accounts while staying on the same chat route, reset the
// message window and load the dialog history for the new account.
watch(
  () => activeSessionId.value,
  async () => {
    // If we don't have a chat id (should not happen here) or component
    // is still mounting, just bail out.
    if (!id)
      return

    isContextMode.value = false
    resetPagination()
    messageStore.replaceMessages([], { chatId: id.toString(), limit: messageLimit.value })
    await loadOlderMessages()
    syncVisibleWindowToNewestPages()
    logWorkspaceState('session-switch')
  },
)

// Load older messages when scrolling to top
async function loadOlderMessages() {
  if (isContextMode.value)
    return
  if (isLoadingOlder.value || isLoadingMessages.value)
    return

  const pageIndex = Math.floor(messageOffset.value / messageLimit.value)
  const triggerMessage = sortedMessageArray.value[0]
  const triggerMessageId = triggerMessage?.platformMessageId ?? triggerMessage?.uuid ?? null
  const workspaceAnchor = captureWorkspaceAnchor('older-load')
  const fromWorkspace = workspacePageIndexes()
  messageStore.ensureWindowCapacity((loadedPages.value.length + PAGE_WINDOW_SIZE + 1) * messageLimit.value)

  console.info('[chat-page] older-load:start', {
    pageIndex,
    offset: messageOffset.value,
    limit: messageLimit.value,
    triggerMessageId,
  })

  isLoadingOlder.value = true

  try {
    const response = await fetchMessages({
      offset: messageOffset.value,
      limit: messageLimit.value,
    }, 'older')

    const fetchedMessages = response?.messages ?? []
    const nextPage = buildLoadedPage(pageIndex, fetchedMessages)

    console.info('[chat-page] older-load:fetched', {
      pageIndex,
      count: fetchedMessages.length,
      ids: fetchedMessages.length > 0
        ? [fetchedMessages[0].platformMessageId, fetchedMessages[fetchedMessages.length - 1].platformMessageId]
        : null,
    })

    // Advance the request cursor as soon as this batch is resolved so
    // layout/restore issues can't cause the same page to be fetched again.
    messageOffset.value += messageLimit.value
    console.info('[chat-page] older-load:offset-advance', {
      pageIndex,
      nextOffset: messageOffset.value,
    })

    if (nextPage) {
      upsertLoadedPage(nextPage)
      if (!workspaceAnchor) {
        markPagesHydrated([nextPage.pageIndex], 'initial-page')
        syncVisibleWindowToPageIndexes([nextPage.pageIndex], 1)
      }
      else {
        const currentScrollMetrics = virtualListRef.value?.getScrollMetrics()
        const scrollTopDelta = (currentScrollMetrics?.scrollTop ?? workspaceAnchor.scrollTop) - workspaceAnchor.scrollTop
        const didUserMoveDuringFetch = scrollTopDelta > USER_SCROLL_CANCEL_RESTORE_DELTA

        queuePendingOlderPage(nextPage.pageIndex)
        console.info('[chat-page] older-load:defer-visibility', {
          pageIndex,
          anchorScrollTop: workspaceAnchor.scrollTop,
          currentScrollTop: currentScrollMetrics?.scrollTop ?? null,
          scrollTopDelta,
          workspace: workspacePageIndexes(),
          pendingOlderPageIndexes: pendingOlderPageIndexes.value,
          didUserMoveDuringFetch,
        })
      }

      console.info('[chat-page] older-load:page', nextPage)
      console.info('[chat-page] older-load:done', {
        fromWorkspace,
        visible: [visiblePageStart.value, visiblePageEnd.value],
        pages: loadedPages.value.map(page => `${page.pageIndex}:${page.minId}-${page.maxId}`),
        pageHeights: layoutPageMetrics.value.map(metric => `${metric.pageIndex}:${metric.logicalHeight}`),
        layoutTotalHeight: layoutTotalHeight.value,
      })
      logWorkspaceState('older-load-done')
      updateHydrationWindow(activeWorkspaceAnchor.value, 'older-load-done')
    }
    else {
      console.info('[chat-page] older-load:empty-page', {
        pageIndex,
        offset: messageOffset.value,
        limit: messageLimit.value,
      })
    }
    canTriggerOlderAtTop.value = false
  }
  finally {
    isLoadingOlder.value = false
  }
}

// Load newer messages when scrolling to bottom
async function loadNewerMessages() {
  if (isContextMode.value)
    return
  if (isLoadingNewer.value || isLoadingMessages.value)
    return

  // Get the current max message ID to fetch messages after it
  const currentMaxId = messageWindow.value?.maxId
  if (!currentMaxId || currentMaxId === -Infinity) {
    console.warn('No messages loaded yet, cannot fetch newer messages')
    return
  }

  isLoadingNewer.value = true

  try {
    // Use a separate fetch function for newer messages with minId
    await fetchMessages(
      {
        offset: 0,
        limit: messageLimit.value,
        minId: currentMaxId,
      },
      'newer',
    )
  }
  finally {
    isLoadingNewer.value = false
  }
}

// Handle virtual list scroll events
async function handleVirtualListScroll({
  isAtTop,
  isAtBottom,
}: {
  scrollTop: number
  isAtTop: boolean
  isAtBottom: boolean
}) {
  const scrollAnchor = captureWorkspaceAnchor('scroll', false)
  if (scrollAnchor) {
    updateHydrationWindow(scrollAnchor, 'scroll')
  }

  if (!isAtTop) {
    canTriggerOlderAtTop.value = true
    if (olderShiftLocked.value) {
      olderShiftLocked.value = false
      logWorkspaceLocks('unlock-older')
    }
  }

  if (!isAtBottom) {
    canTriggerNewerAtBottom.value = true
    if (newerShiftLocked.value) {
      newerShiftLocked.value = false
      logWorkspaceLocks('unlock-newer')
    }
  }

  if (isAtTop && canTriggerOlderAtTop.value && !isLoadingOlder.value && !isLoadingMessages.value && !olderShiftLocked.value) {
    if (!isWorkspaceShiftCoolingDown()) {
      const revealedPendingOlder = pendingOlderPageIndexes.value.length > 0
        ? await revealPendingOlderPage()
        : false
      if (revealedPendingOlder) {
        olderShiftLocked.value = true
        newerShiftLocked.value = true
        logWorkspaceLocks('lock-after-reveal-pending-older')
      }
      else {
        const shifted = shiftVisiblePageWindow('older')
        if (shifted) {
          olderShiftLocked.value = true
          newerShiftLocked.value = true
          logWorkspaceLocks('lock-after-shift-older')
        }
        else {
          loadOlderMessages()
        }
      }
    }
    canTriggerOlderAtTop.value = false
  }

  if (isAtBottom && canTriggerNewerAtBottom.value && !isLoadingNewer.value && !isLoadingMessages.value && !newerShiftLocked.value) {
    if (!isWorkspaceShiftCoolingDown() && shiftVisiblePageWindow('newer')) {
      olderShiftLocked.value = true
      newerShiftLocked.value = true
      logWorkspaceLocks('lock-after-shift-newer')
      canTriggerNewerAtBottom.value = false
    }
  }
}

function sendMessage() {
  if (!messageInput.value.trim())
    return

  bridge.sendEvent(CoreEventType.MessageSend, {
    chatId: id.toString(),
    content: messageInput.value,
  })
  messageInput.value = ''

  toast.success(t('chat.messageSent'))
}

function openTelegram() {
  if (chatTelegramLink.value) {
    window.open(chatTelegramLink.value, '_self')
  }
}

function resetPagination() {
  messageOffset.value = 0
  canTriggerOlderAtTop.value = false
  canTriggerNewerAtBottom.value = false
  olderShiftLocked.value = false
  newerShiftLocked.value = false
  lastWorkspaceActionAt.value = 0
  loadedPages.value = []
  pendingOlderPageIndexes.value = []
  visiblePageStart.value = 0
  visiblePageEnd.value = 0
}

async function openMessageContext(messageId: string, messageUuid?: string) {
  if (!messageId || isContextLoading.value)
    return

  isContextLoading.value = true
  isContextMode.value = true
  resetPagination()

  try {
    const messages = await messageStore.loadMessageContext(id.toString(), messageId, {
      before: 40,
      after: 40,
      limit: messageLimit.value,
    })

    if (messages.length === 0) {
      isContextMode.value = false
      toast.warning(t('search.noRelatedMessages'))
      await loadOlderMessages()
      return
    }

    await nextTick()

    const targetUuid = messageUuid
      ?? messages.find((msg: CoreMessage) => msg.platformMessageId === messageId)?.uuid

    if (targetUuid) {
      await nextTick()
      virtualListRef.value?.scrollToMessage(targetUuid)
    }
  }
  finally {
    isContextLoading.value = false
  }
}

watch(
  () => [targetMessageParams.value.messageId, targetMessageParams.value.messageUuid],
  async ([newMessageId, newMessageUuid], [oldMessageId]) => {
    if (newMessageId === oldMessageId)
      return

    if (typeof newMessageId === 'string' && newMessageId.length > 0) {
      await openMessageContext(newMessageId, typeof newMessageUuid === 'string' ? newMessageUuid : undefined)
    }
    else if (oldMessageId) {
      isContextMode.value = false
      resetPagination()
      messageStore.replaceMessages([], { chatId: id.toString(), limit: messageLimit.value })
      await loadOlderMessages()
    }
  },
)
</script>

<template>
  <div class="relative h-full flex flex-col bg-background">
    <!-- Debug Panel -->
    <div v-if="debugMode" class="absolute right-4 top-24 z-10 w-1/4 flex flex-col justify-left gap-2 border rounded-lg bg-card p-2 text-sm text-muted-foreground font-mono shadow-lg">
      <span>
        Height: {{ windowHeight }} / Messages: {{ displayedMessages.length }}
      </span>
      <span>
        IDs: {{ displayedMessages[0]?.platformMessageId }} - {{ displayedMessages[displayedMessages.length - 1]?.platformMessageId }}
      </span>
      <span>
        MinId: {{ messageWindow?.minId }} / MaxId: {{ messageWindow?.maxId }}
      </span>
      <span>
        Loading: {{ isLoadingMessages }} / Older: {{ isLoadingOlder }} / Newer: {{ isLoadingNewer }}
      </span>
      <span>
        Offset: {{ messageOffset }}
      </span>
      <span>
        Pages: {{ loadedPages.map(page => page.pageIndex).join(', ') || 'none' }} / Visible: [{{ visiblePageStart }}, {{ visiblePageEnd }}]
      </span>
      <span>
        Layout Pages: {{ layoutPageMetrics.map(page => `${page.pageIndex}:${page.logicalHeight}`).join(', ') || 'none' }}
      </span>
      <span>
        Layout Items: {{ layoutItems.length }} / Layout Height: {{ layoutTotalHeight }}
      </span>
      <span>
        Placeholder Pages: {{ loadedPages.filter(page => page.renderState === 'placeholder').map(page => page.pageIndex).join(', ') || 'none' }}
      </span>
      <Button
        size="sm"
        :disabled="isLoadingOlder || isLoadingMessages"
        @click="loadOlderMessages"
      >
        {{ t('chat.forceLoadOlder') }}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        :disabled="isLoadingNewer || isLoadingMessages"
        @click="loadNewerMessages"
      >
        {{ t('chat.forceLoadNewer') }}
      </Button>
    </div>

    <!-- Chat Header -->
    <div class="sticky top-0 z-20 h-14 flex items-center justify-between gap-2 border-b bg-background/80 px-4 py-0 backdrop-blur-md md:h-16 supports-[backdrop-filter]:bg-background/60 md:px-6">
      <div class="min-w-0 flex flex-1 items-center gap-3">
        <ContextMenu v-if="currentChat && currentChat.id != null">
          <ContextMenuTrigger>
            <div :class="chatTelegramLink ? 'cursor-context-menu' : ''">
              <EntityAvatar
                :id="currentChat.id"
                entity="other"
                entity-type="chat"
                :file-id="currentChat?.avatarFileId"
                :name="currentChat?.name"
                size="md"
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent v-if="chatTelegramLink">
            <ContextMenuItem @select="openTelegram">
              <span class="i-lucide-external-link mr-2 h-4 w-4" />
              {{ t('messages.openInTelegram') }}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold">
            {{ currentChat?.name }}
          </h2>
          <p v-if="currentChat?.id" class="truncate text-xs text-muted-foreground">
            ID: {{ currentChat?.id }}
          </p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <SummaryDialog :chat-id="id.toString()">
          <template #default="{ open }">
            <Button
              icon="i-lucide-sparkles"
              variant="ghost"
              size="sm"
              @click="open"
            >
              {{ t('chat.summarize') }}
            </Button>
          </template>
        </SummaryDialog>
        <Button
          icon="i-lucide-search"
          variant="ghost"
          size="icon"
          class="h-9 w-9"
          :aria-label="t('chat.search')"
          :title="t('chat.search')"
          data-search-button
          @click="isGlobalSearchOpen = !isGlobalSearchOpen"
        />
      </div>
    </div>

    <div class="flex-1 overflow-hidden">
      <VirtualMessageList
        ref="virtualListRef"
        :messages="displayedMessages"
        :auto-scroll-to-bottom="!isContextMode"
        :show-loading-older="isLoadingOlder"
        :placeholder-message-uuids="placeholderMessageUuids"
        @scroll="handleVirtualListScroll"
      />
    </div>

    <!-- Message Input -->
    <div class="absolute bottom-6 left-0 right-0 z-20 px-4 md:bottom-6 md:px-6">
      <div class="mx-auto max-w-4xl flex items-end gap-3 border border-border/65 rounded-2xl bg-background/90 p-2 shadow-sm backdrop-blur-xl transition-all duration-200 focus-within:border-primary/35 hover:border-border focus-within:bg-background hover:bg-background focus-within:ring-2 focus-within:ring-primary/15">
        <!-- Input container with modern design -->
        <div class="relative flex flex-1 items-center">
          <div class="absolute left-2 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              class="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground"
              title="Emoji"
            >
              <span class="i-lucide-smile h-5 w-5" />
            </Button>
          </div>
          <Input
            v-model="messageInput"
            type="text"
            :placeholder="t('chat.typeAMessage')"
            class="h-10 w-full border-transparent bg-transparent pl-14 pr-14 text-base text-foreground shadow-none transition-all md:h-14 placeholder:text-foreground/45 focus-visible:ring-0"
            @keyup.enter="sendMessage"
          />
          <div class="absolute right-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-10 w-10 rounded-full text-muted-foreground hover:text-foreground"
              title="Attachment"
            >
              <span class="i-lucide-paperclip h-5 w-5" />
            </Button>
          </div>
        </div>

        <!-- Send button with modern design -->
        <Button
          :disabled="!messageInput.trim()"
          size="icon"
          class="h-10 w-10 shrink-0 rounded-xl shadow-sm transition-transform md:h-14 md:w-14 active:scale-95 hover:scale-105"
          @click="sendMessage"
        >
          <span class="i-lucide-send ml-0.5 mt-0.5 h-5 w-5 md:h-6 md:w-6" />
        </Button>
      </div>
    </div>

    <Teleport to="body">
      <SearchDialog
        ref="searchDialogRef"
        v-model:open="isGlobalSearchOpen"
        :chat-id="id.toString()"
      >
        <template #settings>
          <div class="flex items-center">
            <input id="searchContent" type="checkbox" class="mr-1 border-border rounded">
            <label for="searchContent" class="text-sm text-gray-900 dark:text-gray-100">{{ t('chat.searchContent') }}</label>
          </div>
        </template>
      </SearchDialog>
    </Teleport>
  </div>
</template>
