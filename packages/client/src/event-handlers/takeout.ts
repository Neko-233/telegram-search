import type { ClientRegisterEventHandler } from '.'

import { useSyncTaskStore } from '../stores/useSyncTask'

export function registerTakeoutEventHandlers(
  registerEventHandler: ClientRegisterEventHandler,
) {
  const syncTaskStore = useSyncTaskStore()

  registerEventHandler('takeout:task:progress', (data) => {
    syncTaskStore.currentTask = data
  })

  registerEventHandler('takeout:chat:completed', ({ chatId: _chatId }) => {
    const hasMoreChats = syncTaskStore.completeCurrentAndStartNext()
    
    if (!hasMoreChats) {
      // 所有聊天都完成了，触发完成事件
      // 使用自定义事件通知UI所有任务完成
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sync:all-completed'))
      }
    }
  })
}
