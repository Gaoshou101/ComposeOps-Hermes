import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkflowDAG from '../src/components/agent/WorkflowDAG.vue';

describe('WorkflowDAG', () => {
  describe('节点状态推导', () => {
    it('无结果时第一个节点为 executing,其余为 pending', () => {
      const steps = [
        { tool: 'compose.ps', params: {} },
        { tool: 'compose.restart', params: {} },
      ];
      const wrapper = mount(WorkflowDAG, { props: { steps, results: [] } });
      const nodes = wrapper.vm.nodes;
      expect(nodes[0].status).toBe('executing');
      expect(nodes[1].status).toBe('pending');
    });

    it('当前执行步骤为 executing', () => {
      const steps = [
        { tool: 'compose.ps', params: {} },
        { tool: 'compose.restart', params: {} },
      ];
      const results = [{ tool: 'compose.ps', status: 'success', durationMs: 120 }];
      const wrapper = mount(WorkflowDAG, { props: { steps, results } });
      const nodes = wrapper.vm.nodes;
      expect(nodes[0].status).toBe('success');
      expect(nodes[1].status).toBe('executing');
    });

    it('已完成步骤根据 result.status 推导', () => {
      const steps = [
        { tool: 'compose.ps', params: {} },
        { tool: 'compose.restart', params: {} },
        { tool: 'compose.logs', params: {} },
      ];
      const results = [
        { tool: 'compose.ps', status: 'success', durationMs: 120 },
        { tool: 'compose.restart', status: 'failed', error: 'timeout' },
      ];
      const wrapper = mount(WorkflowDAG, { props: { steps, results } });
      const nodes = wrapper.vm.nodes;
      expect(nodes[0].status).toBe('success');
      expect(nodes[1].status).toBe('failed');
      expect(nodes[2].status).toBe('executing');
    });

    it('currentStepIndex 标记 isCurrent', () => {
      const steps = [
        { tool: 'compose.ps', params: {} },
        { tool: 'compose.restart', params: {} },
      ];
      const wrapper = mount(WorkflowDAG, { props: { steps, results: [], currentStepIndex: 1 } });
      const nodes = wrapper.vm.nodes;
      expect(nodes[0].isCurrent).toBe(false);
      expect(nodes[1].isCurrent).toBe(true);
    });
  });

  describe('节点标签显示', () => {
    it('成功/失败节点显示耗时', () => {
      const steps = [{ tool: 'compose.ps', params: {} }];
      const results = [{ tool: 'compose.ps', status: 'success', durationMs: 256 }];
      const wrapper = mount(WorkflowDAG, { props: { steps, results } });
      expect(wrapper.vm.nodes[0].label).toBe('256ms');
    });

    it('高风险步骤显示风险等级', () => {
      const steps = [
        { tool: 'compose.restart', params: {}, risk: 'high' },
        { tool: 'compose.down', params: {}, risk: 'critical' },
      ];
      const wrapper = mount(WorkflowDAG, { props: { steps, results: [] } });
      expect(wrapper.vm.nodes[0].label).toBe('高风险');
      expect(wrapper.vm.nodes[1].label).toBe('极高风险');
    });

    it('需确认步骤显示提示', () => {
      const steps = [{ tool: 'compose.restart', params: {}, confirmationRequired: true }];
      const wrapper = mount(WorkflowDAG, { props: { steps, results: [] } });
      expect(wrapper.vm.nodes[0].label).toBe('需确认');
    });
  });

  describe('布局计算', () => {
    it('3 列网格布局', () => {
      const steps = Array.from({ length: 5 }, (_, i) => ({ tool: `tool-${i}`, params: {} }));
      const wrapper = mount(WorkflowDAG, { props: { steps, results: [] } });
      const nodes = wrapper.vm.nodes;
      
      // 第一行 (idx 0-2)
      expect(nodes[0].x).toBe(20);
      expect(nodes[0].y).toBe(20);
      expect(nodes[2].y).toBe(20);
      
      // 第二行 (idx 3-4)
      expect(nodes[3].y).toBe(20 + 56 + 80); // nodeHeight + verticalGap
    });

    it('宽高根据节点数量动态计算', () => {
      const wrapper1 = mount(WorkflowDAG, {
        props: { steps: [{ tool: 'a', params: {} }], results: [] },
      });
      const wrapper5 = mount(WorkflowDAG, {
        props: { steps: Array.from({ length: 5 }, (_, i) => ({ tool: `t${i}`, params: {} })), results: [] },
      });
      
      // 1 个节点: 1 列 1 行
      expect(wrapper1.vm.width).toBe(1 * 180 + 0 * 60 + 40);
      expect(wrapper1.vm.height).toBe(1 * 56 + 0 * 80 + 40);
      
      // 5 个节点: 3 列 2 行
      expect(wrapper5.vm.width).toBe(3 * 180 + 2 * 60 + 40);
      expect(wrapper5.vm.height).toBe(2 * 56 + 1 * 80 + 40);
    });
  });

  describe('边渲染', () => {
    it('连续成功节点使用 success 渐变', () => {
      const steps = [
        { tool: 'a', params: {} },
        { tool: 'b', params: {} },
      ];
      const results = [
        { tool: 'a', status: 'success', durationMs: 100 },
      ];
      const wrapper = mount(WorkflowDAG, { props: { steps, results } });
      const edges = wrapper.vm.edges;
      expect(edges[0].gradient).toBe('url(#edge-gradient-success)');
      expect(edges[0].class).toBe('opacity-100');
    });

    it('失败节点后的边使用 failed 渐变', () => {
      const steps = [
        { tool: 'a', params: {} },
        { tool: 'b', params: {} },
      ];
      const results = [
        { tool: 'a', status: 'failed', error: 'err' },
      ];
      const wrapper = mount(WorkflowDAG, { props: { steps, results } });
      const edges = wrapper.vm.edges;
      expect(edges[0].gradient).toBe('url(#edge-gradient-failed)');
    });

    it('未执行边使用 pending 渐变', () => {
      const steps = [
        { tool: 'a', params: {} },
        { tool: 'b', params: {} },
      ];
      const wrapper = mount(WorkflowDAG, { props: { steps, results: [] } });
      const edges = wrapper.vm.edges;
      expect(edges[0].gradient).toBe('url(#edge-gradient-pending)');
      expect(edges[0].class).toBe('opacity-50');
    });
  });

  describe('交互', () => {
    it('点击节点触发 node-click 事件', async () => {
      const steps = [{ tool: 'compose.ps', params: { projectId: 'p1' } }];
      const wrapper = mount(WorkflowDAG, { props: { steps, results: [] } });
      
      await wrapper.find('g[transform="translate(20, 20)"]').trigger('click');
      
      expect(wrapper.emitted('node-click')).toBeTruthy();
      expect(wrapper.emitted('node-click')[0][0]).toMatchObject({
        tool: 'compose.ps',
        params: { projectId: 'p1' },
      });
    });
  });
});
