<script setup lang="ts">
import { useAvatarStore } from '@tg-search/client'
import { computed } from 'vue'

import Avatar from '../ui/Avatar.vue'

import { useEnsureChatAvatar, useEnsureUserAvatar } from '../../composables/useEnsureAvatar'

interface Props {
  entityType: 'chat' | 'user'
  id: string | number
  fileId?: string | number
  name?: string
  size?: 'sm' | 'md' | 'lg'
  ensureOnMount?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'sm',
  ensureOnMount: true,
})

const avatarStore = useAvatarStore()

const idRef = computed(() => props.id)
const fileIdRef = computed(() => props.fileId)

// Visibility-driven ensure using existing composables
if (props.ensureOnMount) {
  if (props.entityType === 'chat')
    useEnsureChatAvatar(idRef, fileIdRef)
  else
    useEnsureUserAvatar(idRef)
}

const src = computed(() => {
  return props.entityType === 'chat'
    ? avatarStore.getChatAvatarUrl(props.id)
    : avatarStore.getUserAvatarUrl(props.id)
})
</script>

<template>
  <Avatar :src="src" :name="props.name" :size="props.size" />
</template>
