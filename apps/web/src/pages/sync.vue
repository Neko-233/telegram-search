<script setup lang="ts">
import { useAuthStore, useBridgeStore, useChatStore, useSyncTaskStore } from '@tg-search/client'
import NProgress from 'nprogress'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import ChatSelector from '../components/ChatSelector.vue'
import SyncQueueStatus from '../components/SyncQueueStatus.vue'
import { Button } from '../components/ui/Button'
import { Progress } from '../components/ui/Progress'

const { t } = useI18n()
const router = useRouter()

const selectedChats = ref<number[]>([])

const sessionStore = useAuthStore()
const { isLoggedIn } = storeToRefs(sessionStore)
const websocketStore = useBridgeStore()

const chatsStore = useChatStore()
const { chats } = storeToRefs(chatsStore)

const syncTaskStore = useSyncTaskStore()
const { currentTask, currentTaskProgress, increase, syncQueue } = storeToRefs(syncTaskStore)

// Default to incremental sync
if (increase.value === undefined || increase.value === null) {
  increase.value = true
}

// Task in progress status
const isTaskInProgress = computed(() => {
  return !!currentTask.value && currentTaskProgress.value >= 0 && currentTaskProgress.value < 100
})

// Disable buttons during sync or when no chats selected
const isButtonDisabled = computed(() => {
  return selectedChats.value.length === 0 || !isLoggedIn.value || isTaskInProgress.value
})

/**
 * 处理同步进度消息的国际化翻译
 */
const localizedTaskMessage = computed(() => {
  if (!currentTask.value?.lastMessage) {
    return ''
  }

  const message = currentTask.value.lastMessage

  // 处理 "Processed x/y messages" 格式的消息
  const processedMatch = message.match(/^Processed (\d+)\/(\d+) messages$/)
  if (processedMatch) {
    const [, processed, total] = processedMatch
    return t('sync.processedMessages', { processed, total })
  }

  // 处理其他常见的同步消息
  const messageMap: Record<string, string> = {
    'Init takeout session': t('sync.initTakeoutSession'),
    'Get messages': t('sync.getMessages'),
    'Starting incremental sync': t('sync.startingIncrementalSync'),
    'Incremental sync completed': t('sync.incrementalSyncCompleted'),
  }

  return messageMap[message] || message
})

/**
 * 从同步消息中提取进度数据并计算实时百分比
 */
const realTimeProgress = computed(() => {
  if (!currentTask.value?.lastMessage) {
    return currentTaskProgress.value || 0
  }

  const message = currentTask.value.lastMessage

  // 提取 "Processed x/y messages" 格式的数据
  const processedMatch = message.match(/^Processed (\d+)\/(\d+) messages$/)
  if (processedMatch) {
    const processed = Number.parseInt(processedMatch[1], 10)
    const total = Number.parseInt(processedMatch[2], 10)

    if (total > 0) {
      return Math.min(100, Math.max(0, (processed / total) * 100))
    }
  }

  // 如果无法从消息中提取进度，则使用后端提供的进度
  return currentTaskProgress.value || 0
})

/**
 * 处理错误信息的国际化翻译
 */
const localizedErrorMessage = computed(() => {
  if (!currentTask.value?.lastError) {
    return ''
  }

  const error = currentTask.value.lastError

  // 处理常见的错误信息
  const errorMap: Record<string, string> = {
    'Task aborted': t('sync.taskAborted'),
  }

  return errorMap[error] || error
})

/**
 * 获取聊天名称的辅助函数
 */
function getChatName(chatId: number) {
  const chat = chats.value.find(c => c.id === chatId)
  return chat?.name || t('chatSelector.chat', { id: chatId })
}

/**
 * 当前正在同步的聊天信息
 */
const currentSyncingChat = computed(() => {
  // 优先显示当前正在同步的聊天
  if (syncQueue.value.currentChatId) {
    return {
      id: syncQueue.value.currentChatId,
      name: getChatName(syncQueue.value.currentChatId),
    }
  }

  // 如果没有当前聊天，显示最后完成的聊天
  const lastCompletedChatId = syncQueue.value.completedChatIds[syncQueue.value.completedChatIds.length - 1]
  if (lastCompletedChatId) {
    return {
      id: lastCompletedChatId,
      name: getChatName(lastCompletedChatId),
    }
  }

  return undefined
})

/**
 * 等待同步的聊天列表
 */
const pendingSyncChats = computed(() => {
  return syncQueue.value.pendingChatIds.map(chatId => ({
    id: chatId,
    name: getChatName(chatId),
  }))
})

/**
 * 已完成同步的聊天列表
 */
const completedSyncChats = computed(() => {
  return syncQueue.value.completedChatIds.map(chatId => ({
    id: chatId,
    name: getChatName(chatId),
  }))
})

/**
 * 队列信息
 */
const queueInfo = computed(() => {
  return {
    completed: syncQueue.value.completedChatIds.length, // 只显示真正完成的数量
    total: syncQueue.value.totalChats,
  }
})

function handleSync() {
  increase.value = true

  // 初始化同步队列
  syncTaskStore.initSyncQueue(selectedChats.value)

  websocketStore.sendEvent('takeout:run', {
    chatIds: selectedChats.value.map(id => id.toString()),
    increase: true,
  })

  NProgress.start()
}

function handleResync() {
  increase.value = false

  // 初始化同步队列
  syncTaskStore.initSyncQueue(selectedChats.value)

  websocketStore.sendEvent('takeout:run', {
    chatIds: selectedChats.value.map(id => id.toString()),
    increase: false,
  })

  NProgress.start()
}

function handleAbort() {
  if (currentTask.value) {
    websocketStore.sendEvent('takeout:task:abort', {
      taskId: currentTask.value.taskId,
    })

    // 清空同步队列
    syncTaskStore.clearSyncQueue()
  }
  else {
    toast.error(t('sync.noInProgressTask'))
  }
}

watch(currentTaskProgress, (progress) => {
  if (progress === 100) {
    // 注意：不在这里调用completeCurrentAndStartNext，避免与takeout事件处理器重复调用
    // 队列状态由takeout:chat:completed事件处理器管理
    toast.success(t('sync.chatCompleted'))
  }
  else if (progress < 0 && currentTask.value?.lastError) {
    toast.error(localizedErrorMessage.value)
    NProgress.done()
  }
  else if (progress >= 0 && progress < 100) {
    NProgress.set(progress / 100)
  }
})

/**
 * 监听所有同步任务完成的自定义事件
 */
function handleAllCompleted() {
  toast.success(t('sync.allChatsCompleted'))
  NProgress.done()
  increase.value = true
  
  // 延迟清空同步队列，让用户能看到完成状态
  setTimeout(() => {
    syncTaskStore.clearSyncQueue()
  }, 2000)
}

onMounted(() => {
  window.addEventListener('sync:all-completed', handleAllCompleted)
})

onUnmounted(() => {
  window.removeEventListener('sync:all-completed', handleAllCompleted)
})
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <header class="flex items-center justify-between border-b bg-card/50 px-6 py-4 backdrop-blur-sm">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold">
          {{ t('sync.sync') }}
        </h1>
      </div>

      <div class="flex items-center gap-2">
        <Button
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :disabled="isButtonDisabled"
          @click="handleSync"
        >
          {{ t('sync.incrementalSync') }}
        </Button>
        <Button
          icon="i-lucide-rotate-ccw"
          variant="outline"
          size="sm"
          :disabled="isButtonDisabled"
          @click="handleResync"
        >
          {{ t('sync.resync') }}
        </Button>
      </div>
    </header>

    <!-- Login prompt banner -->
    <div
      v-if="!isLoggedIn"
      class="flex items-center justify-center px-6 py-8"
    >
      <div
        class="max-w-2xl w-full border border-primary/20 rounded-2xl bg-primary/5 p-6 transition-all"
      >
        <div class="flex flex-col items-center justify-center gap-4 md:flex-row md:justify-between">
          <div class="flex items-center gap-4">
            <div class="h-12 w-12 flex flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
              <div class="i-lucide-lock-keyhole h-6 w-6 text-primary" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-sm text-foreground font-semibold">{{ t('loginPromptBanner.pleaseLoginToUseFullFeatures') }}</span>
              <span class="text-xs text-muted-foreground">{{ t('loginPromptBanner.subtitle') }}</span>
            </div>
          </div>
          <Button
            size="md"
            icon="i-lucide-log-in"
            class="flex-shrink-0"
            @click="router.push('/login')"
          >
            {{ t('loginPromptBanner.login') }}
          </Button>
        </div>
      </div>
    </div>

    <div v-else class="flex flex-1 flex-col overflow-hidden p-6">
      <div class="mx-auto h-full max-w-6xl w-full flex flex-col space-y-6">
        <!-- Progress bar -->
        <div
          v-if="isTaskInProgress"
          class="border border-primary/20 rounded-2xl bg-primary/5 p-6 shadow-sm transition-all"
        >
          <div class="space-y-4">
            <div class="flex items-center gap-3">
              <div class="flex-shrink-0">
                <div class="i-lucide-loader-2 h-6 w-6 animate-spin text-primary" />
              </div>
              <div class="flex flex-1 flex-col gap-1">
                <span class="text-base text-foreground font-semibold">{{ t('sync.syncing') }}</span>
                <span v-if="localizedTaskMessage" class="text-sm text-muted-foreground">{{ localizedTaskMessage }}</span>
              </div>
            </div>

            <Progress
              :progress="realTimeProgress"
            />

            <!-- 队列状态显示 -->
            <SyncQueueStatus
              v-if="isTaskInProgress"
              :current-chat="currentSyncingChat"
              :pending-chats="pendingSyncChats"
              :completed-chats="completedSyncChats"
              :queue-info="queueInfo"
            />

            <div class="flex justify-end">
              <Button
                icon="i-lucide-x"
                size="sm"
                variant="outline"
                @click="handleAbort"
              >
                {{ t('sync.cancel') }}
              </Button>
            </div>
          </div>
        </div>

        <!-- Chat selector section -->
        <div class="min-h-0 flex flex-1 flex-col space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg text-foreground font-semibold">
                {{ t('sync.selectChats') }}
              </h3>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ t('sync.syncPrompt') }}
              </p>
            </div>

            <div class="flex items-center gap-2 rounded-full bg-muted px-4 py-2">
              <span class="i-lucide-check-circle h-4 w-4 text-primary" />
              <span class="text-sm text-foreground font-medium">
                {{ t('sync.selectedChats', { count: selectedChats.length }) }}
              </span>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-hidden">
            <ChatSelector
              v-model:selected-chats="selectedChats"
              :chats="chats"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
