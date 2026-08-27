<template>
  <div class="card overflow-hidden">
    <div class="flex items-center justify-between border-b border-surface-800/80 bg-surface-950/30 px-4 py-3 text-xs font-medium text-surface-400"><span>{{ title }}</span><span class="h-1.5 w-1.5 rounded-full bg-accent/80"></span></div>
    <div class="px-4 py-4">
      <div class="text-2xl font-semibold tracking-tight font-mono text-surface-50">{{ value }}</div>
      <div class="text-muted mt-1">{{ sub }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({ title: String, value: String, sub: String });
</script>
