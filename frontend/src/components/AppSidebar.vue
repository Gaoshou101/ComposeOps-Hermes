<template>
  <aside class="w-48 bg-surface-900 border-r border-surface-800 shrink-0 flex flex-col">
    <nav class="flex-1 py-2">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2 px-4 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-surface-100 transition-colors"
        active-class="bg-surface-800 text-white border-l-2 border-accent"
      >
        <span>{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </aside>
</template>

<script setup>
const items = [
  { to: '/services', icon: '📦', label: '服务' },
  { to: '/compose', icon: '📝', label: 'Compose' },
  { to: '/logs', icon: '📜', label: '日志' },
  { to: '/shell', icon: '🖥️', label: '终端' },
  { to: '/ai', icon: '🤖', label: 'AI 助手' },
  { to: '/monitor', icon: '📊', label: '监控' },
  { to: '/settings', icon: '⚙️', label: '设置' },
];
</script>
