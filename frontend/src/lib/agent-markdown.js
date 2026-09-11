import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { stripAgentProtocol } from './agent-text.js';

marked.setOptions({ breaks: true, gfm: true });

function normalizeAgentMarkdown(value) {
  return String(value || '')
    .replace(/```(yaml|yml|json|bash|sh|shell|javascript|js|typescript|ts|dockerfile)(?=[^\n])/gi, '```$1\n')
    .replace(/([：:])\s*(\|[^\n]+\|)\n(\|[-:| ]+\|)/g, '$1\n\n$2\n$3');
}

export function renderAgentMarkdown(value) {
  const source = normalizeAgentMarkdown(stripAgentProtocol(value));
  if (!source.trim()) return '';
  return DOMPurify.sanitize(marked.parse(source), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
}
