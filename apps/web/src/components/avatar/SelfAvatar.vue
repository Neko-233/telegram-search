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

function ensure() {
  if (!props.userId)
    return
  avatarStore.ensureUserAvatar(String(props.userId), undefined, props.forceRefresh)
}

onMounted(() => {
  ensure()
})

watch(() => bridgeStore.getActiveSession()?.isConnected, (connected) => {
  if (connected)
    ensure()
})

watch(() => props.userId, () => {
  ensure()
})
</script>

<template>
  <Avatar :src="src" :name="props.name" :size="props.size" eager />
</template>
