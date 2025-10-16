<template>
  <div class="relative">
    <!-- 选择器按钮 -->
    <button
      ref="triggerRef"
      type="button"
      class="flex items-center gap-2 px-5 py-4 border border-neutral-200 rounded-xl bg-neutral-100 hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white transition disabled:cursor-not-allowed text-xl"
      :class="$attrs.class"
      :disabled="props.disabled"
      @click="toggleDropdown"
    >
      <span class="text-lg">{{ selectedCountry.flag }}</span>
      <span class="text-sm font-medium">{{ selectedCountry.dialCode }}</span>
      <div class="i-lucide-chevron-down h-4 w-4 text-gray-500" :class="{ 'rotate-180': isOpen }" />
    </button>

    <!-- 下拉菜单 -->
    <div
      v-if="isOpen"
      ref="dropdownRef"
      class="absolute top-full left-0 z-50 mt-1 w-80 bg-white border border-gray-300 rounded-md shadow-lg dark:bg-gray-800 dark:border-gray-600"
    >
      <!-- 搜索框 -->
      <div class="p-3 border-b border-gray-200 dark:border-gray-600">
        <div class="relative">
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <div class="i-lucide-search h-4 w-4 text-gray-400" />
          </div>
          <input
            v-model="searchQuery"
            type="text"
            class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
            :placeholder="t('countryCodeSelector.searchPlaceholder')"
          >
        </div>
      </div>

      <!-- 国家列表 -->
      <div class="max-h-60 overflow-y-auto">
        <div
          v-for="country in filteredCountries"
          :key="country.code"
          class="flex items-center gap-3 px-3 py-2 hover:bg-gray-100 cursor-pointer dark:hover:bg-gray-700"
          @click="selectCountry(country)"
        >
          <span class="text-lg">{{ country.flag }}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-900 dark:text-white">
              {{ country.nameLocal || (currentLocale === 'zh' ? country.nameCN : country.name) }}
            </div>
          </div>
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ country.dialCode }}</span>
        </div>

        <!-- 无搜索结果 -->
        <div
          v-if="filteredCountries.length === 0"
          class="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          {{ t('countryCodeSelector.noResults') }}
        </div>
      </div>

      <!-- 自定义区号选项 -->
      <div class="border-t border-gray-200 dark:border-gray-600">
        <div class="p-3">
          <div class="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            {{ t('countryCodeSelector.customDialCode') }}
          </div>
          <div class="flex gap-2">
            <input
              v-model="customDialCode"
              type="text"
              class="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              :placeholder="t('countryCodeSelector.customDialCodePlaceholder')"
              @keyup.enter="useCustomDialCode"
            >
            <button
              type="button"
              class="px-3 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              @click="useCustomDialCode"
            >
              {{ t('countryCodeSelector.use') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CountryCode } from '../../data/countryCodes'

import { onClickOutside } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { countryCodes, searchCountries } from '../../data/countryCodes'

/**
 * 组件属性定义
 */
interface Props {
  /** 当前选中的国家代码 */
  modelValue?: CountryCode
  /** 是否禁用 */
  disabled?: boolean
}

/**
 * 组件事件定义
 */
interface Emits {
  /** 更新选中的国家代码 */
  (e: 'update:modelValue', value: CountryCode): void
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => countryCodes[0] // 默认选择中国
})

const emit = defineEmits<Emits>()

const { t, locale } = useI18n()

// 当前语言环境
const currentLocale = computed(() => locale.value)

// 组件状态
const isOpen = ref(false)
const searchQuery = ref('')
const customDialCode = ref('')

// DOM 引用
const triggerRef = ref<HTMLElement>()
const dropdownRef = ref<HTMLElement>()

// 当前选中的国家
const selectedCountry = computed({
  get: () => props.modelValue || countryCodes[0],
  set: (value: CountryCode) => emit('update:modelValue', value)
})

// 过滤后的国家列表
const filteredCountries = computed(() => {
  return searchCountries(searchQuery.value)
})

/**
 * 切换下拉菜单显示状态
 */
function toggleDropdown() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    searchQuery.value = ''
    customDialCode.value = ''
  }
}

/**
 * 选择国家
 * @param country 选中的国家信息
 */
function selectCountry(country: CountryCode) {
  selectedCountry.value = country
  isOpen.value = false
}

/**
 * 使用自定义区号
 */
function useCustomDialCode() {
  if (!customDialCode.value.trim()) return

  let dialCode = customDialCode.value.trim()
  if (!dialCode.startsWith('+')) {
    dialCode = `+${dialCode}`
  }

  // 创建自定义国家代码对象
  const customCountry: CountryCode = {
    code: 'CUSTOM',
    name: 'Custom',
    nameCN: '自定义',
    flag: '🌐',
    dialCode
  }

  selectCountry(customCountry)
}

// 点击外部关闭下拉菜单
onClickOutside(dropdownRef, () => {
  isOpen.value = false
}, { ignore: [triggerRef] })

// 监听搜索查询变化，重置滚动位置
watch(searchQuery, () => {
  if (dropdownRef.value) {
    const listContainer = dropdownRef.value.querySelector('.max-h-60')
    if (listContainer) {
      listContainer.scrollTop = 0
    }
  }
})
</script>

<style scoped>
/* 旋转动画 */
.rotate-180 {
  transform: rotate(180deg);
}

/* 过渡动画 */
.i-lucide-chevron-down {
  transition: transform 0.2s ease-in-out;
}
</style>
