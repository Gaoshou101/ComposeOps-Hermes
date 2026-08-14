<template>
  <aside class="fixed md:static bottom-0 left-0 right-0 z-40 h-14 md:h-auto md:w-48 bg-surface-900 border-t md:border-t-0 md:border-r border-surface-800 shrink-0 flex flex-col">
    <nav class="flex md:block flex-1 md:py-2 overflow-x-auto">
      <router-link
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex-1 min-w-16 md:min-w-0 flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 text-xs md:text-sm text-surface-400 hover:bg-surface-800 hover:text-surface-100 transition-colors"
        active-class="bg-surface-800 text-white md:border-l-2 border-accent"
      >
        <component :is="item.icon" class="w-4 h-4" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </aside>
</template>

<script setup>
import { Boxes, FileCode2, ScrollText, TerminalSquare, Bot, ChartNoAxesCombined, History, Settings } from 'lucide-vue-next';
const items = [
  { to: '/services', icon: Boxes, label: '服务' },
  { to: '/compose', icon: FileCode2, label: '配置' },
  { to: '/logs', icon: ScrollText, label: '日志' },
  { to: '/shell', icon: TerminalSquare, label: '终端' },
  { to: '/ai', icon: Bot, label: 'AI' },
  { to: '/monitor', icon: ChartNoAxesCombined, label: '监控' },
  { to: '/operations', icon: History, label: '记录' },
  { to: '/settings', icon: Settings, label: '设置' },
];
</script>
