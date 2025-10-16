import type { CoreTask } from '@tg-search/core'

import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref } from 'vue'

interface SyncQueue {
  currentChatId?: number
  pendingChatIds: number[]
  completedChatIds: number[]
  totalChats: number
}

export const useSyncTaskStore = defineStore('sync-task', () => {
  const increase = ref(false)
  const currentTask = ref<CoreTask<'takeout'>>()
  const syncQueue = ref<SyncQueue>({
    currentChatId: undefined,
    pendingChatIds: [],
    completedChatIds: [],
    totalChats: 0,
  })

  const currentTaskProgress = computed(() => {
    if (!currentTask.value)
      return 0

    return currentTask.value.progress
  })

  /**
   * 初始化同步队列
   */
  const initSyncQueue = (chatIds: number[]) => {
    const [firstChatId, ...remainingChatIds] = chatIds
    syncQueue.value = {
      currentChatId: firstChatId,
      pendingChatIds: remainingChatIds,
      completedChatIds: [],
      totalChats: chatIds.length,
    }
  }

  /**
   * 开始同步下一个聊天
   */
  const startNextChat = () => {
    if (syncQueue.value.pendingChatIds.length > 0) {
      const nextChatId = syncQueue.value.pendingChatIds.shift()
      if (nextChatId !== undefined) {
        syncQueue.value.currentChatId = nextChatId
      }
    } else {
      // 没有更多待同步的聊天
      syncQueue.value.currentChatId = undefined
    }
  }

  /**
   * 完成当前聊天的同步
   */
  const completeCurrentChat = () => {
    if (syncQueue.value.currentChatId !== undefined) {
      syncQueue.value.completedChatIds.push(syncQueue.value.currentChatId)
      syncQueue.value.currentChatId = undefined
    }
  }

  /**
   * 完成当前聊天并开始下一个聊天（原子性操作）
   */
  const completeCurrentAndStartNext = () => {
    if (syncQueue.value.currentChatId !== undefined) {
      // 将当前聊天移到已完成列表
      syncQueue.value.completedChatIds.push(syncQueue.value.currentChatId)
      
      // 开始下一个聊天
      if (syncQueue.value.pendingChatIds.length > 0) {
        const nextChatId = syncQueue.value.pendingChatIds.shift()
        if (nextChatId !== undefined) {
          syncQueue.value.currentChatId = nextChatId
        }
        return true // 还有更多聊天
      } else {
        // 没有更多待同步的聊天
        syncQueue.value.currentChatId = undefined
        return false // 没有更多聊天
      }
    }
    return false
  }

  /**
   * 清空同步队列
   */
  const clearSyncQueue = () => {
    syncQueue.value = {
      currentChatId: undefined,
      pendingChatIds: [],
      completedChatIds: [],
      totalChats: 0,
    }
  }

  return {
    currentTask,
    currentTaskProgress,
    increase,
    syncQueue,
    initSyncQueue,
    startNextChat,
    completeCurrentChat,
    completeCurrentAndStartNext,
    clearSyncQueue,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSyncTaskStore, import.meta.hot))
}
