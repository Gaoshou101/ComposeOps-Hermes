<template>
  <span class="status-badge" :class="badgeClass" :title="tooltip">
    <span v-if="showIcon" class="badge-icon">
      <svg v-if="status === 'running' || status === 'healthy'" class="icon" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
      </svg>
      <svg v-else-if="status === 'unhealthy' || status === 'exited' || status === 'dead'" class="icon" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
      </svg>
      <svg v-else-if="status === 'restarting' || status === 'starting'" class="icon animate-spin" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
      </svg>
      <svg v-else-if="status === 'paused'" class="icon" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
      </svg>
      <svg v-else class="icon" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
      </svg>
    </span>
    <span class="badge-text">{{ label }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: { type: String, default: '' },
  health: { type: String, default: '' },
  showIcon: { type: Boolean, default: true },
  size: { type: String, default: 'md', validator: (v) => ['sm', 'md', 'lg'].includes(v) }
});

const effectiveStatus = computed(() => {
  if (props.health === 'healthy') return 'healthy';
  if (props.health === 'unhealthy') return 'unhealthy';
  return props.status || 'unknown';
});

const badgeClass = computed(() => {
  const status = effectiveStatus.value.toLowerCase();
  const classes = [`size-${props.size}`];
  
  if (status === 'running' || status === 'healthy') {
    classes.push('badge-success');
  } else if (status === 'unhealthy' || status === 'exited' || status === 'dead') {
    classes.push('badge-danger');
  } else if (status === 'restarting' || status === 'starting') {
    classes.push('badge-warning');
  } else if (status === 'paused') {
    classes.push('badge-info');
  } else {
    classes.push('badge-secondary');
  }
  
  return classes.join(' ');
});

const label = computed(() => {
  const status = effectiveStatus.value;
  const labels = {
    running: '运行中',
    healthy: '健康',
    unhealthy: '不健康',
    exited: '已停止',
    dead: '已终止',
    restarting: '重启中',
    starting: '启动中',
    paused: '已暂停',
    created: '已创建',
    removing: '删除中',
    unknown: '未知'
  };
  return labels[status.toLowerCase()] || status;
});

const tooltip = computed(() => {
  if (props.health && props.status) {
    return `状态: ${props.status} | 健康: ${props.health}`;
  }
  return label.value;
});
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.25;
  letter-spacing: 0.01em;
  white-space: nowrap;
  transition: all 0.15s;
}

.status-badge.size-sm {
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  gap: 0.25rem;
}

.status-badge.size-lg {
  padding: 0.375rem 1rem;
  font-size: 0.875rem;
  gap: 0.5rem;
}

.badge-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.size-sm .icon {
  width: 0.875rem;
  height: 0.875rem;
}

.size-lg .icon {
  width: 1.125rem;
  height: 1.125rem;
}

.badge-text {
  font-weight: 500;
}

/* Success - running/healthy */
.badge-success {
  background: rgb(34 197 94 / 0.12);
  color: rgb(134 239 172);
  border: 1px solid rgb(34 197 94 / 0.2);
}

.badge-success:hover {
  background: rgb(34 197 94 / 0.18);
  border-color: rgb(34 197 94 / 0.3);
}

/* Danger - unhealthy/exited/dead */
.badge-danger {
  background: rgb(239 68 68 / 0.12);
  color: rgb(252 165 165);
  border: 1px solid rgb(239 68 68 / 0.2);
}

.badge-danger:hover {
  background: rgb(239 68 68 / 0.18);
  border-color: rgb(239 68 68 / 0.3);
}

/* Warning - restarting/starting */
.badge-warning {
  background: rgb(251 191 36 / 0.12);
  color: rgb(253 224 71);
  border: 1px solid rgb(251 191 36 / 0.2);
}

.badge-warning:hover {
  background: rgb(251 191 36 / 0.18);
  border-color: rgb(251 191 36 / 0.3);
}

/* Info - paused */
.badge-info {
  background: rgb(14 165 233 / 0.12);
  color: rgb(125 211 252);
  border: 1px solid rgb(14 165 233 / 0.2);
}

.badge-info:hover {
  background: rgb(14 165 233 / 0.18);
  border-color: rgb(14 165 233 / 0.3);
}

/* Secondary - unknown/other */
.badge-secondary {
  background: rgb(148 163 184 / 0.12);
  color: rgb(203 213 225);
  border: 1px solid rgb(148 163 184 / 0.2);
}

.badge-secondary:hover {
  background: rgb(148 163 184 / 0.18);
  border-color: rgb(148 163 184 / 0.3);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
