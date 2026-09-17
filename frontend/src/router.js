import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/services', name: 'services', component: () => import('./views/ServicesView.vue') },
  { path: '/compose', name: 'compose', component: () => import('./views/ComposeView.vue') },
  { path: '/logs', name: 'logs', component: () => import('./views/LogsView.vue') },
  { path: '/shell', name: 'shell', component: () => import('./views/ShellView.vue') },
  { path: '/converter', name: 'converter', component: () => import('./views/ConverterView.vue') },
  { path: '/ai', redirect: '/agent' },
  { path: '/agent', name: 'agent', component: () => import('./views/AgentWorkflowView.vue') },
  { path: '/agent/history', name: 'agent-history', component: () => import('./views/AgentExecutionHistoryView.vue') },
  { path: '/monitor', name: 'monitor', component: () => import('./views/MonitorView.vue') },
  { path: '/inspection', name: 'inspection', component: () => import('./views/InspectionView.vue') },
  { path: '/metrics', name: 'metrics', component: () => import('./views/ResourceMonitorView.vue') },
  { path: '/resources', name: 'resources', component: () => import('./views/ResourcesView.vue') },
  { path: '/operations', name: 'operations', component: () => import('./views/OperationsView.vue') },
  { path: '/timeline', name: 'timeline', component: () => import('./views/TimelineView.vue') },
  { path: '/topology', name: 'topology', component: () => import('./views/TopologyView.vue') },
  { path: '/review', name: 'review', component: () => import('./views/ChangeReviewView.vue') },
  { path: '/rollback', name: 'rollback', component: () => import('./views/RollbackView.vue') },
  { path: '/ops-center', name: 'ops-center', component: () => import('./views/OperationsCenterView.vue') },
  { path: '/blueprints', redirect: '/marketplace' },
  { path: '/cron', name: 'cron', component: () => import('./views/CronTasksView.vue') },
  { path: '/gitops', name: 'gitops', component: () => import('./views/GitOpsView.vue') },
  { path: '/cost', name: 'cost', component: () => import('./views/CostAnalysisView.vue') },
  { path: '/marketplace', name: 'marketplace', component: () => import('./views/MarketplaceView.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/services' },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});

/**
 * 空闲时预取全部路由 chunk:首访每个页面不再触发下载+解析,
 * 消除"第一次切到某页顿一下"的感知。失败静默,进入页面时仍会正常加载。
 */
export function preloadRouteChunks() {
  for (const route of routes) {
    if (typeof route.component === 'function') {
      route.component().catch(() => {});
    }
  }
}
