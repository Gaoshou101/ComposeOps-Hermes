import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/services' },
  { path: '/services', name: 'services', component: () => import('./views/ServicesView.vue') },
  { path: '/compose', name: 'compose', component: () => import('./views/ComposeView.vue') },
  { path: '/logs', name: 'logs', component: () => import('./views/LogsView.vue') },
  { path: '/shell', name: 'shell', component: () => import('./views/ShellView.vue') },
  { path: '/ai', name: 'ai', component: () => import('./views/AiView.vue') },
  { path: '/monitor', name: 'monitor', component: () => import('./views/MonitorView.vue') },
  { path: '/operations', name: 'operations', component: () => import('./views/OperationsView.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
