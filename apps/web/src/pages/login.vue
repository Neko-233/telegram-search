<script setup lang="ts">
import type { CountryCode } from '../staticData/countryCodes'

import { useAuthStore, useBridgeStore } from '@tg-search/client'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import CountryCodeSelector from '../components/ui/CountryCodeSelector.vue'
import DynamicStepper from '../components/ui/DynamicStepper.vue'
import { countryCodes } from '../staticData/countryCodes'

const { t } = useI18n()
type LoginStep = 'phone' | 'code' | 'password' | 'complete'

const router = useRouter()

const authStore = useAuthStore()
const websocketStore = useBridgeStore()
const { isLoggedIn } = storeToRefs(authStore)

const state = ref({
  currentStep: 'phone' as LoginStep,
  showAdvancedSettings: false,
  phoneNumber: websocketStore.getActiveSession()?.purePhoneNumber ?? '',
  verificationCode: '',
  twoFactorPassword: '',
})

// 国家代码和手机号码验证相关状态
// 从会话中恢复上次选择的国家区号，如果没有则默认选择中国
const savedCountryCode = websocketStore.getActiveSession()?.countryCode
const initialCountryCode = savedCountryCode
  ? countryCodes.find(c => c.dialCode === savedCountryCode) || countryCodes[0]
  : countryCodes[0]
const selectedCountryCode = ref<CountryCode>(initialCountryCode)
const phoneValidationError = ref('')

/**
 * 验证手机号码是否只包含数字
 * @param phoneNumber 手机号码
 * @returns 是否为有效的数字格式
 */
function validatePhoneNumber(phoneNumber: string): boolean {
  return /^\d*$/.test(phoneNumber)
}

/**
 * 处理手机号码输入，只允许数字
 * @param event 输入事件
 */
function handlePhoneInput(event: Event) {
  const target = event.target as HTMLInputElement
  const value = target.value

  // 过滤非数字字符
  const filteredValue = value.replace(/\D/g, '')

  // 如果输入了非数字字符，显示错误提示
  if (value !== filteredValue) {
    phoneValidationError.value = t('login.phoneValidationError')
    // 延迟清除错误提示
    setTimeout(() => {
      phoneValidationError.value = ''
    }, 2000)
  }
  else {
    phoneValidationError.value = ''
  }

  // 更新手机号码值
  state.value.phoneNumber = filteredValue
}

/**
 * 监听手机号码输入，实时验证
 */
watch(() => state.value.phoneNumber, (newValue) => {
  if (newValue && !validatePhoneNumber(newValue)) {
    phoneValidationError.value = t('login.phoneValidationError')
  }
  else if (phoneValidationError.value === t('login.phoneValidationError')) {
    phoneValidationError.value = ''
  }
})
authStore.auth.needCode = false
authStore.auth.needPassword = false
authStore.auth.isLoading = false

const {
  login,
  submitCode,
  submitPassword,
} = authStore.handleAuth()

// 认证错误处理器
function handleAuthError(event: CustomEvent) {
  try {
    const { translationKey } = event.detail

    // 直接使用翻译键获取本地化消息
    const translatedMessage = t(`errors.${translationKey}`) || t('errors.unknownError')

    // 显示翻译后的错误消息
    toast.error(translatedMessage)
  }
  catch {
    // 如果翻译失败，显示通用错误消息
    toast.error(t('errors.unknownError'))
  }
}

// 注册和清理事件监听器
onMounted(() => {
  window.addEventListener('auth:error:translated', handleAuthError as EventListener)
})

onUnmounted(() => {
  window.removeEventListener('auth:error:translated', handleAuthError as EventListener)
})

watch(() => authStore.auth.needCode, (value) => {
  if (value) {
    authStore.auth.isLoading = false
    state.value.currentStep = 'code'
  }
})

watch(() => authStore.auth.needPassword, (value) => {
  if (value) {
    authStore.auth.isLoading = false
    state.value.currentStep = 'password'
  }
})

watch(isLoggedIn, (value) => {
  if (value) {
    authStore.auth.isLoading = false
    state.value.currentStep = 'complete'
  }
})

/**
 * 步骤配置的计算属性，支持语言切换时的实时翻译
 */
/**
 * 动态计算当前登录流程需要的步骤
 * 根据登录状态和需求动态生成步骤列表
 */
const steps = computed(() => {
  const allSteps = [
    { value: 'phone', title: t('login.phone'), description: t('login.phoneDescription') },
    { value: 'code', title: t('login.code'), description: t('login.codeDescription') },
    { value: 'password', title: t('login.password'), description: t('login.passwordDescription') },
    { value: 'complete', title: t('login.complete'), description: t('login.completeDescription') },
  ]

  // 根据实际需要的步骤构建步骤列表
  const activeSteps = []

  // 第一步：手机号输入（总是需要）
  activeSteps.push(allSteps[0])

  // 第二步：验证码（只有在实际需要验证码时才添加）
  if (authStore.auth.needCode || state.value.currentStep === 'code') {
    activeSteps.push(allSteps[1])
  }

  // 第三步：二级密码（只有在实际需要密码时才添加）
  if (authStore.auth.needPassword || state.value.currentStep === 'password') {
    activeSteps.push(allSteps[2])
  }

  // 第四步：完成（总是需要，作为最后一步）
  activeSteps.push(allSteps[3])

  return activeSteps
})

function redirectRoot() {
  toast.success(t('login.loginSuccess'))
  router.push('/')
}

/**
 * 处理登录逻辑
 */
async function handleLogin() {
  authStore.auth.isLoading = true

  switch (state.value.currentStep) {
    case 'phone': {
      // 检查手机号码验证错误
      if (phoneValidationError.value) {
        toast.error(phoneValidationError.value)
        authStore.auth.isLoading = false
        return
      }
      // 保存分离的国家区号和纯手机号到会话中
      websocketStore.updateActiveSession(websocketStore.activeSessionId, {
        countryCode: selectedCountryCode.value.dialCode,
        purePhoneNumber: state.value.phoneNumber,
      })
      // 组合国家代码和手机号码
      const fullPhoneNumber = selectedCountryCode.value.dialCode + state.value.phoneNumber
      login(fullPhoneNumber)
      break
    }
    case 'code':
      submitCode(state.value.verificationCode)
      break
    case 'password':
      submitPassword(state.value.twoFactorPassword)
      break
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background dark:bg-gray-900">
    <div class="max-w-md w-full rounded-2xl bg-card p-10 shadow-2xl dark:bg-gray-800">
      <h1 class="mb-6 text-center text-3xl text-gray-900 font-bold tracking-tight dark:text-gray-100">
        {{ t('login.telegramLogin') }}
      </h1>
      <DynamicStepper :steps="steps" :current-step="state.currentStep" />
      <!-- 只在非完成状态时显示步骤描述，避免重复 -->
      <p v-if="state.currentStep !== 'complete'" class="mb-8 text-center text-lg text-gray-600 font-medium dark:text-gray-400">
        {{ steps.find(s => s.value === state.currentStep)?.description }}
      </p>

      <!-- 手机号码表单 -->
      <form v-if="state.currentStep === 'phone'" class="space-y-6" @submit.prevent="handleLogin">
        <div>
          <label for="phoneNumber" class="mb-2 block text-base text-gray-900 font-semibold dark:text-gray-100">{{ t('login.phoneNumber') }}</label>
          <div class="flex">
            <!-- 国家代码选择器 -->
            <div class="flex-shrink-0">
              <CountryCodeSelector
                v-model="selectedCountryCode"
                :disabled="authStore.auth.isLoading"
                class="border-r-0 rounded-r-none"
              />
            </div>
            <!-- 手机号码输入框 -->
            <div class="flex-1">
              <input
                id="phoneNumber"
                v-model="state.phoneNumber"
                type="tel"
                :placeholder="t('login.phoneNumberPlaceholder')"
                class="w-full border border-l-0 border-neutral-200 rounded-xl rounded-l-none bg-neutral-100 px-5 py-4 text-xl text-gray-900 transition disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-offset-gray-800"
                :class="{ 'border-red-500 focus:ring-red-500': phoneValidationError }"
                required
                :disabled="authStore.auth.isLoading"
                @input="handlePhoneInput"
              >
            </div>
          </div>
          <!-- 实时验证错误提示 -->
          <p v-if="phoneValidationError" class="mt-2 text-sm text-red-600 dark:text-red-400">
            {{ phoneValidationError }}
          </p>
        </div>
        <button
          type="submit"
          class="w-full flex items-center justify-center rounded-xl bg-primary py-4 text-lg text-white font-bold transition disabled:cursor-not-allowed disabled:bg-gray-300 hover:bg-primary/90 dark:disabled:bg-gray-700"
          :disabled="authStore.auth.isLoading"
        >
          <span v-if="authStore.auth.isLoading" class="i-lucide-loader-2 mr-2 animate-spin" />
          {{ authStore.auth.isLoading ? t('login.processing') : t('login.login') }}
        </button>
      </form>

      <!-- 验证码表单 -->
      <form v-if="state.currentStep === 'code'" class="space-y-6" @submit.prevent="handleLogin">
        <div>
          <label for="verificationCode" class="mb-2 block text-base text-gray-900 font-semibold dark:text-gray-100">{{ t('login.verificationCode') }}</label>
          <input
            id="verificationCode"
            v-model="state.verificationCode"
            type="text"
            :placeholder="t('login.verificationCodePlaceholder')"
            class="w-full border border-neutral-200 rounded-xl bg-neutral-100 px-5 py-4 text-xl text-gray-900 transition disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-offset-gray-800"
            required
            :disabled="authStore.auth.isLoading"
          >
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {{ t('login.verificationCodeDescription') }}
          </p>
        </div>
        <button
          type="submit"
          class="w-full flex items-center justify-center rounded-xl bg-primary py-4 text-lg text-white font-bold transition disabled:cursor-not-allowed disabled:bg-gray-300 hover:bg-primary/90 dark:disabled:bg-gray-700"
          :disabled="authStore.auth.isLoading"
        >
          <span v-if="authStore.auth.isLoading" class="i-lucide-loader-2 mr-2 animate-spin" />
          {{ authStore.auth.isLoading ? t('login.processing') : t('login.verify') }}
        </button>
      </form>

      <!-- 两步验证密码表单 -->
      <form v-if="state.currentStep === 'password'" class="space-y-6" @submit.prevent="handleLogin">
        <div>
          <label for="twoFactorPassword" class="mb-2 block text-base text-gray-900 font-semibold dark:text-gray-100">{{ t('login.twoFactorPassword') }}</label>
          <input
            id="twoFactorPassword"
            v-model="state.twoFactorPassword"
            type="password"
            :placeholder="t('login.twoFactorPasswordPlaceholder')"
            class="w-full border border-neutral-200 rounded-xl bg-neutral-100 px-5 py-4 text-xl text-gray-900 transition disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-offset-gray-800"
            required
            :disabled="authStore.auth.isLoading"
          >
        </div>
        <button
          type="submit"
          class="w-full flex items-center justify-center rounded-xl bg-primary py-4 text-lg text-white font-bold transition disabled:cursor-not-allowed disabled:bg-gray-300 hover:bg-primary/90 dark:disabled:bg-gray-700"
          :disabled="authStore.auth.isLoading"
        >
          <span v-if="authStore.auth.isLoading" class="i-lucide-loader-2 mr-2 animate-spin" />
          {{ authStore.auth.isLoading ? t('login.processing') : t('login.login') }}
        </button>
      </form>

      <!-- 登录完成 -->
      <div v-if="state.currentStep === 'complete'" class="text-center space-y-6">
        <div class="text-5xl">
          🎉
        </div>
        <div class="space-y-2">
          <h2 class="text-2xl text-gray-900 font-bold dark:text-gray-100">
            {{ t('login.loginSuccess') }}
          </h2>
          <p class="text-base text-gray-600 dark:text-gray-400">
            {{ t('login.loginSuccessDescription') }}
          </p>
        </div>
        <button
          class="w-full rounded-xl bg-primary py-4 text-lg text-white font-bold transition hover:bg-primary/90"
          @click="redirectRoot"
        >
          {{ t('login.enterHome') }}
        </button>
      </div>
    </div>
  </div>
</template>
