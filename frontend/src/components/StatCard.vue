<template>
  <div class="card">
    <div class="px-3 py-2 border-b border-surface-800 text-xs text-surface-400">{{ title }}</div>
    <div class="px-3 py-3">
      <div class="text-lg font-semibold font-mono">{{ value }}</div>
      <div class="text-xs text-surface-500 mt-0.5">{{ sub }}</div>
    </div>
  </div>
</template>

<script setup>
defineProps({ title: String, value: String, sub: String });
</script>
