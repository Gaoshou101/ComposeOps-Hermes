import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { stripAgentProtocol } from './agent-text.js';

marked.setOptions({ breaks: true, gfm: true });

// 富渲染白名单:在 markdown 之外允许模型输出内嵌 HTML 表格/语义标签与 SVG 图表。
// DOMPurify 会剥掉脚本、事件属性与危险协议,这里只是收紧范围而非放开。
// style 属性必须放行(表格列宽/对齐等布局意图只能靠它),但颜色类声明会在
// postProcessHtml 里被剥掉 —— 否则模型自带的 #fff 底色会在暗色主题里刺眼。
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
/** 模型偶尔会把内部执行状态(trace JSON)当回复输出,整块剥离而非展示。 */
const INTERNAL_TRACE_PATTERN = /"phase"\s*:\s*"(tool_|loop_|understanding|planning|executing|validating)|"existing_services"\s*:/i;

const HTML_FRAGMENT_HINT = /<\/(div|p|span|section|table|svg|ul|ol|dl|details|article|header|main|figure)>/i;

function renderableCodeBlocks(source) {
  return source.replace(/```([\w-]*)[ \t]*\n([\s\S]*?)\n```/g, (whole, lang, body) => {
    const code = body.trim();
    // 内部执行状态/协议 JSON:不属于给用户的内容,整块丢弃
    if (INTERNAL_TRACE_PATTERN.test(body)) return '';
    if (body.includes('```')) return whole;
    const langLower = String(lang || '').toLowerCase();
    const langOk = !langLower || ['html', 'svg', 'xml'].includes(langLower);
    if (!langOk) return whole;
    // 富内容判定:含 <svg>/<table>,或整体是一段完整 HTML 片段(以标签开头、有闭合标签)
    const richSvgTable = /<(svg[\s>]|table[\s>])/i.test(code);
    const htmlFragment = /^<[a-zA-Z][^>]*>/.test(code) && HTML_FRAGMENT_HINT.test(code);
    if (!richSvgTable && !(langOk && htmlFragment)) return whole;
    return `\n\n${code}\n\n<details><summary>查看源码</summary>\n\n\`\`\`${langLower || 'html'}\n${body}\n\`\`\`\n\n</details>\n\n`;
  });
}

/* ============================================================================
 * 净化后处理:把"模型风格"翻译成"主题风格"
 *
 * DOMPurify 只保证安全,不保证好看。模型输出的富内容普遍带这些毛病:
 *   1. style="background:#fff;color:#000" —— 暗色界面里一块刺眼的白;
 *   2. fill="white" / bgcolor="#ffffff" —— 同上,SVG 里的白色大底;
 *   3. <svg> 缺 width/height —— 浏览器按 300x150 渲染,图被压扁;
 *   4. 裸 <table> 没有主题样式,行高拥挤、表头无区分。
 * 这里在净化结果上做一次 DOM 级改写。顺序很关键:必须先 DOMPurify,再进 DOM。
 * ========================================================================== */

/** 颜色类声明:这些一律剥除,颜色交给主题 CSS。 */
const COLOR_DECL = /^(color|background|background-color|background-image|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline-color|fill|stroke|text-decoration-color|caret-color|font-family|font|box-shadow|text-shadow)$/i;

/** 保留的布局类声明:列宽/对齐/边距等模型意图,值得尊重。 */
function stripColorDeclarations(styleValue) {
  const kept = String(styleValue)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((decl) => {
      const idx = decl.indexOf(':');
      if (idx < 0) return false;
      return !COLOR_DECL.test(decl.slice(0, idx).trim());
    });
  return kept.join('; ');
}

function parseColor(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'transparent' || raw === 'currentcolor') return null;
  if (raw === 'white' || raw === 'snow' || raw === 'ivory' || raw === 'ghostwhite' || raw === 'azure') return [255, 255, 255];
  if (raw === 'lightgray' || raw === 'lightgrey' || raw === 'silver' || raw === 'whitesmoke' || raw === 'gainsboro') return [211, 211, 211];
  if (raw === 'black') return [0, 0, 0];
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const body = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16)];
  }
  const rgb = raw.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** 感知亮度(0-1)。用于判断"这是不是一块亮色底"。 */
function luminance([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 浅色 → 主题面板色;纯黑形状 → 面板色 + 描边(与既有 CSS 兜底一致)。 */
const DARK_PANEL_FILL = '#1f2530';
const DARK_SHAPE_FILL = '#262c37';
const DARK_SHAPE_STROKE = '#4b5563';

function themeColorFor(value, { isText = false } = {}) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const lum = luminance(rgb);
  if (lum >= 0.6) return isText ? '#d4d4d8' : DARK_PANEL_FILL;
  if (lum <= 0.12) return isText ? '#d4d4d8' : DARK_SHAPE_FILL;
  return null;
}

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path', 'line', 'polyline', 'g', 'use', 'foreignobject']);

/** 把 svg 里残留的亮/暗色 fill、stroke、bgcolor 重映射到主题色。 */
function rethemeSvg(svg) {
  const nodes = [svg, ...svg.querySelectorAll('*')];
  for (const node of nodes) {
    const tag = node.tagName.toLowerCase();
    const isText = tag === 'text' || tag === 'tspan';
    const shape = SHAPE_TAGS.has(tag);
    for (const attr of ['fill', 'stroke', 'bgcolor', 'stop-color', 'flood-color']) {
      if (!node.hasAttribute(attr)) continue;
      const mapped = themeColorFor(node.getAttribute(attr), { isText });
      if (mapped) node.setAttribute(attr, mapped);
    }
    // 纯黑形状在暗底上等于隐形:除了换填充色,再补一道描边保证轮廓可辨。
    if (shape && node.getAttribute('fill') === DARK_SHAPE_FILL && !node.hasAttribute('stroke')) {
      node.setAttribute('stroke', DARK_SHAPE_STROKE);
    }
    // 文字颜色一律交给主题 CSS:模型常写 fill=black,暗底上直接看不见。
    if (isText) {
      node.removeAttribute('fill');
      node.removeAttribute('stroke');
    }
    // style 里的颜色声明同样处理(剥除即可,CSS 兜底)
    if (node.hasAttribute('style')) {
      const kept = stripColorDeclarations(node.getAttribute('style'));
      if (kept) node.setAttribute('style', kept);
      else node.removeAttribute('style');
    }
  }
}

/** SVG 尺寸治理:把"没有尺寸意图"的图交给 CSS 做流体布局,避免 300x150 塌陷。 */
function makeSvgResponsive(svg) {
  const width = svg.getAttribute('width');
  const height = svg.getAttribute('height');
  const hasViewBox = svg.hasAttribute('viewBox');
  if (!hasViewBox && width && height) {
    const w = parseFloat(width);
    const h = parseFloat(height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
  }
  // 显式 width/height 会在窄屏溢出:统一交给 CSS(配合 viewBox 保持比例)。
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  if (!svg.getAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // 没有 viewBox 就无从等比缩放,标记为 fluid 让 CSS 至少给出合理高度上限。
  svg.setAttribute('data-fluid', '1');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('role', 'img');
  if (!svg.getAttribute('aria-label')) svg.setAttribute('aria-label', 'Agent 生成的图表');
}

/** 给裸 HTML 表格补主题 class,并剥掉 HTML4 的 bgcolor/border 垃圾属性。 */
function rethemeTables(root) {
  for (const table of root.querySelectorAll('table')) {
    table.removeAttribute('bgcolor');
    table.removeAttribute('border');
    if (table.hasAttribute('style')) {
      const kept = stripColorDeclarations(table.getAttribute('style'));
      if (kept) table.setAttribute('style', kept);
      else table.removeAttribute('style');
    }
    // 用外层 wrapper 承载"横向滚动 + 主题表格"样式,而不是给 <table> 加 class:
    // <table> 标签本身保持原样,历史断言与第三方片段都不会受影响。
    const parent = table.parentElement;
    if (parent && !parent.classList.contains('agent-table-wrap')) {
      const wrapEl = root.ownerDocument.createElement('div');
      wrapEl.className = 'agent-table-wrap';
      parent.insertBefore(wrapEl, table);
      wrapEl.appendChild(table);
    }
  }
}

/** 代码块带上语言标记,便于 CSS 出语言徽标。 */
function tagCodeLanguages(root) {
  for (const pre of root.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    const cls = code?.getAttribute('class') || '';
    const match = cls.match(/language-([\w-]+)/i);
    if (match) pre.setAttribute('data-lang', match[1].toLowerCase());
    else if (!pre.hasAttribute('data-lang')) pre.setAttribute('data-lang', 'text');
  }
}

/** 通用元素:剥掉 style 里的颜色声明(布局保留),整理链接安全属性。 */
function sanitizeInlineStyles(root) {
  for (const node of root.querySelectorAll('[style]')) {
    if (node.tagName.toLowerCase() === 'svg' || node.closest('svg')) continue; // svg 在上面单独处理
    const kept = stripColorDeclarations(node.getAttribute('style'));
    if (kept) node.setAttribute('style', kept);
    else node.removeAttribute('style');
  }
  for (const link of root.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer noopener');
  }
}

/**
 * 净化后的 DOM 后处理。返回新的 HTML 字符串。
 * 用 DOMParser 的 text/html 模式解析:HTML 解析器会把内联 <svg> 正确放进 SVG 命名空间,
 * 所以 svg 相关的 DOM API 都能用(换成 image/svg+xml 反而会把 HTML 表格吃掉)。
 */
function postProcessHtml(html) {
  if (!html || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const root = doc.body;
  for (const svg of root.querySelectorAll('svg')) {
    rethemeSvg(svg);
    makeSvgResponsive(svg);
  }
  sanitizeInlineStyles(root);
  rethemeTables(root);
  tagCodeLanguages(root);
  return root.innerHTML;
}

/** 给净化后的 SVG/表格包上可全屏查看的块(按钮事件由消息容器委托处理)。 */
function wrapFullscreenBlocks(html) {
  const wrap = (inner) => (
    `<div class="rich-block"><div class="rich-block-body">${inner}</div>` +
    '<button type="button" class="rich-zoom-btn" title="放大查看(Esc 关闭)"><span aria-hidden="true">⤢</span></button></div>'
  );
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, (match) => wrap(match))
    .replace(/<table[\s\S]*?<\/table>/gi, (match) => wrap(match))
    // 顶层 div 片段(不含嵌套 div)也支持放大;嵌套 div 保持原样避免错误包裹
    .replace(/<div(?:(?!<\/?(?:div[\s>]|table[\s>]|svg[\s>]))[\s\S])*?<\/div>/gi, (match) => (match.length > 60 ? wrap(match) : match));
}

/** 流式期间代码围栏可能尚未闭合:渲染时临时补虚拟闭合,让 SVG/表格渐进渲染而非裸奔源码。 */
function closeDanglingFence(source) {
  const fenceCount = (source.match(/```/g) || []).length;
  return fenceCount % 2 ? `${source}\n\`\`\`` : source;
}

export function renderAgentMarkdown(value) {
  const source = renderableCodeBlocks(closeDanglingFence(normalizeAgentMarkdown(stripAgentProtocol(value))));
  if (!source.trim()) return '';
  const clean = DOMPurify.sanitize(marked.parse(source), SANITIZE_CONFIG);
  return wrapFullscreenBlocks(postProcessHtml(clean));
}