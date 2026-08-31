<template>
  <div class="flex flex-col gap-3" role="status" :aria-label="label">
    <template v-if="variant === 'cards'">
      <div v-for="i in rows" :key="i" class="skeleton-card rounded-xl" :style="{ animationDelay: `${(i - 1) * 80}ms` }">
        <div class="flex items-center gap-2 px-2">
          <span class="skeleton-bar w-10 shrink-0" style="height: 1.1rem"></span>
          <span class="skeleton-bar w-24" style="height: 0.9rem"></span>
          <span class="skeleton-bar ml-auto w-20" style="height: 0.85rem"></span>
        </div>
        <div class="mt-3 flex items-center gap-2 px-2">
          <span class="skeleton-bar w-16" style="height: 1.5rem"></span>
          <span class="skeleton-bar w-16" style="height: 1.5rem"></span>
          <span class="skeleton-bar ml-auto w-28" style="height: 1rem"></span>
        </div>
      </div>
    </template>
    <template v-else-if="variant === 'table'">
      <div class="skeleton-card rounded-xl p-4">
        <div class="mb-3 flex items-center gap-2">
          <span class="skeleton-bar w-32" style="height: 0.9rem"></span>
          <span class="skeleton-bar w-20 ml-auto" style="height: 0.85rem"></span>
        </div>
        <div v-for="i in rows" :key="i" class="mb-2.5 flex items-center gap-3" :style="{ animationDelay: `${(i - 1) * 70}ms` }">
          <span class="skeleton-bar w-1/4" style="height: 0.8rem"></span>
          <span class="skeleton-bar w-1/5" style="height: 0.8rem"></span>
          <span class="skeleton-bar w-1/6 ml-auto" style="height: 0.8rem"></span>
        </div>
      </div>
    </template>
    <template v-else>
      <div v-for="i in rows" :key="i" class="skeleton-bar rounded-md" :style="{ animationDelay: `${(i - 1) * 90}ms` }"></div>
    </template>
  </div>
</template>

<script setup>
defineProps({
  rows: { type: Number, default: 6 },
  label: { type: String, default: '加载中' },
  variant: { type: String, default: 'bars', validator: (v) => ['bars', 'cards', 'table'].includes(v) },
});
</script>
