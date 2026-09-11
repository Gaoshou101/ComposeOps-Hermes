export function stripAgentProtocol(value) {
  return String(value || '')
    .replace(/<\/?tool_call[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call>[\s\S]*$/gi, '')
    .replace(/<\/?tool(?:[_ ]?[a-z]*)?/gi, '')
    .replace(/\btool_(?:call|calls|ca)\b/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
