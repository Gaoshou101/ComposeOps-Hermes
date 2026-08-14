<template>
  <div class="space-y-4 max-w-5xl">
    <div><h1 class="page-title">设置</h1><p class="page-subtitle">个人偏好、通知、更新与维护</p></div>
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
      <div class="form-grid"><label class="toggle-label"><input v-model="updates.autoEnabled" type="checkbox" />定时拉取并检查更新</label><label>检查间隔（小时）<input v-model.number="updates.intervalHours" type="number" min="1" max="720" class="input" /></label></div><button class="btn-primary" @click="saveUpdates"><Save class="w-4 h-4" />保存更新策略</button>
      <div v-if="updateResults.length" class="space-y-1"><div v-for="item in updateResults" :key="item.image" class="flex justify-between text-sm py-1 border-b border-surface-800"><span class="font-mono">{{ item.image }}</span><span :class="item.status === 'updated' ? 'text-amber-400' : item.status === 'failed' ? 'text-red-400' : 'text-green-400'">{{ item.status }}</span></div></div>
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
        <StatCard title="可控制" :value="String(mountPlan.summary.operable)" sub="已纳管且已挂载" />
        <StatCard title="待挂载" :value="String(mountPlan.summary.pending)" sub="仅限已选项目" />
      </div>

      <div v-if="mountPlan" class="space-y-2">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div><h3 class="section-title">选择纳管项目</h3><p class="text-xs text-surface-400 mt-1">纳管后允许日志、终端和 AI 诊断；Compose 配置与生命周期操作还要求目录已挂载。</p></div>
          <button class="btn-primary" :disabled="mountLoading || !managementDirty" @click="saveManagement"><ShieldCheck class="w-4 h-4" />应用纳管范围</button>
        </div>
        <p v-if="managementDirty" class="alert-warning">当前选择尚未应用；保存前不会改变任何项目权限。</p>
        <div v-if="!mountPlan.projects.length" class="empty-state"><FolderCog class="w-8 h-8" /><span>暂未发现 Compose 项目</span></div>
        <label v-for="project in mountPlan.projects" :key="project.id" class="card p-3 flex items-start gap-3 cursor-pointer" :class="{ 'ring-1 ring-amber-500/70': highlightedProjectId === project.id }">
          <input v-model="selectedProjectIds" type="checkbox" :value="project.id" class="mt-1 accent-accent" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><span class="font-mono text-sm">{{ project.projectName }}</span><span class="count-badge">{{ projectAccessLabel(project) }}</span><span class="count-badge">{{ project.containerCount }} 个容器</span></div>
            <div class="text-xs text-surface-500 font-mono break-all mt-1">{{ project.workingDir || 'Docker 标签未提供工作目录' }}</div>
          </div>
        </label>
      </div>

      <p v-if="mountPlan?.summary.managed && !mountPlan.summary.pending && !mountPlan.summary.unsupported" class="alert-success">当前纳管项目均已挂载，Compose 控制和配置编辑可用。</p>

      <div v-if="mountPlan?.pendingProjects.length" class="space-y-2">
        <h3 class="section-title">已纳管，待挂载</h3>
        <div v-for="project in mountPlan.pendingProjects" :key="project.id" class="card p-3" :class="{ 'ring-1 ring-amber-500/70': highlightedProjectId === project.id }">
          <div class="flex flex-col sm:flex-row sm:items-start gap-2">
            <div class="min-w-0 flex-1"><div class="font-mono text-sm">{{ project.projectName }}</div><div class="text-xs text-surface-500 font-mono break-all mt-1">{{ project.workingDir }}</div></div>
            <span class="count-badge self-start">{{ project.composeFiles.length }} 个配置文件</span>
          </div>
          <p v-if="project.mountState === 'compose_files_unreachable'" class="text-xs text-amber-400 mt-2">目录已经可达，但 Compose 文件不可读；请确认标签路径中的文件仍然存在。</p>
        </div>
      </div>

      <div v-if="mountPlan?.composeSnippet" class="space-y-2">
        <div class="flex items-center justify-between gap-2"><h3 class="section-title">所选项目的挂载配置</h3><button class="btn-secondary" @click="copyText(mountPlan.composeSnippet, '挂载配置已复制')"><Copy class="w-4 h-4" />复制</button></div>
        <p class="text-xs text-surface-400">配置只包含已纳管且尚未挂载的项目。把 bind 条目合并到 ComposeOps 自身 <code class="font-mono">services.opsdash.volumes</code> 中，并保留已有 Docker Socket 和数据卷。</p>
        <pre class="terminal-output rounded-lg max-h-80">{{ mountPlan.composeSnippet }}</pre>
      </div>

      <div v-if="mountPlan?.parentSuggestions.length" class="space-y-2">
        <h3 class="section-title">可选的父目录合并</h3>
        <p class="text-xs text-surface-400">这些项目位于同一个直接父目录。使用父目录能减少挂载条目，但会扩大 ComposeOps 可访问的文件范围。</p>
        <div v-for="suggestion in mountPlan.parentSuggestions" :key="suggestion.path" class="card p-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <div class="min-w-0 flex-1"><div class="text-sm font-mono break-all">{{ suggestion.path }}:{{ suggestion.path }}</div><div class="text-xs text-amber-400 mt-1">替代 {{ suggestion.replaces.length }} 条精确目录挂载，请确认权限范围。</div></div>
          <button class="btn-ghost" @click="copyText(`${suggestion.path}:${suggestion.path}`, '父目录挂载已复制')"><Copy class="w-4 h-4" />复制</button>
        </div>
      </div>

      <div v-if="mountPlan?.unsupportedProjects.length" class="space-y-2">
        <h3 class="section-title">已纳管但无法自动规划</h3>
        <div v-for="project in mountPlan.unsupportedProjects" :key="project.id" class="alert-warning">
          <span class="font-mono">{{ project.projectName }}</span>：
          <template v-if="project.mountState === 'compose_files_unreachable'">工作目录可达，但标签中的 Compose 文件不存在或不可读。请确认文件路径，必要时在原项目目录执行 <code class="font-mono">docker compose up -d</code> 刷新标签。</template>
          <template v-else>Docker Compose 标签缺少绝对工作目录。请使用较新的 <code class="font-mono">docker compose up -d</code> 重新创建该项目。</template>
        </div>
      </div>

      <div v-if="mountPlan?.composeSnippet" class="border-t border-surface-800 pt-4 space-y-2">
        <h3 class="section-title">应用配置</h3>
        <p class="text-sm text-surface-400">挂载属于容器创建参数，保存 Compose 文件后必须重新创建 ComposeOps。普通 restart 不会生效。</p>
        <div class="card p-3 flex flex-col sm:flex-row sm:items-center gap-2"><code class="font-mono text-sm flex-1 break-all">{{ mountPlan.recreateCommand }}</code><button class="btn-secondary" @click="copyText(mountPlan.recreateCommand, '重建命令已复制')"><Copy class="w-4 h-4" />复制命令</button></div>
        <p class="alert-warning">此向导不会自动修改宿主机文件或动态挂载任意目录。重新创建后再次扫描，已纳管项目会自动变为可控制状态。</p>
      </div>
    </section>

    <section v-if="tab === 'about'" class="settings-section"><h2 class="section-title">ComposeOps</h2><p class="text-sm text-surface-400">单用户 Docker Compose 运维台。默认建议仅监听本机或通过 Tailscale 访问。</p><div class="text-sm space-y-1"><p>Web Shell：{{ capabilities.shellEnabled ? '已启用' : '未启用' }}</p><p>环境指标范围：{{ capabilities.hostMetricsScope === 'host' ? '宿主机' : 'ComposeOps 容器' }}</p></div></section>
  </div>
</template>

<script setup>
import { computed, markRaw, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Bell, Bot, Copy, Download, FolderCog, Info, KeyRound, RefreshCw, Save, Send, ShieldCheck, SlidersHorizontal, Trash2, Upload, Wrench } from 'lucide-vue-next';
import { api } from '../api/client.js'; import { useAiStore } from '../stores/ai.js'; import StatCard from '../components/StatCard.vue';
const tabs = [{ id: 'ai', label: 'AI', icon: markRaw(Bot) }, { id: 'personal', label: '偏好', icon: markRaw(SlidersHorizontal) }, { id: 'notifications', label: '通知', icon: markRaw(Bell) }, { id: 'maintenance', label: '维护', icon: markRaw(Wrench) }, { id: 'mounts', label: '项目纳管', icon: markRaw(FolderCog) }, { id: 'about', label: '关于', icon: markRaw(Info) }];
const route = useRoute();
const initialTab = tabs.some((item) => item.id === route.query.tab) ? route.query.tab : 'ai';
const tab = ref(initialTab); const message = ref(''); const error = ref(''); const aiStore = useAiStore(); const ai = ref({}); const aiMasked = ref(false); const preferences = ref({ refreshInterval: 5, logTail: 200 }); const password = ref({ currentPassword: '', nextPassword: '' }); const notifications = ref({}); const updates = ref({ autoEnabled: false, intervalHours: 24 }); const updateResults = ref([]); const checkingUpdates = ref(false); const usage = ref(null); const prune = ref({ images: true, buildCache: true, containers: false, volumes: false }); const capabilities = ref({});
const mountPlan = ref(null); const mountLoading = ref(false); const highlightedProjectId = computed(() => String(route.query.projectId || ''));
const selectedProjectIds = ref([]); const savedManagedProjectIds = ref([]);
const managementDirty = computed(() => {
  const selected = [...selectedProjectIds.value].sort(); const saved = [...savedManagedProjectIds.value].sort();
  return selected.length !== saved.length || selected.some((id, index) => id !== saved[index]);
});
function ok(text) { message.value = text; error.value = ''; } function fail(e) { error.value = e.message; message.value = ''; }
onMounted(async () => { try { await aiStore.loadConfig(); const cfg = aiStore.config; ai.value = { baseUrl: cfg.baseUrl, apiKey: '', model: cfg.model, systemPrompt: cfg.systemPrompt }; aiMasked.value = !!cfg.apiKey; const [prefs, notificationConfig, updateConfig, systemCapabilities, plan] = await Promise.all([api.getPreferences(), api.getNotifications(), api.getUpdateSettings(), api.getCapabilities(), api.getMountPlan()]); preferences.value = prefs; notifications.value = notificationConfig; updates.value = updateConfig; capabilities.value = systemCapabilities; applyMountPlan(plan); await loadUsage(); } catch (e) { fail(e); } });
async function saveAi() { try { const payload = { ...ai.value }; if (!payload.apiKey) delete payload.apiKey; await aiStore.saveConfig(payload); ai.value.apiKey = ''; aiMasked.value = true; ok('AI 配置已保存'); } catch (e) { fail(e); } }
async function savePreferences() { try { preferences.value = await api.savePreferences(preferences.value); ok('个人偏好已保存'); } catch (e) { fail(e); } }
async function changePassword() { try { if (password.value.nextPassword.length < 10) throw new Error('新密码至少需要 10 个字符'); await api.changePassword(password.value); password.value = { currentPassword: '', nextPassword: '' }; ok('管理员密码已修改，其他会话已退出'); } catch (e) { fail(e); } }
async function importData(event) { try { const file = event.target.files?.[0]; if (!file) return; await api.importData(JSON.parse(await file.text())); ok('设置与项目备注已导入，刷新页面后生效'); event.target.value = ''; } catch (e) { fail(e); } }
async function saveNotifications() { try { notifications.value = await api.saveNotifications(notifications.value); ok('通知配置已保存'); } catch (e) { fail(e); } }
async function testNotifications() { try { await api.testNotifications(notifications.value); ok('测试通知已发送'); } catch (e) { fail(e); } }
async function saveUpdates() { try { updates.value = await api.saveUpdateSettings(updates.value); ok('更新策略已保存'); } catch (e) { fail(e); } }
async function checkUpdates() { checkingUpdates.value = true; try { updateResults.value = (await api.checkUpdates()).results; ok('镜像检查完成'); } catch (e) { fail(e); } finally { checkingUpdates.value = false; } }
async function loadUsage() { try { usage.value = await api.getDockerUsage(); } catch (e) { fail(e); } }
async function runPrune() { const confirmation = prompt('清理操作不可撤销。请输入 PRUNE 确认：'); if (confirmation !== 'PRUNE') return; try { await api.pruneDocker({ confirmation, options: prune.value }); await loadUsage(); ok('Docker 清理完成'); } catch (e) { fail(e); } }
function applyMountPlan(plan) { mountPlan.value = plan; savedManagedProjectIds.value = plan.projects.filter((project) => project.managed).map((project) => project.id); selectedProjectIds.value = [...savedManagedProjectIds.value]; }
async function loadMountPlan() { mountLoading.value = true; try { applyMountPlan(await api.getMountPlan()); ok('项目与权限状态已重新扫描'); } catch (e) { fail(e); } finally { mountLoading.value = false; } }
async function saveManagement() {
  const removed = savedManagedProjectIds.value.filter((id) => !selectedProjectIds.value.includes(id));
  if (removed.length && !confirm(`将取消 ${removed.length} 个项目的管理权限，确认继续？`)) return;
  mountLoading.value = true;
  try { await api.saveProjectManagement(selectedProjectIds.value); applyMountPlan(await api.getMountPlan()); ok('项目纳管范围已更新'); }
  catch (e) { fail(e); } finally { mountLoading.value = false; }
}
function projectAccessLabel(project) { if (!project.managed) return '未纳管'; if (project.editable) return '可控制'; if (project.mountState === 'directory_unreachable') return '已纳管 · 待挂载'; return '已纳管 · 需处理'; }
async function copyText(value, successMessage) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const textarea = document.createElement('textarea');
      textarea.value = value; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
      document.body.appendChild(textarea); textarea.select();
      const copied = document.execCommand('copy'); textarea.remove();
      if (!copied) throw new Error('copy_failed');
    }
    ok(successMessage);
  } catch { fail(new Error('复制失败，请手动选择文本复制')); }
}
function formatBytes(value = 0) { const units = ['B','KB','MB','GB','TB']; let n = value; let i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; }
watch(() => route.query.tab, (value) => { if (tabs.some((item) => item.id === value)) tab.value = value; });
</script>
