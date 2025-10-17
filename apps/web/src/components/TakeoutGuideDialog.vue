<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import Dialog from './ui/Dialog.vue'

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
  errorMessage?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'retry'): void
}>()

const isOpen = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const isRetrying = ref(false)

// 处理重试
async function handleRetry() {
  isRetrying.value = true
  emit('retry')
  // 延迟关闭对话框，给用户一些反馈时间
  setTimeout(() => {
    isOpen.value = false
    isRetrying.value = false
  }, 1000)
}

// 关闭对话框
function handleClose() {
  isOpen.value = false
}
</script>

<template>
  <Dialog v-model="isOpen" :persistent="true" max-width="28rem">
    <div class="text-center">
      <!-- 图标 -->
      <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
        <svg class="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>

      <!-- 标题 -->
      <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ t('takeoutGuide.title') }}
      </h3>

      <!-- 内容 -->
      <div class="mb-6 space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>
          {{ t('takeoutGuide.description') }}
        </p>
        
        <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50">
          <ol class="space-y-2 text-left">
            <li class="flex items-start">
              <span class="mr-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs font-medium text-white">1</span>
              <span>{{ t('takeoutGuide.step1') }}</span>
            </li>
            <li class="flex items-start">
              <span class="mr-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs font-medium text-white">2</span>
              <span>{{ t('takeoutGuide.step2') }}</span>
            </li>
            <li class="flex items-start">
              <span class="mr-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs font-medium text-white">3</span>
              <span>{{ t('takeoutGuide.step3') }}</span>
            </li>
          </ol>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('takeoutGuide.completionHint') }}
        </p>
      </div>

      <!-- 按钮 -->
      <div class="flex justify-center space-x-3">
        <button
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          @click="handleClose"
        >
          {{ t('takeoutGuide.laterButton') }}
        </button>
        <button
          :disabled="isRetrying"
          class="flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="handleRetry"
        >
          <svg v-if="isRetrying" class="mr-2 h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {{ isRetrying ? t('takeoutGuide.retryingButton') : t('takeoutGuide.retryButton') }}
        </button>
      </div>
    </div>
  </Dialog>
</template>