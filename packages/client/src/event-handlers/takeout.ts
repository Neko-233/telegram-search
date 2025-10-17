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

  // 注册核心错误事件处理器
  registerEventHandler('core:error', ({ error }) => {
    // 获取错误消息字符串
    let errorMessage = ''
    if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      // 检查是否有errorMessage属性
      if ('errorMessage' in error) {
        errorMessage = String(error.errorMessage)
      } else if ('error' in error) {
        errorMessage = String(error.error)
      } else {
        errorMessage = String(error)
      }
    } else {
      errorMessage = String(error)
    }

    // 检查是否是TAKEOUT_INIT_DELAY错误
    if (errorMessage.includes('TAKEOUT_INIT_DELAY')) {
      // 触发自定义事件，通知UI显示数据导出请求引导
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('takeout:init-delay', {
          detail: {
            errorMessage
          }
        }))
      }
    } else if (errorMessage.includes('Init takeout session failed')) {
      // 处理其他takeout初始化失败的情况
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('takeout:init-failed', {
          detail: {
            errorMessage
          }
        }))
      }
    }
  })
}
