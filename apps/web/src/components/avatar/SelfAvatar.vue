<script setup lang="ts">
import { useAvatarStore, useBridgeStore } from '@tg-search/client'
import { computed, onMounted, watch } from 'vue'

import Avatar from '../ui/Avatar.vue'

interface Props {
  userId: string | number
  name?: string
  size?: 'sm' | 'md' | 'lg'
  forceRefresh?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'sm',
  forceRefresh: true,
})

const avatarStore = useAvatarStore()
const bridgeStore = useBridgeStore()

const src = computed(() => avatarStore.getUserAvatarUrl(props.userId))

// Ensure latest self avatar on mount and reconnect
onMounted(() => {
  avatarStore.ensureUserAvatar(String(props.userId), undefined, props.forceRefresh)
})

watch(() => bridgeStore.getActiveSession()?.isConnected, (connected) => {
  if (connected)
    avatarStore.ensureUserAvatar(String(props.userId), undefined, props.forceRefresh)
})
</script>

<template>
  <Avatar :src="src" :name="props.name" :size="props.size" eager />
</template>
