<template>
  <aside class="app-sidebar fixed md:static bottom-0 left-0 right-0 z-40 h-16 md:h-auto md:w-[216px] shrink-0 flex flex-col">
    <nav class="flex md:flex-col flex-1 md:px-3 md:py-4 overflow-x-auto md:overflow-y-auto">
      <template v-for="group in groups" :key="group.label">
        <div class="hidden md:block px-2 pb-1 pt-3 first:pt-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-surface-600">{{ group.label }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-link group flex-1 min-w-16 md:flex-none md:min-w-0 flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-3 px-2 md:px-3 py-1.5 md:py-2.5 text-[11px] md:text-sm text-surface-400"
          active-class="nav-link-active"
        >
          <component :is="item.icon" class="w-[18px] h-[18px] shrink-0" />
          <span class="md:flex-1">{{ item.label }}</span>
          <span class="nav-indicator hidden md:block w-1.5 h-1.5 rounded-full bg-accent opacity-0"></span>
        </router-link>
      </template>
    </nav>
    <div class="hidden md:block mx-4 mb-4 rounded-xl border border-surface-800/80 bg-surface-950/50 p-3">
      <div class="flex items-center gap-2 text-xs text-surface-300"><span class="status-dot bg-emerald-400"></span>本地控制台</div>
      <p class="mt-1.5 text-[11px] leading-4 text-surface-600">集中管理 Compose 服务与运行状态</p>
    </div>
  </aside>
</template>

<script setup>
import { Boxes, Clock3, FileCode2, ScrollText, TerminalSquare, Bot, ChartNoAxesCombined, History, Settings, Store } from 'lucide-vue-next';
const groups = [
  { label: '运行', items: [
    { to: '/services', icon: Boxes, label: '服务' },
    { to: '/compose', icon: FileCode2, label: '配置' },
  ] },
  { label: '排障', items: [
    { to: '/logs', icon: ScrollText, label: '日志' },
    { to: '/shell', icon: TerminalSquare, label: '终端' },
    { to: '/ai', icon: Bot, label: 'AI' },
    { to: '/monitor', icon: ChartNoAxesCombined, label: '监控' },
  ] },
  { label: '扩展', items: [
    { to: '/blueprints', icon: Store, label: '应用市场' },
    { to: '/cron', icon: Clock3, label: '定时任务' },
  ] },
  { label: '系统', items: [
    { to: '/operations', icon: History, label: '记录' },
    { to: '/settings', icon: Settings, label: '设置' },
  ] },
];
</script>
