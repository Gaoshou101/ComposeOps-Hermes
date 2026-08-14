import YAML from 'yaml';

/** 解析 YAML 文本。解析失败抛出带 row/col 信息的可读错误。 */
export function parseYaml(text) {
  try {
    const doc = YAML.parseDocument(text, { prettyErrors: true });
    if (doc.errors && doc.errors.length) {
      const e = doc.errors[0];
      const err = new Error(e.message);
      err.code = 'YAML_PARSE_ERROR';
      err.line = e.linePos ? e.linePos[0].line : undefined;
      err.column = e.linePos ? e.linePos[0].col : undefined;
      throw err;
    }
    return doc.toJSON();
  } catch (e) {
    if (!e.code) e.code = 'YAML_PARSE_ERROR';
    throw e;
  }
}

/** 校验 YAML 合法性。合法返回 true，否则抛错。 */
export function validateYaml(text) {
  parseYaml(text);
  return true;
}
