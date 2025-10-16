<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Progress } from '../components/ui/Progress'

interface QueueChat {
  id: number
  name: string
  position?: number
}

interface QueueInfo {
  completed: number
  total: number
}

const props = defineProps<{
  currentChat?: QueueChat
  pendingChats: QueueChat[]
  completedChats: QueueChat[]
  queueInfo: QueueInfo
}>()

const { t } = useI18n()

/**
 * 计算下一个要同步的聊天
 */
const nextChat = computed(() => {
  return props.pendingChats[0] || null
})

/**
 * 计算队列进度百分比
 */
const queueProgress = computed(() => {
  const total = props.queueInfo.total || 0
  const completed = props.queueInfo.completed || 0
  if (total === 0)
    return 0
  return (completed / total) * 100
})
</script>

<template>
  <!-- 队列进度条 -->
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-sm text-foreground font-medium">{{ currentChat?.name || t('sync.preparing') }}</span>
        <div class="i-lucide-arrow-right h-4 w-4 text-muted-foreground" />
        <span class="text-sm text-muted-foreground">{{ nextChat?.name || t('sync.noMore') }}</span>
      </div>
      <span class="text-sm text-muted-foreground font-medium">
        {{ queueInfo.completed || 0 }}/{{ queueInfo.total || 0 }}
      </span>
    </div>

    <Progress :progress="queueProgress" />
  </div>
</template>

<style scoped>
/* 样式已集成到父组件中，无需额外样式 */
</style>
