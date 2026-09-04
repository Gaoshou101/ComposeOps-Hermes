<template>
  <div class="page-shell page-shell-workspace">
    <div class="page-header">
      <div><h1 class="page-title">AI 智能运维 Agent</h1><p class="page-subtitle hidden sm:block">自然语言规划 → 可视化工作流 → 确认后执行</p></div>
      <div class="page-actions flex-wrap">
        <select v-model="projectId" class="input w-full sm:w-auto" @change="onProjectChange"><option value="">全部纳管项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.projectName }}</option></select>
        <select v-if="containers.length" v-model="containerId" class="input w-full sm:w-auto"><option value="">选择容器(可选)</option><option v-for="c in containers" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <select v-model="role" class="input w-full sm:w-auto"><option v-for="r in roles" :key="r.name" :value="r.name">{{ r.label }}</option></select>
        <button class="btn-secondary w-full sm:w-auto" :disabled="loading" @click="loadTools"><RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" /><span class="hidden sm:inline">刷新工具</span><span class="sm:hidden">刷新</span></button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <!-- 左侧:对话 / 规划 -->
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="card flex-1 min-h-[320px] overflow-y-auto p-4 space-y-3">
          <template v-if="!messages.length">
            <div class="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div class="grid h-14 w-14 place-items-center rounded-2xl border border-zinc-800 bg-zinc-900 text-cyan-400"><Bot class="h-7 w-7" /></div>
              <div class="space-y-1.5">
                <h2 class="text-base font-semibold tracking-tight text-zinc-100">AI 智能运维 Agent</h2>
                <p class="mx-auto max-w-md text-sm leading-6 text-zinc-500">用一句话描述目标,例如「重启 web 服务并清理旧镜像」。Agent 会规划工具步骤,高风险操作需你确认后再执行。</p>
              </div>
              <div v-if="suggestions.length" class="w-full max-w-2xl space-y-2">
                <h3 class="text-xs font-medium text-zinc-400">基于历史的建议</h3>
                <div class="flex flex-wrap justify-center gap-2">
                  <button
                    v-for="(suggestion, idx) in suggestions"
                    :key="idx"
                    class="preset-chip"
                    @click="input = suggestion.message"
                  >
                    <Sparkles class="h-3.5 w-3.5 text-cyan-400" />{{ suggestion.label }}
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap justify-center gap-2">
                <button
                  v-for="preset in presets"
                  :key="preset"
                  class="preset-chip"
                  :disabled="presetsNeedProject.has(preset) && !projectId"
                  :class="{ 'opacity-50 cursor-not-allowed': presetsNeedProject.has(preset) && !projectId }"
                  @click="input = preset"
                >
                  <Sparkles class="h-3.5 w-3.5 text-cyan-400" />{{ preset }}
                </button>
              </div>
            </div>
          </template>
          <template v-else>
            <div v-for="message in messages" :key="message.id" class="space-y-2">
              <div class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
                <div class="max-w-[88%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words" :class="message.role === 'user' ? 'bg-cyan-950/40 text-zinc-100' : 'bg-zinc-900 text-zinc-300'">{{ message.content }}</div>
              </div>
              <div v-if="message.plan" class="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <div class="mb-3 flex items-center gap-2 text-xs font-semibold text-zinc-300"><ListChecks class="h-3.5 w-3.5 text-cyan-400" />执行计划({{ message.plan.steps.length }} 步)</div>
                
                <!-- DAG Visualization -->
                <div class="mb-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
                  <WorkflowDAG :steps="message.plan.steps" :results="message.results || []" />
                </div>

                <!-- Step List -->
                <div class="space-y-1.5">
                  <div v-for="(step, idx) in message.plan.steps" :key="idx" class="flex items-center gap-2 text-sm">
                    <span class="count-badge shrink-0">{{ idx + 1 }}</span>
                    <code class="font-mono text-xs text-cyan-300">{{ step.tool }}</code>
                    <span v-if="step.params && Object.keys(step.params).length" class="truncate text-xs text-zinc-500">{{ formatParams(step.params) }}</span>
                    <span v-if="step.confirmationRequired || step.risk === 'high' || step.risk === 'critical'" class="ml-auto inline-flex items-center gap-1 rounded border border-rose-900/50 bg-rose-950/40 px-2 py-0.5 text-[10px] text-rose-300"><AlertTriangle class="h-3 w-3" />{{ riskLabel(step.risk) }}</span>
                  </div>
                </div>
                <div v-if="message.plan.steps.length && !message.executed" class="mt-3">
                  <div v-if="confirmationSummary(message.plan)" class="mb-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-2 text-xs text-amber-300"><ShieldAlert class="mr-1 inline h-3.5 w-3.5" />包含 {{ confirmationSummary(message.plan) }} 个高风险步骤,执行前将要求你确认。</div>
                  <div v-if="message.awaitingStep !== undefined && message.awaitingStep !== null" class="mb-2 rounded-lg border border-cyan-900/40 bg-cyan-950/20 p-2 text-xs text-cyan-200">
                    <div class="flex items-center gap-2"><LoaderCircle class="h-3.5 w-3.5 animate-spin" />即将执行第 {{ message.awaitingStep + 1 }} 步:<code class="font-mono text-cyan-300">{{ message.plan.steps[message.awaitingStep]?.tool }}</code></div>
                    <div class="mt-2 flex gap-2">
                      <button class="btn-primary !py-1 !px-2 !text-[11px]" :disabled="executing" @click="confirmStep(message)"><Play class="h-3 w-3" />确认执行</button>
                      <button class="btn-secondary !py-1 !px-2 !text-[11px]" @click="cancelStepwise(message)">取消</button>
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <button v-if="message.awaitingStep === undefined || message.awaitingStep === null" class="btn-primary !py-1.5" :disabled="executing" @click="executePlan(message)"><Play class="h-4 w-4" />{{ executing ? '执行中' : '执行' }}</button>
                    <button class="btn-secondary !py-1.5" @click="clearPlan(message)">重新规划</button>
                  </div>
                </div>
              </div>
              <div v-if="message.results" class="space-y-2">
                <div v-for="(result, idx) in message.results" :key="idx" class="border-l-2 pl-3" :class="result.status === 'success' ? 'border-emerald-500' : 'border-rose-500'">
                  <div class="flex items-center gap-2 text-xs font-mono text-zinc-300"><CheckCircle2 v-if="result.status === 'success'" class="h-3.5 w-3.5 text-emerald-400" /><XCircle v-else class="h-3.5 w-3.5 text-rose-400" />{{ result.tool }}<span class="text-zinc-600">{{ result.durationMs }}ms</span></div>
                  <pre v-if="result.result" class="mt-1 max-h-40 overflow-auto rounded bg-zinc-950/60 p-2 text-[11px] text-zinc-400">{{ stringifyResult(result.result) }}</pre>
                  <p v-if="result.error" class="mt-1 text-xs text-rose-400">{{ result.error }}</p>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="card p-3">
          <div class="flex gap-2">
            <textarea v-model="input" class="input flex-1 resize-none" rows="2" placeholder="描述你要做什么,例如:重启 web 服务并清理旧镜像…" @keydown.enter.exact.prevent="askAgent"></textarea>
            <button class="btn-primary shrink-0" :disabled="planning || !input.trim()" @click="askAgent"><Zap class="h-4 w-4" />{{ planning ? '规划中' : '规划' }}</button>
          </div>
        </div>
      </div>

      <!-- 右侧:思维链 + 快速操作 -->
      <!-- 这一列的高度被 page-shell-workspace 的 h-full 锁死。原先「思维过程」是唯一带
           overflow-y-auto 的子项 —— 它的 min-height:auto 被解析成 0,而下面三张无 overflow
           的卡片拒绝收缩到内容高度以下,于是 flex 只能压它,思维过程被挤成一条缝(看起来
           就是被下面盖住了)。修法:给它显式 min-h(压过 min-height:auto)+ flex-1 抢占余量,
           三张卡 shrink-0 保住自身高度,真的放不下时由 aside 整列滚动。 -->
      <aside class="flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-96">
        <div class="card flex min-h-[12rem] flex-1 flex-col p-4">
          <h3 class="mb-2 text-sm font-semibold text-zinc-300">思维过程</h3>
          <div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
            <div v-for="(thought, idx) in thoughts" :key="idx" class="text-xs">
              <span class="font-semibold text-cyan-400">{{ phaseLabel(thought.phase) }}</span>
              <p class="mt-0.5 text-zinc-500">{{ thought.content }}</p>
            </div>
            <p v-if="!thoughts.length" class="text-xs text-zinc-600">规划或执行后将在此展开 Agent 的思考链路。</p>
          </div>
        </div>

        <div class="card shrink-0 p-4">
          <h3 class="mb-2 text-sm font-semibold text-zinc-300">快速操作</h3>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="tool in quickTools" :key="tool.name" class="btn-secondary !px-2 !py-1.5 !text-xs" :disabled="quickRunning === tool.name" @click="quickInvoke(tool)">
              <LoaderCircle v-if="quickRunning === tool.name" class="h-3.5 w-3.5 animate-spin" />{{ tool.label }}
            </button>
          </div>
        </div>

        <ToolCategoriesPanel
          :tools="tools"
          :categories="categories"
          :project-selected="!!projectId"
          :running="quickRunning"
          :loading="loading"
          @invoke="quickInvoke"
        />

        <div class="card shrink-0 p-4">
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-zinc-300">执行历史</h3>
            <div class="flex items-center gap-1.5">
              <button class="btn-secondary !px-2 !py-1 !text-[10px]" @click="$router.push('/agent/history')"><History class="h-3 w-3" />查看全部</button>
              <button class="btn-secondary !px-2 !py-1 !text-[10px]" :disabled="exporting" @click="exportAgentData"><Download v-if="!exporting" class="h-3 w-3" /><LoaderCircle v-else class="h-3 w-3 animate-spin" />导出</button>
            </div>
          </div>
          <div class="max-h-72 space-y-1 overflow-y-auto">
            <div v-for="plan in history" :key="plan.id" class="rounded border border-zinc-800 p-2">
              <div class="flex items-center justify-between text-xs"><span class="truncate text-zinc-300">{{ plan.user_message || plan.userMessage || '—' }}</span><span class="ml-2 shrink-0 text-zinc-600">{{ plan.status }}</span></div>
              <div class="mt-1 flex items-center gap-2 text-xs">
                <span v-if="plan.rating" class="text-amber-400">{{ '★'.repeat(plan.rating) }}</span>
                <button class="text-zinc-500 hover:text-cyan-300" @click="ratePlan(plan, 5)">好评</button>
                <button class="text-zinc-500 hover:text-cyan-300" @click="ratePlan(plan, 1)">差评</button>
              </div>
            </div>
            <p v-if="!history.length" class="text-xs text-zinc-600">暂无执行历史。</p>
          </div>
        </div>
      </aside>
    </div>

    <!-- Batch Confirm Modal -->
    <BatchConfirmModal :show="showBatchConfirm" :steps="batchConfirmSteps" @confirm="handleBatchConfirm" @cancel="cancelBatchConfirm" />
    <ToolConfirmModal :show="showToolConfirm" :tool="pendingToolConfirm?.tool" @confirm="handleToolConfirm" @cancel="handleToolCancel" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { AlertTriangle, Bot, CheckCircle2, Download, History, ListChecks, LoaderCircle, Play, RefreshCw, ShieldAlert, Sparkles, XCircle, Zap } from 'lucide-vue-next';
import { api } from '../api/client.js';
import { useToastStore } from '../stores/toast.js';
import WorkflowDAG from '../components/agent/WorkflowDAG.vue';
import BatchConfirmModal from '../components/agent/BatchConfirmModal.vue';
import ToolCategoriesPanel from '../components/ToolCategoriesPanel.vue';
import ToolConfirmModal from '../components/agent/ToolConfirmModal.vue';

const toast = useToastStore();

const projects = ref([]);
const projectId = ref('');
const containerId = ref('');
const input = ref('');
const messages = ref([]);
const thoughts = ref([]);
const tools = ref([]);
const categories = ref([]);
const roles = ref([]);
const history = ref([]);
const suggestions = ref([]);
const role = ref('planner');
const planning = ref(false);
const executing = ref(false);
const loading = ref(false);
const exporting = ref(false);
const quickRunning = ref('');
const showBatchConfirm = ref(false);
const batchConfirmSteps = ref([]);
const showToolConfirm = ref(false);
const pendingToolConfirm = ref(null);
let nextId = 0;

const presets = ['重启 web 服务', '查看项目容器状态', '清理旧镜像和悬空卷', '校验 Compose 配置', '分析容器为什么异常退出'];
const presetsNeedProject = new Set(['重启 web 服务', '查看项目容器状态', '校验 Compose 配置', '分析容器为什么异常退出']);
const quickTools = [
  { name: 'compose.ps', label: '容器状态', params: {} },
  { name: 'metrics.query', label: '资源指标', params: {} },
  { name: 'maintenance.update', label: '镜像更新', params: {} },
  { name: 'compose.logs', label: '最近日志', params: { tail: 100 } },
];

const containers = computed(() => projects.value.find((p) => p.id === projectId.value)?.containers || []);

function formatParams(params) {
  return Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(' ');
}
function stringifyResult(result) {
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result, null, 2); } catch { return String(result); }
}
function phaseLabel(phase) {
  return { understanding: '理解', planning: '规划', executing: '执行', validating: '验证', done: '完成' }[phase] || phase;
}
function riskLabel(risk) {
  return { low: '低风险', medium: '中风险', high: '高风险', critical: '极高风险' }[risk] || '需确认';
}
function confirmationSummary(plan) {
  return (plan?.steps || []).filter((step) => step.confirmationRequired || step.risk === 'high' || step.risk === 'critical').length;
}
function onProjectChange() { containerId.value = ''; }

async function loadTools() {
  loading.value = true;
  try {
    tools.value = (await api.getAgentTools()).tools || [];
    categories.value = (await api.getAgentCategories()).categories || [];
    roles.value = (await api.getAgentRoles()).roles || [];
    if (!roles.value.some((item) => item.name === role.value)) role.value = 'planner';
  } catch {} finally { loading.value = false; }
}

async function loadSuggestions() {
  try {
    const data = await api.getAgentSuggestions(projectId.value || '', 5);
    suggestions.value = data?.suggestions || [];
  } catch {}
}

async function loadProjects() {
  try {
    projects.value = ((await api.getProjects()).projects || []).filter((p) => p.managed);
    // 如果只有一个纳管项目且当前未选择，自动选中
    if (projects.value.length === 1 && !projectId.value) {
      projectId.value = projects.value[0].id;
    }
  } catch {}
}

async function askAgent() {
  const text = input.value.trim();
  if (!text || planning.value) return;

  // 检查是否需要项目上下文
  const needsProject = /校验|validate|配置|compose|重启|启动|停止|日志|编辑|预览|diff|容器|状态/.test(text);
  if (needsProject && !projectId.value) {
    messages.value.push({ id: ++nextId, role: 'assistant', content: '该操作需要选择一个项目，请先在上方下拉框中选择项目' });
    input.value = '';
    return;
  }

  input.value = '';
  planning.value = true;
  messages.value.push({ id: ++nextId, role: 'user', content: text });
  try {
    const response = await api.agentPlan({ message: text, projectId: projectId.value || undefined, containerId: containerId.value || undefined, role: role.value });
    thoughts.value = Array.isArray(response.thoughts) ? response.thoughts : [];
    messages.value.push({ id: ++nextId, role: 'assistant', content: response.plan?.steps?.length ? `已生成 ${response.plan.steps.length} 步执行计划` : '未能生成可执行计划', plan: response.plan, planId: response.planId, executed: false, results: null });
  } catch (e) {
    // 401 错误时不显示错误消息,让 App.vue 自动显示登录页
    if (e.status !== 401) {
      messages.value.push({ id: ++nextId, role: 'assistant', content: `规划失败:${e.message}` });
    }
  } finally {
    planning.value = false;
  }
}

async function executePlan(message) {
  if (executing.value) return;
  
  // Phase 2: 使用流式执行
  const text = message.content;
  executing.value = true;
  
  const abortController = new AbortController();
  let executionId = null;
  let pendingApproval = null;
  
  try {
    await api.agentExecuteStream(
      {
        message: text,
        projectId: projectId.value || undefined,
        containerId: containerId.value || undefined,
        role: role.value,
      },
      async (event) => {
        switch (event.type) {
          case 'loop_started':
            // 捕获 Phase 2 执行会话 ID
            executionId = event.planId;
            break;
            
          case 'thought':
            // 实时显示 LLM 推理过程
            thoughts.value.push({ phase: 'thinking', content: event.content });
            break;
            
          case 'confirmation_required': {
            // 单步确认:暂停并等待用户批准
            const tool = {
              name: event.tool,
              description: event.description,
              risk: event.risk,
              input: event.params,
            };
            const input = await showToolConfirmation(tool);
            
            // 发送批准结果(input 为 null = 拒绝)
            await api.agentApprove({
              executionId,
              toolCallId: event.toolCallId,
              approved: input !== null,
              input,
            });
            break;
          }
            
          case 'executing':
            // 显示工具执行状态
            thoughts.value.push({ phase: 'executing', content: `正在执行 ${event.tool}...` });
            break;
            
          case 'tool_result':
            // 显示工具执行结果
            if (!message.results) message.results = [];
            message.results.push({
              tool: event.tool,
              status: event.result?.success ? 'success' : 'failed',
              result: event.result?.result,
              error: event.result?.error,
              durationMs: event.result?.durationMs,
            });
            break;
            
          case 'done':
            message.executed = true;
            message.content = '工作流执行完成';
            break;
            
          case 'error':
            message.executed = true;
            message.content = `执行失败: ${event.content}`;
            break;
            
          case 'interrupted':
            message.executed = true;
            message.content = '执行已被用户中断';
            break;
        }
      },
      abortController.signal
    );
  } catch (e) {
    if (e.name === 'AbortError') {
      message.content = '执行已取消';
    } else if (e.status === 401) {
      // 401 错误让 App.vue 处理
      return;
    } else {
      message.content = `执行失败: ${e.message}`;
    }
    message.executed = true;
  } finally {
    executing.value = false;
  }
}

// 显示工具确认对话框的辅助函数
function showToolConfirmation(tool) {
  return new Promise((resolve) => {
    pendingToolConfirm.value = { tool, resolve };
    showToolConfirm.value = true;
  });
}

// 处理模态框确认/取消
function handleToolConfirm(input) {
  if (pendingToolConfirm.value) {
    pendingToolConfirm.value.resolve(input);
    pendingToolConfirm.value = null;
  }
  showToolConfirm.value = false;
}

function handleToolCancel() {
  if (pendingToolConfirm.value) {
    pendingToolConfirm.value.resolve(null);
    pendingToolConfirm.value = null;
  }
  showToolConfirm.value = false;
}

async function doExecutePlan(message, confirmedSteps) {
  executing.value = true;
  try {
    const response = await api.agentExecute({ planId: message.planId, steps: confirmedSteps });
    thoughts.value = Array.isArray(response.thoughts) ? response.thoughts : [];
    message.results = response.results || [];
    message.executed = true;
    message.content = response.success ? '工作流执行完成' : '工作流执行失败';
  } catch (e) {
    // 401 错误时不设置 message,让 App.vue 自动显示登录页
    if (e.status === 401) {
      return;
    }
    message.content = `执行失败:${e.message}`;
    message.executed = true;
  } finally {
    executing.value = false;
  }
}

function handleBatchConfirm(steps) {
  showBatchConfirm.value = false;
  const message = messages.value.find((m) => m.planId && !m.executed);
  if (message) {
    doExecutePlan(message, steps);
  }
}

function cancelBatchConfirm() {
  showBatchConfirm.value = false;
  batchConfirmSteps.value = [];
}

async function confirmStep(message) {
  if (executing.value) return;
  const idx = message.awaitingStep;
  const step = message.plan?.steps?.[idx];
  if (!step) { cancelStepwise(message); return; }
  executing.value = true;
  try {
    const response = await api.agentExecute({ planId: message.planId, steps: [step] });
    const result = response?.results?.[0];
    message.results.push(result || { tool: step.tool, status: 'failed', error: response?.error || '执行失败' });
    const next = idx + 1;
    if (next >= message.plan.steps.length) {
      message.awaitingStep = null;
      message.executed = true;
      message.content = response?.success ? '工作流执行完成' : '工作流执行失败';
    } else {
      message.awaitingStep = next;
    }
  } catch (e) {
    message.results.push({ tool: step.tool, status: 'failed', error: e.message });
    message.awaitingStep = null;
    message.executed = true;
    message.content = `第 ${idx + 1} 步执行失败:${e.message}`;
  } finally {
    executing.value = false;
  }
}

function cancelStepwise(message) {
  message.awaitingStep = null;
  message.content = '已取消逐步执行,可重新规划';
}

async function ratePlan(plan, rating) {
  try { await api.agentFeedback({ planId: plan.id, rating }); plan.rating = rating; } catch (e) {
    toast.error(`评分失败: ${e.message}`);
  }
}

async function exportAgentData() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const data = await api.exportAgent();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `composeops-agent-export-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  } catch {} finally { exporting.value = false; }
}

async function loadHistory() {
  try {
    const data = await api.getAgentExecutions();
    history.value = data?.plans || [];
  } catch {}
}

function clearPlan(message) {
  message.plan = null;
  message.results = null;
  message.executed = false;
  message.content = '已清除计划,请重新描述需求';
}

async function quickInvoke(tool) {
  if (quickRunning.value) return;
  quickRunning.value = tool.name;
  try {
    const params = { ...tool.params };
    if (projectId.value) params.projectId = projectId.value;
    if (containerId.value) params.containerId = containerId.value;
    const response = await api.agentConfirm({ tool: tool.name, params, confirmed: true });
    thoughts.value = Array.isArray(response.thoughts) ? response.thoughts : [];
    messages.value.push({ id: ++nextId, role: 'assistant', content: `${tool.label}执行${response.success ? '成功' : '失败'}`, results: [{ tool: tool.name, status: response.success ? 'success' : 'failed', result: response.result, error: response.error, durationMs: response.durationMs }] });
  } catch (e) {
    messages.value.push({ id: ++nextId, role: 'assistant', content: `${tool.label}执行失败:${e.message}` });
  } finally {
    quickRunning.value = '';
  }
}

onMounted(async () => { await Promise.all([loadProjects(), loadTools(), loadHistory(), loadSuggestions()]); });
</script>
