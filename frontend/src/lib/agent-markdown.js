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

/**
 * 富内容代码块启发式:模型常把 HTML/SVG 表格图表包进 ```html 代码块,
 * 用户想看到的是渲染结果。语言为 html/svg/xml、或无语言但内容是 <svg>/<table>
 * 片段的代码块,渲染为富内容,并把源码收进 details 折叠;其余代码块原样保留。
 */
function renderableCodeBlocks(source) {
  return source.replace(/```([\w-]*)[ \t]*\n([\s\S]*?)\n```/g, (whole, lang, body) => {
    const code = body.trim();
    if (body.includes('```')) return whole;
    const langLower = String(lang || '').toLowerCase();
    const langOk = !langLower || ['html', 'svg', 'xml'].includes(langLower);
    if (!langOk) return whole;
    // 只要代码块内出现 <svg>/<table> 片段即视为富内容(模型常把标题与 HTML 混在一个块里)
    if (!/<(svg[\s>]|table[\s>])/i.test(code)) return whole;
    return `\n\n${code}\n\n<details><summary>查看源码</summary>\n\n\`\`\`${langLower || 'html'}\n${body}\n\`\`\`\n\n</details>\n\n`;
  });
}

/** 给净化后的 SVG/表格包上可全屏查看的块(按钮事件由消息容器委托处理)。 */
function wrapFullscreenBlocks(html) {
  const wrap = (inner) => (
    `<div class="rich-block"><div class="rich-block-body">${inner}</div>` +
    '<button type="button" class="rich-zoom-btn" title="放大查看(Esc 关闭)"><span aria-hidden="true">⤢</span></button></div>'
  );
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, (match) => wrap(match))
    .replace(/<table[\s\S]*?<\/table>/gi, (match) => wrap(match));
}

/** 流式期间代码围栏可能尚未闭合:渲染时临时补虚拟闭合,让 SVG/表格渐进渲染而非裸奔源码。 */
function closeDanglingFence(source) {
  const fenceCount = (source.match(/```/g) || []).length;
  return fenceCount % 2 ? `${source}\n\`\`\`` : source;
}

export function renderAgentMarkdown(value) {
  const source = renderableCodeBlocks(closeDanglingFence(normalizeAgentMarkdown(stripAgentProtocol(value))));
  if (!source.trim()) return '';
  return wrapFullscreenBlocks(DOMPurify.sanitize(marked.parse(source), SANITIZE_CONFIG));
}
