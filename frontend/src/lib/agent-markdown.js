import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { stripAgentProtocol } from './agent-text.js';

marked.setOptions({ breaks: true, gfm: true });

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
      const delimiterWithRow = line.match(/^(\|\s*[-: ]+\|(?:\s*[-: ]+\|)+)(\|[^\n]*)$/);
      if (delimiterWithRow) {
        const rows = delimiterWithRow[2].replace(/\|\|(?=\s*[^|\n]+\|)/g, '|\n|');
        output.push(delimiterWithRow[1], ...rows.split('\n'));
        continue;
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
  return DOMPurify.sanitize(marked.parse(source), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
}
