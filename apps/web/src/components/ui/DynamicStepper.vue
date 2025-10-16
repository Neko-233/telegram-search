<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * 步骤接口定义
 */
export interface Step {
  value: string
  title: string
  description?: string
}

/**
 * 组件属性定义
 */
interface Props {
  /** 所有步骤列表 */
  steps: Step[]
  /** 当前步骤值 */
  currentStep: string
}

const props = defineProps<Props>()

// 当前步骤索引
const currentStepIndex = computed(() =>
  props.steps.findIndex(step => step.value === props.currentStep)
)

// 已显示的步骤球数量（基于实际步骤进度）
const displayedStepsCount = ref(1)

// 动画状态
const isAnimating = ref(false)

/**
 * 计算要显示的步骤球列表
 * 每个步骤球显示的数字是基于实际步骤进度的（1, 2, 3...）
 * 而不是基于总步骤数组中的位置
 */
const displayedSteps = computed(() => {
  return Array.from({ length: displayedStepsCount.value }, (_, i) => i + 1)
})

/**
 * 计算实际执行的步骤数量
 * 基于当前步骤在实际执行序列中的位置
 */
const actualStepNumber = computed(() => {
  const currentIndex = currentStepIndex.value
  if (currentIndex === -1) return 1

  // 返回当前步骤在实际执行序列中的位置（从1开始）
  return currentIndex + 1
})

/**
 * 监听步骤变化，管理步骤球的显示
 */
watch(actualStepNumber, (newStep, oldStep = 0) => {
  if (newStep > 0) {
    if (newStep > oldStep) {
      // 步骤前进，添加新的步骤球
      isAnimating.value = true

      // 延迟添加新步骤球，创建动画效果
      setTimeout(() => {
        displayedStepsCount.value = newStep
        isAnimating.value = false
      }, 150)
    } else if (newStep < oldStep) {
      // 步骤后退，重置步骤球数量
      displayedStepsCount.value = newStep
    } else {
      // 步骤相同，确保显示正确数量
      displayedStepsCount.value = newStep
    }
  }
}, { immediate: true })

/**
 * 初始化步骤球显示
 */
watch(() => props.currentStep, () => {
  if (actualStepNumber.value > 0) {
    displayedStepsCount.value = actualStepNumber.value
  }
}, { immediate: true })
</script>

<template>
  <div class="mb-8 flex justify-center">
    <!-- 步骤球容器，整体居中 -->
    <div class="flex items-center gap-3">
      <!-- 已完成的步骤球 -->
      <TransitionGroup
        name="step-ball"
        tag="div"
        class="flex items-center gap-3"
      >
        <div
          v-for="(stepNum, index) in displayedSteps"
          :key="`step-${stepNum}`"
          class="relative"
        >
          <!-- 步骤球 -->
          <div
            class="h-12 w-12 flex items-center justify-center border-2 rounded-full text-lg font-bold transition-all duration-300"
            :class="stepNum === actualStepNumber
              ? 'bg-primary text-white border-primary shadow-lg scale-110'
              : 'bg-gray-200 text-gray-600 border-gray-300 dark:bg-gray-600 dark:text-gray-300 dark:border-gray-500'"
          >
            <span>{{ stepNum }}</span>
          </div>

          <!-- 连接线（除了最后一个步骤球） -->
          <div
            v-if="index < displayedSteps.length - 1"
            class="absolute top-1/2 left-full w-3 h-0.5 bg-gray-300 dark:bg-gray-600 transform -translate-y-1/2 transition-all duration-300"
          />
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
/* 步骤球进入和离开动画 */
.step-ball-enter-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.step-ball-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.step-ball-enter-from {
  opacity: 0;
  transform: translateX(20px) scale(0.8);
}

.step-ball-leave-to {
  opacity: 0;
  transform: translateX(-20px) scale(0.8);
}

.step-ball-enter-to,
.step-ball-leave-from {
  opacity: 1;
  transform: translateX(0) scale(1);
}

/* 步骤球移动动画 */
.step-ball-move {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 当前步骤球的脉冲效果 */
@keyframes pulse-current {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 59, 130, 246), 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(var(--primary-rgb, 59, 130, 246), 0);
  }
}

/* 当前步骤球应用脉冲动画 */
.scale-110 {
  animation: pulse-current 2s infinite;
}

/* 连接线动画 */
.w-3 {
  transition: all 0.3s ease-in-out;
}

/* 悬停效果 */
.h-12.w-12:hover {
  transform: scale(1.05);
  transition: transform 0.2s ease-in-out;
}

/* 确保容器有足够的空间容纳动画 */
.flex.items-center.gap-3 {
  min-height: 3rem;
  padding: 0.5rem;
}
</style>
