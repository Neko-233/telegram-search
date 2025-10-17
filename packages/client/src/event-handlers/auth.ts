import type { ClientRegisterEventHandler } from '.'

import { toast } from 'vue-sonner'

import { useBridgeStore } from '../composables/useBridge'
import { useAuthStore } from '../stores/useAuth'

// 错误代码到翻译键的映射
function getErrorTranslationKey(errorCode: string): string {
  const errorKeyMap: Record<string, string> = {
    'PHONE_NUMBER_INVALID': 'phoneNumberInvalid',
    'PHONE_CODE_INVALID': 'phoneCodeInvalid',
    'PHONE_CODE_EXPIRED': 'phoneCodeExpired',
    'PASSWORD_HASH_INVALID': 'passwordHashInvalid',
    'SESSION_PASSWORD_NEEDED': 'sessionPasswordNeeded',
    'PHONE_NUMBER_BANNED': 'phoneNumberBanned',
    'PHONE_NUMBER_UNOCCUPIED': 'phoneNumberUnoccupied',
    'PHONE_PASSWORD_PROTECTED': 'phonePasswordProtected',
    'PHONE_PASSWORD_FLOOD': 'phonePasswordFlood',
    'PHONE_CODE_EMPTY': 'phoneCodeEmpty',
    'PHONE_CODE_HASH_EMPTY': 'phoneCodeHashEmpty',
    'API_ID_INVALID': 'apiIdInvalid',
    'API_ID_PUBLISHED_FLOOD': 'apiIdPublishedFlood',
    'AUTH_KEY_UNREGISTERED': 'authKeyUnregistered',
    'AUTH_RESTART': 'authRestart',
    'PASSWORD_REQUIRED': 'passwordRequired',
    'NETWORK_ERROR': 'networkError',
    'TIMEOUT': 'timeout',
    'SIGN_IN_FAILED': 'signInFailed',
    'SMS_CODE_CREATE_FAILED': 'smsCodeCreateFailed',
    'UPDATE_APP_TO_LOGIN': 'updateAppToLogin',
    'PARSE_ERROR': 'parseError',
    'UNKNOWN': 'unknownError'
  }
  
  return errorKeyMap[errorCode] || errorKeyMap.UNKNOWN
}

// 处理特定认证错误的逻辑
function handleSpecificAuthError(errorCode: string, authStore: any) {
  // 需要重新开始认证流程的错误
  const restartAuthErrors = [
    'AUTH_KEY_UNREGISTERED',
    'SESSION_EXPIRED',
    'API_ID_INVALID'
  ]
  
  // 需要重新输入的错误
  const retryInputErrors = [
    'PHONE_CODE_INVALID',
    'PASSWORD_HASH_INVALID',
    'PHONE_NUMBER_INVALID'
  ]
  
  if (restartAuthErrors.includes(errorCode)) {
    // 重置认证状态
    authStore.auth.needCode = false
    authStore.auth.needPassword = false
  } else if (retryInputErrors.includes(errorCode)) {
    // 保持当前状态，允许用户重新输入
    // 不需要特殊处理，用户可以直接重试
  }
}

export function registerBasicEventHandlers(
  registerEventHandler: ClientRegisterEventHandler,
) {
  registerEventHandler('auth:code:needed', () => {
    useAuthStore().auth.needCode = true
  })

  registerEventHandler('auth:password:needed', () => {
    useAuthStore().auth.needPassword = true
  })

  registerEventHandler('auth:connected', () => {
    useBridgeStore().getActiveSession()!.isConnected = true
  })

  registerEventHandler('auth:error', ({ error }) => {
    const authStore = useAuthStore()
    authStore.auth.isLoading = false
    
    // 尝试解析错误信息
    let errorMessage = 'Authentication failed'
    let errorCode = 'UNKNOWN'
    
    try {
      // 处理不同格式的错误
      if (typeof error === 'string') {
        try {
          // 尝试解析JSON字符串
          const parsedError = JSON.parse(error) as any
          
          if (parsedError.error) {
            // 解析RPC错误格式: "400: PHONE_NUMBER_INVALID (caused by auth.SendCode)"
            const rpcMatch = parsedError.error.match(/(\d+):\s*([A-Z_0-9]+)(?:\s*\(caused by ([^)]+)\))?/)
            if (rpcMatch) {
              const [, _statusCode, errorType, _method] = rpcMatch
              errorCode = errorType
              const translationKey = getErrorTranslationKey(errorType)
              errorMessage = translationKey
            }
          }
        } catch {
          // 如果不是JSON，忽略解析错误
        }
      } else if (error && typeof error === 'object') {
        const errorObj = error as any
        
        // 处理不同的错误对象结构
        if (errorObj.error && typeof errorObj.error === 'string') {
          // 检查是否是 API 配置相关错误
          if (errorObj.error.includes('API ID') || errorObj.error.includes('API Hash')) {
            if (errorObj.error.includes('empty') || errorObj.error.includes('undefined')) {
              errorCode = 'API_ID_INVALID'
              const translationKey = getErrorTranslationKey(errorCode)
              errorMessage = translationKey
            }
          } else {
            // 解析RPC错误格式: "400: PHONE_NUMBER_INVALID (caused by auth.SendCode)"
            const rpcMatch = errorObj.error.match(/(\d+):\s*([A-Z_0-9]+)(?:\s*\(caused by ([^)]+)\))?/)
            if (rpcMatch) {
              const [, _statusCode, errorType, _method] = rpcMatch
              errorCode = errorType
              const translationKey = getErrorTranslationKey(errorType)
              errorMessage = translationKey
            }
          }
        } else if (errorObj.errorMessage) {
          // Telegram API 错误格式: {code: 400, errorMessage: 'PHONE_NUMBER_INVALID'}
          // 从 errorMessage 中提取错误代码
           const telegramErrorMatch = errorObj.errorMessage.match(/^([A-Z_0-9]+)/)
           if (telegramErrorMatch) {
             errorCode = telegramErrorMatch[1]
             const translationKey = getErrorTranslationKey(errorCode)
             errorMessage = translationKey
           }
        } else if (errorObj.error) {
          // 解析RPC错误格式: "400: PHONE_NUMBER_INVALID (caused by auth.SendCode)"
          const rpcMatch = errorObj.error.match(/(\d+):\s*([A-Z_0-9]+)(?:\s*\(caused by ([^)]+)\))?/)
          if (rpcMatch) {
            const [, _statusCode, errorType, _method] = rpcMatch
            errorCode = errorType
            const translationKey = getErrorTranslationKey(errorType)
            errorMessage = translationKey
          }
        } else if (errorObj.message) {
          // 检查是否是 API 配置相关错误
          if (errorObj.message.includes('API ID') || errorObj.message.includes('API Hash')) {
            if (errorObj.message.includes('empty') || errorObj.message.includes('undefined')) {
              errorCode = 'API_ID_INVALID'
              const translationKey = getErrorTranslationKey(errorCode)
              errorMessage = translationKey
            }
          }
        }
        
        // 如果还没有找到错误代码，检查 code 字段（作为备用）
        if (errorCode === 'UNKNOWN' && errorObj.code && typeof errorObj.code === 'string') {
          errorCode = errorObj.code
          const translationKey = getErrorTranslationKey(errorObj.code)
          errorMessage = translationKey
        }
      }
    } catch {
      // 忽略解析错误
    }
    
    // 发出一个新的事件，包含错误代码和翻译键，供上层处理
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:error:translated', {
        detail: {
          errorCode,
          translationKey: errorMessage,
          originalError: error
        }
      }))
    }
    
    // 根据错误类型处理特定情况
    handleSpecificAuthError(errorCode, authStore)
  })
}
