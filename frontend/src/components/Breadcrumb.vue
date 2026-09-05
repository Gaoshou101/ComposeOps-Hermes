<template>
  <nav class="flex items-center gap-1.5 text-sm text-surface-400" aria-label="面包屑导航">
    <template v-for="(item, index) in items" :key="index">
      <ChevronRight v-if="index > 0" class="w-3.5 h-3.5 text-surface-600" />
      <component
        :is="item.to ? 'router-link' : 'span'"
        :to="item.to"
        :class="[
          'transition-colors',
          item.to ? 'hover:text-surface-200' : 'text-surface-200 font-medium',
        ]"
      >
        {{ item.label }}
      </component>
    </template>
  </nav>
</template>

<script setup>
import { ChevronRight } from 'lucide-vue-next';

defineProps({
  items: { type: Array, required: true },
});
</script>
