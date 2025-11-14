<script setup lang="ts">
import { useAvatarStore, useBridgeStore } from '@tg-search/client'
import { computed, onMounted, watch } from 'vue'

import Avatar from '../ui/Avatar.vue'

import { ensureUserAvatarImmediate, useEnsureChatAvatar, useEnsureUserAvatar } from '../../composables/useEnsureAvatar'

interface Props {
  entity: 'self' | 'other'
  id: string | number
  entityType?: 'chat' | 'user'
  fileId?: string | number
  name?: string
  size?: 'sm' | 'md' | 'lg'
  ensureOnMount?: boolean
  forceRefresh?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  ensureOnMount: true,
  forceRefresh: true,
})

const avatarStore = useAvatarStore()
const bridgeStore = useBridgeStore()

const idRef = computed(() => props.id)
const fileIdRef = computed(() => props.fileId)

if (props.ensureOnMount) {
  if (props.entity === 'other') {
    if (props.entityType === 'chat')
      useEnsureChatAvatar(idRef, fileIdRef)
    else
      useEnsureUserAvatar(idRef)
  }
  else {
    function ensureSelf() {
      const connected = bridgeStore.getActiveSession()?.isConnected
      if (!connected)
        return
      const expectedFileId = typeof props.fileId === 'string' || typeof props.fileId === 'number' ? String(props.fileId) : undefined
      const currentFileId = avatarStore.getUserAvatarFileId(props.id)
      if (expectedFileId && currentFileId !== expectedFileId)
        avatarStore.ensureUserAvatar(String(props.id), expectedFileId, props.forceRefresh)
      else
        void ensureUserAvatarImmediate(props.id)
    }
    onMounted(() => {
      ensureSelf()
    })
    watch(() => bridgeStore.getActiveSession()?.isConnected, (connected) => {
      if (connected)
        ensureSelf()
    })
    watch(() => props.id, () => {
      ensureSelf()
    })
  }
}

const src = computed(() => {
  if (props.entity === 'self')
    return avatarStore.getUserAvatarUrl(props.id)
  if (props.entityType === 'user')
    return avatarStore.getUserAvatarUrl(props.id)
  return avatarStore.getChatAvatarUrl(props.id)
})
</script>

<template>
  <Avatar :src="src" :name="props.name" :size="props.size" />
</template>
