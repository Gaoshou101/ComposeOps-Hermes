function stripIcallProtocol(value) {
  const source = String(value || '');
  const marker = /_icall/gi;
  let cursor = 0;
  let output = '';
  let match;
  while ((match = marker.exec(source)) !== null) {
    output += source.slice(cursor, match.index);
    let jsonStart = marker.lastIndex;
    while (jsonStart < source.length && /\s/.test(source[jsonStart])) jsonStart += 1;
    if (source[jsonStart] === ':') {
      jsonStart += 1;
      while (jsonStart < source.length && /\s/.test(source[jsonStart])) jsonStart += 1;
    }
    if (source[jsonStart] !== '{') { cursor = marker.lastIndex; continue; }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let jsonEnd = -1;
    for (let index = jsonStart; index < source.length; index += 1) {
      const character = source[index];
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (character === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (character === '{') depth += 1;
      if (character === '}') {
        depth -= 1;
        if (depth === 0) { jsonEnd = index + 1; break; }
      }
    }
    if (jsonEnd < 0) return output;
    let end = jsonEnd;
    while (end < source.length && /\s/.test(source[end])) end += 1;
    if (source[end] !== '>') return output;
    cursor = end + 1;
    marker.lastIndex = cursor;
  }
  return (output + source.slice(cursor)).replace(/_ic(?:a(?:l{0,2})?)?$/i, '');
}

function stripAgentInternalText(value) {
  let source = String(value || '');
  const internalStart = /\b(?:result|res)\s*=\s*composeOps\.[\w.-]+\(\)|\b(?:iNdEx|index)\s*\+\+\s*(?:(?:\r?\n|\s)+(?:result|project_ids|project_names|project_list)\s*=)/i;
  const visibleBoundary = /(?:您当前|您可以|当前可以|以下是|当然|请告诉|如需|查看我|查看其|以\s*markdown|项目列表)/iu;
  let match;
  while ((match = internalStart.exec(source))) {
    const tail = source.slice(match.index + match[0].length);
    const boundary = tail.search(visibleBoundary);
    const end = boundary < 0 ? source.length : match.index + match[0].length + boundary;
    source = source.slice(0, match.index) + source.slice(end);
  }
  return source.replace(/^[ \t]+\n/gm, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function stripAgentProtocol(value) {
  return stripAgentInternalText(stripIcallProtocol(String(value || ''))
    .replace(/<\/?tool_call[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call>[\s\S]*$/gi, '')
    .replace(/<\/?tool(?:[_ ]?[a-z]*)?/gi, '')
    .replace(/\btool_(?:call|calls|ca)\b/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim());
}
