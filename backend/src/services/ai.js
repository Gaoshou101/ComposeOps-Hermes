import { getSetting, setSetting, addAiMessage, getAiHistory, clearAiHistory } from '../lib/db.js';

const DEFAULT_SYSTEM_PROMPT = `你是 OpsDash 的运维助手，擅长 Docker Compose 与容器排错。
- 当用户请求"排错"时，先给出问题根因的简短判断，再给出可执行的修复步骤。
- 当用户请求生成/补全 docker-compose.yml 时，只输出一段合法的 YAML 代码块（用 \`\`\`yaml 包裹），不要额外解释。
- 回答用中文，简洁专业。`;

export function getAiConfig() {
  return {
    baseUrl: getSetting('ai.base_url', 'https://api.openai.com/v1'),
    apiKey: getSetting('ai.api_key', ''),
    model: getSetting('ai.model', 'gpt-4o'),
    systemPrompt: getSetting('ai.system_prompt', DEFAULT_SYSTEM_PROMPT),
  };
}

export function setAiConfig({ baseUrl, apiKey, model, systemPrompt }) {
  if (typeof baseUrl === 'string') setSetting('ai.base_url', baseUrl);
  if (typeof apiKey === 'string') setSetting('ai.api_key', apiKey);
  if (typeof model === 'string') setSetting('ai.model', model);
  if (typeof systemPrompt === 'string') setSetting('ai.system_prompt', systemPrompt);
}

/**
 * 调用 OpenAI 兼容的 chat/completions 接口。
 * @param {Object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {boolean} [opts.stream]
 * @param {function(string):void} [opts.onToken]  流式回调
 * @returns {Promise<string>} 完整回复文本
 */
export async function callOpenAI({ baseUrl, apiKey, model, messages, stream = false, onToken }) {
  if (!apiKey) throw new Error('AI 未配置 API Key');
  if (!baseUrl) throw new Error('AI 未配置 Base URL');

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = { model, messages, stream };
  let fullText = '';

  // Node 22 的全局 fetch 已内置对 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 环境变量的支持
  // （大小写不敏感），无需额外代理库。容器化下把宿主机代理透传进 env，AI 出站
  // 即走代理；不设则直连。这里保持零配置影响——不手动构造 dispatcher。
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`AI 请求失败 ${resp.status}: ${errText.slice(0, 300)}`);
  }

  if (!stream) {
    const data = await resp.json();
    fullText = data?.choices?.[0]?.message?.content || '';
    return fullText;
  }

  // 流式：解析 SSE
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') break;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          if (onToken) onToken(delta);
        }
      } catch {}
    }
  }
  return fullText;
}

export {
  addAiMessage,
  getAiHistory,
  clearAiHistory,
  DEFAULT_SYSTEM_PROMPT,
};
