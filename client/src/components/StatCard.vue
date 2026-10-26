<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  title: string
  value: number | string
  icon?: string
  color?: string
  suffix?: string
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'DataLine',
  color: '#409eff',
  suffix: ''
})

/** 格式化数值：大数字转万 */
const formattedValue = computed(() => {
  if (typeof props.value === 'string') return props.value
  if (props.value >= 10000) {
    return (props.value / 10000).toFixed(1) + '万'
  }
  return props.value.toLocaleString()
})

/** 是否显示后缀 */
const showSuffix = computed(() => props.suffix !== '')

/** 图标强调样式（单色，不使用渐变） */
const iconStyle = computed(() => ({
  background: 'var(--color-bg-elevated)',
  color: props.color,
  boxShadow: `inset 0 0 0 1px ${props.color}40`,
}))
</script>

<template>
  <div class="stat-card">
    <div class="stat-card__content">
      <div class="stat-card__icon" :style="iconStyle">
        <el-icon :size="28">
          <component :is="icon" />
        </el-icon>
      </div>
      <div class="stat-card__info">
        <div class="stat-card__value">
          {{ formattedValue }}
          <span v-if="showSuffix" class="stat-card__suffix">{{ suffix }}</span>
        </div>
        <div class="stat-card__title">{{ title }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  border-radius: var(--border-radius-large);
  padding: 20px;
  background-color: var(--color-bg-card);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--color-border-lighter);
  box-shadow: var(--box-shadow-raised);
  transition: all 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--box-shadow-hover);
}

.stat-card__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.stat-card__icon {
  width: 56px;
  height: 56px;
  border-radius: var(--border-radius-base);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-card__info {
  flex: 1;
  text-align: right;
}

.stat-card__value {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.stat-card__suffix {
  font-size: 14px;
  font-weight: 400;
  color: var(--color-text-secondary);
  margin-left: 4px;
}

.stat-card__title {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-top: 4px;
  font-weight: 500;
}
</style>
