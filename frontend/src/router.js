import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/services' },
  { path: '/services', name: 'services', component: () => import('./views/ServicesView.vue') },
  { path: '/compose', name: 'compose', component: () => import('./views/ComposeView.vue') },
  { path: '/logs', name: 'logs', component: () => import('./views/LogsView.vue') },
  { path: '/shell', name: 'shell', component: () => import('./views/ShellView.vue') },
  { path: '/converter', name: 'converter', component: () => import('./views/ConverterView.vue') },
  { path: '/ai', name: 'ai', component: () => import('./views/AiView.vue') },
  { path: '/agent', name: 'agent', component: () => import('./views/AgentWorkflowView.vue') },
  { path: '/agent/history', name: 'agent-history', component: () => import('./views/AgentExecutionHistoryView.vue') },
  { path: '/monitor', name: 'monitor', component: () => import('./views/MonitorView.vue') },
  { path: '/metrics', name: 'metrics', component: () => import('./views/ResourceMonitorView.vue') },
  { path: '/resources', name: 'resources', component: () => import('./views/ResourcesView.vue') },
  { path: '/operations', name: 'operations', component: () => import('./views/OperationsView.vue') },
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
