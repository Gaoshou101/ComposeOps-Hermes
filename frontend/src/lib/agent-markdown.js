import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { stripAgentProtocol } from './agent-text.js';

marked.setOptions({ breaks: true, gfm: true });

// 富渲染白名单:在 markdown 之外允许模型输出内嵌 HTML 表格/语义标签与 SVG 图表。
// DOMPurify 会剥掉脚本、事件属性与危险协议,这里只是收紧范围而非放开。
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_ATTR: ['target', 'rel', 'align', 'colspan', 'rowspan', 'span', 'start', 'style'],
  ADD_TAGS: ['details', 'summary', 'kbd', 'mark', 'abbr', 'sub', 'sup', 'figure', 'figcaption'],
  FORBID_TAGS: ['style'],
  ALLOW_DATA_ATTR: false,
};

function normalizeAgentMarkdown(value) {
  const lines = String(value || '').split('\n');
  const output = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      output.push(line.replace(/```(yaml|yml|json|bash|sh|shell|javascript|js|typescript|ts|dockerfile)(?=[^\n])/i, '```$1\n'));
      continue;
    }
    if (!inFence) {
      const delimiterStart = line.search(/\|(?=\s*:?-+:?\s*\|)/);
      if (delimiterStart >= 0) {
        const beforeDelimiter = line.slice(0, delimiterStart);
        const headerMatch = beforeDelimiter.match(/^(.*?)(\|[^|\n]*(?:\|[^|\n]*)+\|)$/);
        const delimiterMatch = line.slice(delimiterStart).match(/^\|(?:\s*:?-+:?\s*\|)+/);
        if (headerMatch && delimiterMatch) {
          const compactRows = line.slice(delimiterStart + delimiterMatch[0].length)
            .replace(/\|\|(?=\s*[^|\n]+\|)/g, '|\n|');
          output.push(headerMatch[1], '', headerMatch[2], delimiterMatch[0], ...compactRows.split('\n'));
          continue;
        }
      }
      if (/^\s*\|/.test(line)) {
        const compactRows = line.replace(/\|\|(?=\s*[^|\n]+\|)/g, '|\n|');
        output.push(...compactRows.split('\n'));
      } else {
        output.push(line);
      }
      continue;
    }
    output.push(line);
  }
  return output.join('\n').replace(/([：:])\s*(\|[^\n]+\|)\n(\|[-:| ]+\|)/g, '$1\n\n$2\n$3');
}

export function renderAgentMarkdown(value) {
  const source = normalizeAgentMarkdown(stripAgentProtocol(value));
  if (!source.trim()) return '';
  return DOMPurify.sanitize(marked.parse(source), SANITIZE_CONFIG);
}
