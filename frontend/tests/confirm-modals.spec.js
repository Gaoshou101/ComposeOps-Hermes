import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import BatchConfirmModal from '../src/components/agent/BatchConfirmModal.vue';
import ToolConfirmModal from '../src/components/agent/ToolConfirmModal.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [],
});

const mountOptions = (props) => ({
  props,
  global: { 
    plugins: [router],
    stubs: { Teleport: true },
  },
  attachTo: document.body,
});

describe('BatchConfirmModal', () => {
  describe('步骤确认状态', () => {
    it('初始化时所有步骤未确认', () => {
      const steps = [
        { tool: 'compose.restart', params: {}, risk: 'high', confirmed: false },
        { tool: 'compose.down', params: {}, risk: 'critical', confirmed: false },
      ];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      expect(wrapper.vm.confirmedCount).toBe(0);
      expect(wrapper.vm.unconfirmedCount).toBe(2);
      wrapper.unmount();
    });

    it('选中步骤后计数更新', async () => {
      const steps = [
        { tool: 'compose.restart', params: {}, risk: 'high', confirmed: false },
        { tool: 'compose.down', params: {}, risk: 'critical', confirmed: false },
      ];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      const checkbox = wrapper.find('#step-0');
      await checkbox.setValue(true);
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.confirmedCount).toBe(1);
      expect(wrapper.vm.unconfirmedCount).toBe(1);
      expect(wrapper.vm.allChecked).toBe(false);
      wrapper.unmount();
    });

    it('全选切换所有步骤状态', async () => {
      const steps = [
        { tool: 'compose.restart', params: {}, confirmed: false },
        { tool: 'compose.down', params: {}, confirmed: false },
      ];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      await wrapper.vm.$nextTick();
      const checkbox = wrapper.find('#select-all');
      await checkbox.setValue(true);
      
      expect(steps[0].confirmed).toBe(true);
      expect(steps[1].confirmed).toBe(true);
      expect(wrapper.vm.allChecked).toBe(true);
      wrapper.unmount();
    });
  });

  describe('参数编辑', () => {
    it('点击编辑按钮展开参数编辑器', async () => {
      const steps = [
        { tool: 'compose.restart', params: { service: 'web' }, confirmed: false },
      ];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      expect(wrapper.vm.editingIdx).toBe(-1);
      
      await wrapper.vm.$nextTick();
      const buttons = wrapper.findAll('button');
      const editBtn = buttons.find((btn) => btn.text().includes('编辑参数'));
      expect(editBtn).toBeDefined();
      await editBtn.trigger('click');
      
      expect(wrapper.vm.editingIdx).toBe(0);
      expect(wrapper.vm.paramsText).toBe(JSON.stringify({ service: 'web' }, null, 2));
      wrapper.unmount();
    });

    it('JSON 解析失败时显示错误', async () => {
      const steps = [{ tool: 'compose.restart', params: {}, confirmed: false }];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      wrapper.vm.editingIdx = 0;
      wrapper.vm.paramsText = '{ invalid json }';
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.parseError).toContain('JSON 解析失败');
      wrapper.unmount();
    });

    it('非对象 JSON 显示参数类型错误', async () => {
      const steps = [{ tool: 'compose.restart', params: {}, confirmed: false }];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      wrapper.vm.editingIdx = 0;
      wrapper.vm.paramsText = '["array"]';
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.parseError).toBe('参数必须是 JSON 对象');
      wrapper.unmount();
    });

    it('编辑完成后更新步骤参数', () => {
      const steps = [{ tool: 'compose.restart', params: { service: 'web' }, confirmed: false }];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      wrapper.vm.editingIdx = 0;
      wrapper.vm.paramsText = JSON.stringify({ service: 'api', replicas: 2 }, null, 2);
      wrapper.vm.closeEdit();
      
      expect(steps[0].params).toEqual({ service: 'api', replicas: 2 });
      wrapper.unmount();
    });
  });

  describe('确认行为', () => {
    it('未确认完所有步骤时禁用确认按钮', async () => {
      const steps = [
        { tool: 'a', params: {}, confirmed: true },
        { tool: 'b', params: {}, confirmed: false },
      ];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      const confirmBtn = wrapper.findAll('button').find((btn) => btn.text().includes('确认执行'));
      expect(confirmBtn).toBeDefined();
      expect(confirmBtn.element.disabled).toBe(true);
      wrapper.unmount();
    });

    it('确认所有步骤后触发 confirm 事件', async () => {
      const steps = [
        { tool: 'a', params: {}, confirmed: true },
        { tool: 'b', params: {}, confirmed: true },
      ];
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps }));
      
      await wrapper.vm.confirmAll();
      
      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')[0][0]).toStrictEqual(steps);
      wrapper.unmount();
    });

    it('取消时触发 cancel 事件', async () => {
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps: [] }));
      
      await wrapper.vm.$emit('cancel');
      
      expect(wrapper.emitted('cancel')).toBeTruthy();
      wrapper.unmount();
    });
  });

  describe('参数格式化', () => {
    it('formatParams 过滤空值并格式化', () => {
      const wrapper = mount(BatchConfirmModal, mountOptions({ show: true, steps: [] }));
      
      expect(wrapper.vm.formatParams({})).toBe('无参数');
      expect(wrapper.vm.formatParams({ a: 'val', b: null, c: '' })).toBe('a=val');
      expect(wrapper.vm.formatParams({ a: [1, 2], b: 'x' })).toBe('a=1,2 b=x');
      wrapper.unmount();
    });
  });
});

describe('ToolConfirmModal', () => {
  describe('参数显示与编辑', () => {
    it('无参数时不显示编辑器', () => {
      const tool = { name: 'compose.ps', description: '查看容器状态', risk: 'low', input: null };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      expect(wrapper.vm.hasParams).toBe(false);
      expect(wrapper.find('#tool-params').exists()).toBe(false);
      wrapper.unmount();
    });

    it('有参数时初始化为 JSON 字符串', async () => {
      const tool = {
        name: 'compose.restart',
        description: '重启服务',
        risk: 'high',
        input: { service: 'web', timeout: 30 },
      };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: false, tool }));
      
      await wrapper.setProps({ show: true });
      
      expect(wrapper.vm.paramText).toBe(JSON.stringify(tool.input, null, 2));
      wrapper.unmount();
    });

    it('还原按钮重置为原始参数', async () => {
      const tool = { name: 'tool', description: '', risk: 'low', input: { a: 1 } };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      wrapper.vm.paramText = '{"a": 999}';
      await wrapper.vm.resetParams();
      
      expect(wrapper.vm.paramText).toBe(JSON.stringify({ a: 1 }, null, 2));
      wrapper.unmount();
    });

    it('JSON 解析错误时显示错误消息', async () => {
      const tool = { name: 'tool', description: '', risk: 'low', input: { a: 1 } };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      wrapper.vm.paramText = '{ bad json';
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.parseError).toContain('JSON 解析失败');
      wrapper.unmount();
    });
  });

  describe('风险提示', () => {
    it('极高风险操作显示警告区块', async () => {
      const tool = {
        name: 'compose.down',
        description: '停止并删除所有容器',
        risk: 'critical',
        input: {},
      };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      await wrapper.vm.$nextTick();
      const warning = wrapper.find('div[class*="border-rose"]');
      expect(warning.exists()).toBe(true);
      expect(warning.text()).toContain('重要提醒');
      wrapper.unmount();
    });

    it('低风险操作不显示警告', () => {
      const tool = { name: 'compose.ps', description: '', risk: 'low', input: {} };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      expect(wrapper.find('div[class*="border-rose"]').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('确认行为', () => {
    it('无参数时确认返回 null', async () => {
      const tool = { name: 'compose.ps', description: '', risk: 'low', input: null };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      await wrapper.vm.confirm();
      
      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')[0][0]).toBe(null);
      wrapper.unmount();
    });

    it('有参数时确认返回解析后的 JSON', async () => {
      const tool = { name: 'tool', description: '', risk: 'low', input: { a: 1 } };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      wrapper.vm.paramText = '{"service": "api", "replicas": 3}';
      await wrapper.vm.confirm();
      
      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')[0][0]).toEqual({ service: 'api', replicas: 3 });
      wrapper.unmount();
    });

    it('JSON 解析错误时阻止确认', async () => {
      const tool = { name: 'tool', description: '', risk: 'low', input: { a: 1 } };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      wrapper.vm.paramText = '{ invalid }';
      await wrapper.vm.confirm();
      
      expect(wrapper.emitted('confirm')).toBeFalsy();
      wrapper.unmount();
    });

    it('取消时触发 cancel 事件', async () => {
      const tool = { name: 'tool', description: '', risk: 'low', input: {} };
      const wrapper = mount(ToolConfirmModal, mountOptions({ show: true, tool }));
      
      await wrapper.vm.$emit('cancel');
      
      expect(wrapper.emitted('cancel')).toBeTruthy();
      wrapper.unmount();
    });
  });
});
