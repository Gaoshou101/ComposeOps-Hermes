import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useEscapeKey } from '../src/composables/useEscapeKey.js';

/**
 * 最小单元测试:验证 Esc 关闭栈的层级优先级、单次 Esc 只关顶层、
 * 以及 body 滚动锁在多层叠加下的计数与释放。
 */

let wrapper;

function createRouterInstance() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/other', component: { template: '<div />' } },
    ],
  });
}

function fireEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function mountHarness(configs, router) {
  return mount(
    {
      setup() {
        for (const config of configs) {
          const active = ref(true);
          const spy = vi.fn(() => {
            active.value = false;
          });
          config.active = active;
          config.spy = spy;
          useEscapeKey({ active, onClose: spy, layer: config.layer, lockBody: !!config.lockBody });
        }
        return () => null;
      },
    },
    { global: { plugins: [router] } }
  );
}

beforeEach(() => {
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper?.unmount();
});

describe('useEscapeKey', () => {
  it('压栈按权重排序:modal 在顶层,单次 Esc 只关闭它', async () => {
    const router = createRouterInstance();
    await router.push('/');
    await router.isReady();

    const configs = [
      { layer: 'drawer' },
      { layer: 'event' },
      { layer: 'command' },
      { layer: 'modal' },
    ];
    wrapper = mountHarness(configs, router);
    await nextTick();

    fireEscape();
    const modal = configs.find((c) => c.layer === 'modal');
    const others = configs.filter((c) => c !== modal);
    expect(modal.spy).toHaveBeenCalledTimes(1);
    for (const other of others) expect(other.spy).not.toHaveBeenCalled();
  });

  it('多弹层并存时,按一次 Esc 仅关闭最顶层', async () => {
    const router = createRouterInstance();
    await router.push('/');
    await router.isReady();

    const configs = [{ layer: 'drawer' }, { layer: 'drawer' }];
    wrapper = mountHarness(configs, router);
    await nextTick();

    fireEscape();
    expect(configs[1].spy).toHaveBeenCalledTimes(1);
    expect(configs[0].spy).not.toHaveBeenCalled();

    await nextTick(); // watch 出栈需一个 tick,与真实交互时序一致
    fireEscape();
    expect(configs[0].spy).toHaveBeenCalledTimes(1);
  });

  it('body 滚动锁计数:全部关闭后才解锁;路由切换自动清场', async () => {
    const router = createRouterInstance();
    await router.push('/');
    await router.isReady();

    const configs = [
      { layer: 'modal', lockBody: true },
      { layer: 'drawer', lockBody: true },
    ];
    wrapper = mountHarness(configs, router);
    await nextTick();

    expect(document.body.style.overflow).toBe('hidden');

    // 关闭顶层 drawer
    configs[1].active.value = false;
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden'); // modal 仍持有锁

    // 关闭 modal
    configs[0].active.value = false;
    await nextTick();
    expect(document.body.style.overflow).toBe('');

    // 重新打开 modal,随后路由切换应自动清场并释放锁
    configs[0].active.value = true;
    await nextTick();
    expect(document.body.style.overflow).toBe('hidden');
    await router.push('/other');
    await nextTick();
    expect(document.body.style.overflow).toBe('');
  });
});
