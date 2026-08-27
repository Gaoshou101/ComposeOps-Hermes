<template>
  <div class="page-shell">
    <div class="page-header"><div><h1 class="page-title">设置</h1><p class="page-subtitle">个人偏好、通知、更新与维护</p></div></div>
    <div class="tabs">
      <button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" @click="tab = item.id"><component :is="item.icon" class="w-4 h-4" />{{ item.label }}</button>
    </div>
    <p v-if="message" class="alert-success">{{ message }}</p><p v-if="error" class="alert-error">{{ error }}</p>

    <section v-if="tab === 'ai'" class="settings-section">
      <h2 class="section-title">OpenAI 兼容接口</h2>
      <div class="form-grid"><label>Base URL<input v-model="ai.baseUrl" class="input" /></label><label>模型<input v-model="ai.model" class="input" /></label><label class="md:col-span-2">API Key<input v-model="ai.apiKey" type="password" class="input" :placeholder="aiMasked ? '已配置，留空保持不变' : 'sk-...'" /></label><label class="md:col-span-2">系统 Prompt<textarea v-model="ai.systemPrompt" rows="6" class="input"></textarea></label></div>
      <button class="btn-primary" @click="saveAi"><Save class="w-4 h-4" />保存 AI 配置</button>
    </section>

    <section v-if="tab === 'personal'" class="settings-section">
      <h2 class="section-title">界面偏好</h2><div class="form-grid"><label>自动刷新间隔（秒）<input v-model.number="preferences.refreshInterval" type="number" min="3" max="300" class="input" /></label><label>日志默认行数<input v-model.number="preferences.logTail" type="number" min="10" max="5000" class="input" /></label></div>
      <button class="btn-primary" @click="savePreferences"><Save class="w-4 h-4" />保存偏好</button>
      <div class="border-t border-surface-800 pt-4 space-y-3"><h2 class="section-title">修改管理员密码</h2><div class="form-grid"><label>当前密码<input v-model="password.currentPassword" type="password" class="input" /></label><label>新密码<input v-model="password.nextPassword" type="password" class="input" /></label></div><button class="btn-secondary" @click="changePassword"><KeyRound class="w-4 h-4" />修改密码</button></div>
      <div class="border-t border-surface-800 pt-4"><h2 class="section-title mb-2">数据迁移</h2><p class="text-sm text-surface-400 mb-3">导出项目备注、偏好、AI 模型设置和最近操作记录。密码、API Key 与通知密钥不包含在导出文件中。</p><div class="flex flex-wrap gap-2"><a class="btn-secondary inline-flex" :href="api.exportUrl" download><Download class="w-4 h-4" />导出 JSON</a><label class="btn-secondary cursor-pointer"><Upload class="w-4 h-4" />导入 JSON<input type="file" accept="application/json" class="hidden" @change="importData" /></label></div></div>
    </section>

    <section v-if="tab === 'notifications'" class="settings-section">
      <div class="flex items-center justify-between"><h2 class="section-title">异常通知</h2><label class="toggle-label"><input v-model="notifications.enabled" type="checkbox" />启用</label></div>
      <div class="form-grid"><label>渠道<select v-model="notifications.type" class="input"><option value="bark">Bark</option><option value="telegram">Telegram</option><option value="wecom">企业微信</option><option value="email">邮件 SMTP</option><option value="webhook">通用 Webhook</option></select></label><label>轮询间隔（秒）<input v-model.number="notifications.intervalSeconds" type="number" min="30" class="input" /></label>
        <template v-if="['bark','wecom','webhook'].includes(notifications.type)"><label class="md:col-span-2">通知地址<input v-model="notifications.endpoint" class="input" placeholder="https://..." /></label></template>
        <template v-if="notifications.type === 'telegram'"><label>Bot Token<input v-model="notifications.token" type="password" class="input" placeholder="已配置时显示 configured" /></label><label>Chat ID<input v-model="notifications.chatId" class="input" /></label></template>
        <template v-if="notifications.type === 'email'"><label>SMTP 主机<input v-model="notifications.smtpHost" class="input" /></label><label>端口<input v-model.number="notifications.smtpPort" type="number" class="input" /></label><label>用户名<input v-model="notifications.smtpUser" class="input" /></label><label>密码<input v-model="notifications.smtpPassword" type="password" class="input" /></label><label>发件人<input v-model="notifications.emailFrom" class="input" /></label><label>收件人<input v-model="notifications.emailTo" class="input" /></label><label class="toggle-label"><input v-model="notifications.smtpSecure" type="checkbox" />TLS/SSL</label></template>
        <label>内存告警阈值（%）<input v-model.number="notifications.memoryThreshold" type="number" min="1" max="100" class="input" /></label><label>Docker 空间告警（GB）<input v-model.number="notifications.dockerStorageThresholdGb" type="number" min="1" class="input" /></label>
      </div><div class="flex gap-2"><button class="btn-primary" @click="saveNotifications"><Save class="w-4 h-4" />保存</button><button class="btn-secondary" @click="testNotifications"><Send class="w-4 h-4" />发送测试</button></div>
    </section>

    <section v-if="tab === 'maintenance'" class="settings-section">
      <div class="flex items-center justify-between"><h2 class="section-title">镜像更新</h2><button class="btn-secondary" :disabled="checkingUpdates" @click="checkUpdates"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': checkingUpdates }" />立即检查</button></div>
      <div class="form-grid"><label class="toggle-label"><input v-model="updates.autoEnabled" type="checkbox" />定时拉取并检查更新</label><label>检查间隔（小时）<input v-model.number="updates.intervalHours" type="number" min="1" max="720" class="input" /></label></div><div class="flex flex-wrap items-center gap-3"><button class="btn-primary" @click="saveUpdates"><Save class="w-4 h-4" />保存更新策略</button><span v-if="updates.lastCheck" class="text-muted">上次检查：{{ new Date(updates.lastCheck).toLocaleString() }}</span></div>
      <div v-if="updateSummary.total" class="grid gap-3 sm:grid-cols-3"><StatCard title="已检查镜像" :value="String(updateSummary.total)" sub="最近一次检查"/><StatCard title="发现更新" :value="String(updateSummary.updated)" sub="需重建相关容器"/><StatCard title="检查失败" :value="String(updateSummary.failed)" sub="请检查仓库或网络"/></div>
      <div v-if="updateResults.length" class="space-y-1"><div v-for="item in updateResults" :key="item.image" class="flex justify-between gap-3 text-sm py-1 border-b border-surface-800"><span class="min-w-0 truncate font-mono" :title="item.image">{{ item.image }}</span><span class="shrink-0" :class="item.status === 'updated' ? 'text-amber-400' : item.status === 'failed' ? 'text-rose-400' : 'text-emerald-400'">{{ imageStatusLabel(item.status) }}</span></div></div>
      <div class="border-t border-surface-800 pt-4 space-y-3"><div class="flex items-center justify-between"><h2 class="section-title">Docker 空间</h2><button class="icon-btn" title="刷新用量" @click="loadUsage"><RefreshCw class="w-4 h-4" /></button></div><div v-if="usage" class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2"><StatCard title="镜像" :value="formatBytes(usage.images.total)" :sub="`可回收 ${formatBytes(usage.images.reclaimable)}`"/><StatCard title="构建缓存" :value="formatBytes(usage.buildCache.total)" :sub="`可回收 ${formatBytes(usage.buildCache.reclaimable)}`"/><StatCard title="停止容器" :value="String(usage.containers.count)" :sub="`可回收 ${formatBytes(usage.containers.reclaimable)}`"/><StatCard title="未使用卷" :value="String(usage.volumes.count)" :sub="`可回收 ${formatBytes(usage.volumes.reclaimable)}`"/></div>
        <div class="flex flex-wrap gap-3"><label class="toggle-label"><input v-model="prune.images" type="checkbox" />未使用镜像</label><label class="toggle-label"><input v-model="prune.buildCache" type="checkbox" />构建缓存</label><label class="toggle-label"><input v-model="prune.containers" type="checkbox" />停止容器</label><label class="toggle-label text-amber-400"><input v-model="prune.volumes" type="checkbox" />未使用卷</label></div><button class="btn-danger" @click="runPrune"><Trash2 class="w-4 h-4" />执行清理</button></div>
    </section>

    <section v-if="tab === 'mounts'" class="settings-section">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div><h2 class="section-title">Compose 项目纳管</h2><p class="text-sm text-surface-400 mt-1">自动发现的项目默认没有操作权限，只有明确勾选并应用后才加入管理。</p></div>
        <button class="btn-secondary" :disabled="mountLoading" @click="loadMountPlan"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': mountLoading }" />重新扫描</button>
      </div>

      <div v-if="mountPlan" class="grid sm:grid-cols-4 gap-2">
        <StatCard title="已发现" :value="String(mountPlan.summary.total)" sub="Compose 项目" />
        <StatCard title="已纳管" :value="String(mountPlan.summary.managed)" sub="由你明确授权" />
        <StatCard title="Compose 就绪" :value="String(mountPlan.summary.operable)" sub="可编辑、拉取和创建" />
        <StatCard title="已选 Compose" :value="String(mountPlan.projects.filter((project) => project.managed && project.mountEnabled).length)" sub="按需精确挂载" />
      </div>

      <div v-if="mountPlan" class="space-y-2">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div><h3 class="section-title">选择管理范围</h3><p class="text-xs text-surface-400 mt-1">第一项授权容器控制、日志、终端和 AI 诊断；第二项允许按需挂载该 Compose 目录，启用配置编辑、拉取和创建缺失服务。</p></div>
          <button class="btn-primary" :disabled="mountLoading || !selectionDirty" @click="saveManagement"><ShieldCheck class="w-4 h-4" />应用选择</button>
        </div>
        <p v-if="selectionDirty" class="alert-warning">当前选择尚未应用；保存前不会改变项目权限或 Compose 目录范围。</p>
        <EmptyState v-if="!mountPlan.projects.length" icon="FolderCog" title="暂未发现 Compose 项目" description="重新扫描以发现新的 Docker Compose 项目" action-label="重新扫描" action-icon="RefreshCw" :action-disabled="mountLoading" @action="loadMountPlan" />
        <div v-for="project in mountPlan.projects" :key="project.id" class="card p-3 flex items-start gap-3" :class="{ 'ring-1 ring-amber-500/70': highlightedProjectId === project.id }">
          <div class="flex flex-col gap-2 pt-0.5">
            <label class="toggle-label text-xs whitespace-nowrap" title="允许控制该项目的现有容器"><input v-model="selectedProjectIds" type="checkbox" :value="project.id" class="accent-accent" />纳管</label>
            <label class="toggle-label text-xs whitespace-nowrap" :class="{ 'opacity-40 pointer-events-none': !selectedProjectIds.includes(project.id) }" title="选择后生成同路径目录挂载"><input v-model="selectedMountProjectIds" type="checkbox" :value="project.id" class="accent-accent" :disabled="!selectedProjectIds.includes(project.id)" />Compose</label>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><span class="font-mono text-sm">{{ project.projectName }}</span><span class="count-badge">{{ projectAccessLabel(project) }}</span><span class="count-badge">{{ project.containerCount }} 个容器</span></div>
            <div class="text-muted font-mono break-all mt-1">{{ project.workingDir || 'Docker 标签未提供工作目录' }}</div>
          </div>
        </div>
      </div>

      <p v-if="mountPlan?.projects.some((project) => project.editable)" class="alert-success">已勾选的 Compose 项目会按需创建临时工作容器，只挂载对应目录；短时间内切换会复用，空闲约 90 秒后自动销毁，无需重建面板。</p>

      <div v-if="mountPlan?.unsupportedProjects.length" class="space-y-2">
        <h3 class="section-title">已纳管但无法自动规划</h3>
        <div v-for="project in mountPlan.unsupportedProjects" :key="project.id" class="alert-warning">
          <span class="font-mono">{{ project.projectName }}</span>：
          Docker Compose 标签缺少安全的项目绝对路径。请在独立项目目录中使用较新的 <code class="font-mono">docker compose up -d</code> 重新创建该项目。
        </div>
      </div>
    </section>

    <section v-if="tab === 'about'" class="settings-section"><h2 class="section-title">ComposeOps</h2><p class="text-sm text-surface-400">单用户 Docker Compose 运维台。默认建议仅监听本机或通过 Tailscale 访问。</p><div class="text-sm space-y-1"><p>Web Shell：{{ capabilities.shellEnabled ? '已启用' : '未启用' }}</p><p>环境指标范围：{{ capabilities.hostMetricsScope === 'host' ? '宿主机' : 'ComposeOps 容器' }}</p></div></section>
  </div>
</template>

<script setup>
import { computed, markRaw, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Bell, Bot, Download, FolderCog, Info, KeyRound, RefreshCw, Save, Send, ShieldCheck, SlidersHorizontal, Trash2, Upload, Wrench } from 'lucide-vue-next';
import { api } from '../api/client.js'; import { useAiStore } from '../stores/ai.js'; import StatCard from '../components/StatCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
const tabs = [{ id: 'ai', label: 'AI', icon: markRaw(Bot) }, { id: 'personal', label: '偏好', icon: markRaw(SlidersHorizontal) }, { id: 'notifications', label: '通知', icon: markRaw(Bell) }, { id: 'maintenance', label: '维护', icon: markRaw(Wrench) }, { id: 'mounts', label: '项目纳管', icon: markRaw(FolderCog) }, { id: 'about', label: '关于', icon: markRaw(Info) }];
const route = useRoute();
const initialTab = tabs.some((item) => item.id === route.query.tab) ? route.query.tab : 'ai';
const tab = ref(initialTab); const message = ref(''); const error = ref(''); const aiStore = useAiStore(); const ai = ref({}); const aiMasked = ref(false); const preferences = ref({ refreshInterval: 5, logTail: 200 }); const password = ref({ currentPassword: '', nextPassword: '' }); const notifications = ref({}); const updates = ref({ autoEnabled: false, intervalHours: 24 }); const updateResults = ref([]); const checkingUpdates = ref(false); const usage = ref(null); const prune = ref({ images: true, buildCache: true, containers: false, volumes: false }); const capabilities = ref({});
const mountPlan = ref(null); const mountLoading = ref(false); const highlightedProjectId = computed(() => String(route.query.projectId || ''));
const updateSummary = computed(() => ({ total: updateResults.value.length, updated: updateResults.value.filter((item) => item.status === 'updated').length, failed: updateResults.value.filter((item) => item.status === 'failed').length }));
const selectedProjectIds = ref([]); const savedManagedProjectIds = ref([]);
const selectedMountProjectIds = ref([]); const savedMountProjectIds = ref([]);
const managementDirty = computed(() => {
  const selected = [...selectedProjectIds.value].sort(); const saved = [...savedManagedProjectIds.value].sort();
  return selected.length !== saved.length || selected.some((id, index) => id !== saved[index]);
});
const mountsDirty = computed(() => {
  const selected = [...selectedMountProjectIds.value].sort(); const saved = [...savedMountProjectIds.value].sort();
  return selected.length !== saved.length || selected.some((id, index) => id !== saved[index]);
});
const selectionDirty = computed(() => managementDirty.value || mountsDirty.value);
function ok(text) { message.value = text; error.value = ''; } function fail(e) { error.value = e.message; message.value = ''; }
onMounted(async () => { try { await aiStore.loadConfig(); const cfg = aiStore.config; ai.value = { baseUrl: cfg.baseUrl, apiKey: '', model: cfg.model, systemPrompt: cfg.systemPrompt }; aiMasked.value = !!cfg.apiKey; const [prefs, notificationConfig, updateConfig, systemCapabilities, plan] = await Promise.all([api.getPreferences(), api.getNotifications(), api.getUpdateSettings(), api.getCapabilities(), api.getMountPlan()]); preferences.value = prefs; notifications.value = notificationConfig; updates.value = updateConfig; updateResults.value = updateConfig.lastResults || []; capabilities.value = systemCapabilities; applyMountPlan(plan); await loadUsage(); } catch (e) { fail(e); } });
async function saveAi() { try { const payload = { ...ai.value }; if (!payload.apiKey) delete payload.apiKey; await aiStore.saveConfig(payload); ai.value.apiKey = ''; aiMasked.value = true; ok('AI 配置已保存'); } catch (e) { fail(e); } }
async function savePreferences() { try { preferences.value = await api.savePreferences(preferences.value); ok('个人偏好已保存'); } catch (e) { fail(e); } }
async function changePassword() { try { if (password.value.nextPassword.length < 10) throw new Error('新密码至少需要 10 个字符'); await api.changePassword(password.value); password.value = { currentPassword: '', nextPassword: '' }; ok('管理员密码已修改，其他会话已退出'); } catch (e) { fail(e); } }
async function importData(event) { try { const file = event.target.files?.[0]; if (!file) return; await api.importData(JSON.parse(await file.text())); ok('设置与项目备注已导入，刷新页面后生效'); event.target.value = ''; } catch (e) { fail(e); } }
async function saveNotifications() { try { notifications.value = await api.saveNotifications(notifications.value); ok('通知配置已保存'); } catch (e) { fail(e); } }
async function testNotifications() { try { await api.testNotifications(notifications.value); ok('测试通知已发送'); } catch (e) { fail(e); } }
async function saveUpdates() { try { updates.value = await api.saveUpdateSettings(updates.value); ok('更新策略已保存'); } catch (e) { fail(e); } }
async function checkUpdates() { checkingUpdates.value = true; try { updateResults.value = (await api.checkUpdates()).results; updates.value.lastCheck = Date.now(); updates.value.lastResults = updateResults.value; ok('镜像检查完成'); } catch (e) { fail(e); } finally { checkingUpdates.value = false; } }
async function loadUsage() { try { usage.value = await api.getDockerUsage(); } catch (e) { fail(e); } }
async function runPrune() { const confirmation = prompt('清理操作不可撤销。请输入 PRUNE 确认：'); if (confirmation !== 'PRUNE') return; try { await api.pruneDocker({ confirmation, options: prune.value }); await loadUsage(); ok('Docker 清理完成'); } catch (e) { fail(e); } }
function applyMountPlan(plan) {
  mountPlan.value = plan;
  savedManagedProjectIds.value = plan.projects.filter((project) => project.managed).map((project) => project.id);
  savedMountProjectIds.value = plan.projects.filter((project) => project.managed && project.mountEnabled).map((project) => project.id);
  selectedProjectIds.value = [...savedManagedProjectIds.value];
  selectedMountProjectIds.value = [...savedMountProjectIds.value];
}
async function loadMountPlan() { mountLoading.value = true; try { applyMountPlan(await api.getMountPlan()); ok('项目与权限状态已重新扫描'); } catch (e) { fail(e); } finally { mountLoading.value = false; } }
async function saveManagement() {
  const removed = savedManagedProjectIds.value.filter((id) => !selectedProjectIds.value.includes(id));
  if (removed.length && !confirm(`将取消 ${removed.length} 个项目的管理权限，确认继续？`)) return;
  mountLoading.value = true;
  try {
    selectedMountProjectIds.value = selectedMountProjectIds.value.filter((id) => selectedProjectIds.value.includes(id));
    await api.saveProjectManagement(selectedProjectIds.value, selectedMountProjectIds.value);
    applyMountPlan(await api.getMountPlan());
    ok('管理与 Compose 目录选择已更新');
  }
  catch (e) { fail(e); } finally { mountLoading.value = false; }
}
function projectAccessLabel(project) { if (!project.managed) return '未纳管'; if (!project.mountEnabled) return '仅管理容器'; if (project.editable) return project.mounted ? 'Compose 直连' : 'Compose 按需'; return 'Compose 路径需处理'; }
function imageStatusLabel(status) { return ({ updated: '已拉取，待应用', current: '已是最新', failed: '检查失败' })[status] || status; }
function formatBytes(value = 0) { const units = ['B','KB','MB','GB','TB']; let n = value; let i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; }
watch(() => route.query.tab, (value) => { if (tabs.some((item) => item.id === value)) tab.value = value; });
watch(selectedProjectIds, (ids) => { selectedMountProjectIds.value = selectedMountProjectIds.value.filter((id) => ids.includes(id)); }, { deep: true });
</script>
