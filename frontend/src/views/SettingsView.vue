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

    <section v-if="tab === 'about'" class="settings-section"><h2 class="section-title">ComposeOps</h2><p class="text-sm text-surface-400">单用户 Docker Compose 运维台。默认建议仅监听本机或通过 Tailscale 访问。</p><div class="text-sm space-y-1"><p>Web Shell：{{ capabilities.shellEnabled ? '已启用' : '未启用' }}</p><p>环境指标范围：{{ capabilities.hostMetricsScope === 'host' ? '宿主机' : 'ComposeOps 容器' }}</p></div></section>
  </div>
</template>

<script setup>
import { markRaw, onMounted, ref } from 'vue';
import { Bell, Bot, Download, Info, KeyRound, RefreshCw, Save, Send, SlidersHorizontal, Trash2, Upload, Wrench } from 'lucide-vue-next';
import { api } from '../api/client.js'; import { useAiStore } from '../stores/ai.js'; import StatCard from '../components/StatCard.vue';
const tabs = [{ id: 'ai', label: 'AI', icon: markRaw(Bot) }, { id: 'personal', label: '偏好', icon: markRaw(SlidersHorizontal) }, { id: 'notifications', label: '通知', icon: markRaw(Bell) }, { id: 'maintenance', label: '维护', icon: markRaw(Wrench) }, { id: 'about', label: '关于', icon: markRaw(Info) }];
const tab = ref('ai'); const message = ref(''); const error = ref(''); const aiStore = useAiStore(); const ai = ref({}); const aiMasked = ref(false); const preferences = ref({ refreshInterval: 5, logTail: 200 }); const password = ref({ currentPassword: '', nextPassword: '' }); const notifications = ref({}); const updates = ref({ autoEnabled: false, intervalHours: 24 }); const updateResults = ref([]); const checkingUpdates = ref(false); const usage = ref(null); const prune = ref({ images: true, buildCache: true, containers: false, volumes: false }); const capabilities = ref({});
function ok(text) { message.value = text; error.value = ''; } function fail(e) { error.value = e.message; message.value = ''; }
onMounted(async () => { try { await aiStore.loadConfig(); const cfg = aiStore.config; ai.value = { baseUrl: cfg.baseUrl, apiKey: '', model: cfg.model, systemPrompt: cfg.systemPrompt }; aiMasked.value = !!cfg.apiKey; [preferences.value, notifications.value, updates.value, capabilities.value] = await Promise.all([api.getPreferences(), api.getNotifications(), api.getUpdateSettings(), api.getCapabilities()]); await loadUsage(); } catch (e) { fail(e); } });
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
function formatBytes(value = 0) { const units = ['B','KB','MB','GB','TB']; let n = value; let i = 0; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; }
</script>
