import type { CoreMessage } from '@tg-search/core/types'
import type { MaybeRefOrGetter } from 'vue'

import { computed, toValue } from 'vue'

export interface ChatLayoutPageInput {
  pageIndex: number
  messages: CoreMessage[]
  renderState?: 'placeholder' | 'hydrated'
}

export interface ChatLayoutItem {
  key: string
  type: 'message' | 'separator'
  pageIndex: number
  messageId?: string
  message?: CoreMessage
  label?: string
  estimatedHeight: number
  measuredHeight: number | null
  top: number
  bottom: number
  renderMode: 'placeholder' | 'hydrated'
  layoutMode: 'stable' | 'measured'
}

export interface ChatLayoutPageMetrics {
  pageIndex: number
  itemCount: number
  logicalHeight: number
  top: number
  bottom: number
}

function toDayKey(timestamp: number) {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function estimateTextLineCount(message: CoreMessage) {
  const text = message.content ?? ''
  const hardBreakLines = text.split('\n')

  return hardBreakLines.reduce((lineCount, line) => {
    return lineCount + Math.max(1, Math.ceil(line.length / 22))
  }, 0)
}

export function estimateMessageLogicalHeight(message: CoreMessage) {
  const textLineCount = estimateTextLineCount(message)
  const baseHeight = 44
  const textHeight = Math.min(6, textLineCount) * 20
  const senderAllowance = message.fromId !== message.chatId ? 18 : 0

  // NOTICE: We intentionally over-estimate media to keep off-screen layout stable.
  const mediaHeight = message.mediaFileId ? 220 : 0

  return baseHeight + textHeight + senderAllowance + mediaHeight
}

export function estimatePlaceholderMessageLogicalHeight(message: CoreMessage, isGroupedWithPrevious = false) {
  const baseHeight = estimateMessageLogicalHeight(message)
  const conservativePadding = message.mediaFileId ? 56 : 32
  const groupedPadding = isGroupedWithPrevious ? 12 : 28

  return baseHeight + conservativePadding + groupedPadding
}

export function estimatePageLogicalHeight(messages: CoreMessage[]) {
  let totalHeight = 0
  let lastDayKey = ''

  for (const message of messages) {
    const dayKey = toDayKey(message.platformTimestamp)
    if (dayKey !== lastDayKey) {
      totalHeight += 40
      lastDayKey = dayKey
    }

    totalHeight += estimateMessageLogicalHeight(message)
  }

  return totalHeight
}

export function estimatePlaceholderPageLogicalHeight(messages: CoreMessage[]) {
  let totalHeight = 0
  let lastDayKey = ''
  let previousMessage: CoreMessage | undefined

  for (const message of messages) {
    const dayKey = toDayKey(message.platformTimestamp)
    if (dayKey !== lastDayKey) {
      totalHeight += 48
      lastDayKey = dayKey
      previousMessage = undefined
    }

    const isGroupedWithPrevious = !!previousMessage
      && previousMessage.fromId === message.fromId
      && Math.abs(previousMessage.platformTimestamp - message.platformTimestamp) <= 5 * 60

    totalHeight += estimatePlaceholderMessageLogicalHeight(message, isGroupedWithPrevious)
    previousMessage = message
  }

  return totalHeight
}

export function useChatLayout(pages: MaybeRefOrGetter<ChatLayoutPageInput[]>) {
  const layoutItems = computed<ChatLayoutItem[]>(() => {
    const resolvedPages = toValue(pages)
    const items: ChatLayoutItem[] = []
    let currentTop = 0
    let lastDayKey = ''

    for (const page of resolvedPages) {
      let previousMessage: CoreMessage | undefined

      for (const message of page.messages) {
        const dayKey = toDayKey(message.platformTimestamp)
        const isPlaceholderPage = page.renderState === 'placeholder'

        if (dayKey !== lastDayKey) {
          const separatorHeight = isPlaceholderPage ? 48 : 40
          items.push({
            key: `separator:${dayKey}:${message.uuid}`,
            type: 'separator',
            pageIndex: page.pageIndex,
            label: dayKey,
            estimatedHeight: separatorHeight,
            measuredHeight: null,
            top: currentTop,
            bottom: currentTop + separatorHeight,
            renderMode: isPlaceholderPage ? 'placeholder' : 'hydrated',
            layoutMode: 'stable',
          })
          currentTop += separatorHeight
          lastDayKey = dayKey
          previousMessage = undefined
        }

        const isGroupedWithPrevious = !!previousMessage
          && previousMessage.fromId === message.fromId
          && Math.abs(previousMessage.platformTimestamp - message.platformTimestamp) <= 5 * 60
        const estimatedHeight = isPlaceholderPage
          ? estimatePlaceholderMessageLogicalHeight(message, isGroupedWithPrevious)
          : estimateMessageLogicalHeight(message)
        items.push({
          key: `message:${page.pageIndex}:${message.uuid}`,
          type: 'message',
          pageIndex: page.pageIndex,
          messageId: message.platformMessageId,
          message,
          estimatedHeight,
          measuredHeight: null,
          top: currentTop,
          bottom: currentTop + estimatedHeight,
          renderMode: isPlaceholderPage ? 'placeholder' : 'hydrated',
          layoutMode: 'stable',
        })
        currentTop += estimatedHeight
        previousMessage = message
      }
    }

    return items
  })

  const pageMetrics = computed<ChatLayoutPageMetrics[]>(() => {
    const metrics = new Map<number, ChatLayoutPageMetrics>()

    for (const item of layoutItems.value) {
      const existingMetric = metrics.get(item.pageIndex)
      if (!existingMetric) {
        metrics.set(item.pageIndex, {
          pageIndex: item.pageIndex,
          itemCount: 1,
          logicalHeight: item.bottom - item.top,
          top: item.top,
          bottom: item.bottom,
        })
        continue
      }

      existingMetric.itemCount += 1
      existingMetric.bottom = item.bottom
      existingMetric.logicalHeight = existingMetric.bottom - existingMetric.top
    }

    return Array.from(metrics.values()).sort((a, b) => b.pageIndex - a.pageIndex)
  })

  const pageMetricsByIndex = computed(() => {
    return new Map(pageMetrics.value.map(metric => [metric.pageIndex, metric]))
  })

  const totalHeight = computed(() => {
    const items = layoutItems.value
    return items.length > 0 ? items[items.length - 1].bottom : 0
  })

  function findLayoutItemByMessageId(messageId: string) {
    return layoutItems.value.find(item => item.type === 'message' && item.messageId === messageId) ?? null
  }

  function findLayoutItemByMessageUuid(messageUuid: string) {
    return layoutItems.value.find(
      item => item.type === 'message' && item.message?.uuid === messageUuid,
    ) ?? null
  }

  function findLayoutItemByKey(key: string) {
    return layoutItems.value.find(item => item.key === key) ?? null
  }

  function getPageMetric(pageIndex: number) {
    return pageMetricsByIndex.value.get(pageIndex) ?? null
  }

  function binarySearch(scrollTop: number) {
    const items = layoutItems.value
    let low = 0
    let high = items.length - 1
    let result = 0

    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (items[mid].bottom >= scrollTop) {
        result = mid
        high = mid - 1
      }
      else {
        low = mid + 1
      }
    }

    return result
  }

  return {
    layoutItems,
    pageMetrics,
    pageMetricsByIndex,
    totalHeight,
    findLayoutItemByMessageId,
    findLayoutItemByMessageUuid,
    findLayoutItemByKey,
    getPageMetric,
    binarySearch,
  }
}
