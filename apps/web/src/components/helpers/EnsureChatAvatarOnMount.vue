<script lang="ts" setup>
import { onMounted, watch } from 'vue'

import { ensureChatAvatarImmediate } from '../../composables/useEnsureAvatar'

interface Props {
  chatId: string | number | undefined
  fileId?: string | number | undefined
}

const props = defineProps<Props>()

/**
 * Ensure chat avatar when the list item becomes visible.
 * - Runs on mount for virtual list items, so only visible ones trigger.
 * - Re-runs when `chatId` or `fileId` changes for reused DOM nodes.
 */
async function ensureOnce() {
  await ensureChatAvatarImmediate(props.chatId, props.fileId)
}

onMounted(() => {
  void ensureOnce()
})

watch(() => [props.chatId, props.fileId], () => {
  void ensureOnce()
})
</script>

<template>
  <!-- Invisible helper; no UI rendered -->
  <span style="display: none" aria-hidden="true" />
  
</template>