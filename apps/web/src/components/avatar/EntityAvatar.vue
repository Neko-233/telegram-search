<script setup lang="ts">
import Avatar from '../ui/Avatar.vue'

import { useEntityAvatar } from '../../composables/useEntityAvatar'

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

const { src } = useEntityAvatar(props)
</script>

<template>
  <Avatar :src="src" :name="props.name" :size="props.size" />
</template>
