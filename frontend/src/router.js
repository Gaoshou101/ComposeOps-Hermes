import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/services' },
  { path: '/services', name: 'services', component: () => import('./views/ServicesView.vue') },
  { path: '/compose', name: 'compose', component: () => import('./views/ComposeView.vue') },
  { path: '/logs', name: 'logs', component: () => import('./views/LogsView.vue') },
  { path: '/shell', name: 'shell', component: () => import('./views/ShellView.vue') },
  { path: '/ai', name: 'ai', component: () => import('./views/AiView.vue') },
  { path: '/agent', name: 'agent', component: () => import('./views/AgentWorkflowView.vue') },
  { path: '/agent/history', name: 'agent-history', component: () => import('./views/AgentExecutionHistoryView.vue') },
  { path: '/monitor', name: 'monitor', component: () => import('./views/MonitorView.vue') },
  { path: '/resources', name: 'resources', component: () => import('./views/ResourcesView.vue') },
  { path: '/operations', name: 'operations', component: () => import('./views/OperationsView.vue') },
  { path: '/blueprints', name: 'blueprints', component: () => import('./views/BlueprintsView.vue') },
  { path: '/cron', name: 'cron', component: () => import('./views/CronTasksView.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
