<template>
  <div class="flex flex-col gap-3" role="status" :aria-label="label">
    <div v-for="i in rows" :key="i" class="skeleton-bar rounded-md" :style="{ animationDelay: `${(i - 1) * 90}ms` }"></div>
  </div>
</template>

<script setup>
defineProps({ rows: { type: Number, default: 6 }, label: { type: String, default: '加载中' } });
</script>
