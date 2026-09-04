<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show" class="modal-backdrop" @click.self="$emit('close')">
        <Transition name="modal-pop" appear>
          <div class="modal" :class="sizeClass" role="dialog" aria-modal="true" :aria-label="title">
            <div class="modal-header">
              <span class="truncate">{{ title }}</span>
              <div class="flex items-center gap-1">
                <slot name="header-actions" />
                <button class="icon-btn" aria-label="关闭" @click="$emit('close')"><X class="w-4 h-4" /></button>
              </div>
            </div>
            <div :class="bodyClass">
              <slot />
            </div>
            <footer v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-surface-800 px-4 py-2.5">
              <slot name="footer" />
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';
import { X } from 'lucide-vue-next';
import { useEscapeKey } from '../../composables/useEscapeKey.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // 覆盖 .modal 默认宽度(utilities 层级高于 components 层,可生效)
  sizeClass: { type: String, default: '' },
  bodyClass: { type: String, default: 'p-3' },
});

const emit = defineEmits(['close']);

useEscapeKey({
  active: computed(() => props.show),
  onClose: () => emit('close'),
  layer: 'modal',
  lockBody: true,
});
</script>
