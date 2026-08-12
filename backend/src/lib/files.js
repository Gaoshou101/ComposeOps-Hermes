import { readFile, writeFile, realpath, access } from 'fs/promises';
import path from 'path';
import YAML from 'yaml';

/**
 * 安全地校验并规范化一个文件路径，防止路径穿越攻击。
 * 必须落在允许/* 目录下。
 */
export async function resolveSafePath(rawPath, allowedRoot) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('invalid path');
  }
  const resolved = path.resolve(rawPath);
  if (allowedRoot && !resolved.startsWith(path.resolve(allowedRoot) + path.sep) && resolved !== path.resolve(allowedRoot)) {
    throw new Error(`path ${rawPath} outside allowed root ${allowedRoot}`);
  }
  return resolved;
}

/** 读取文件内容（文本）。若不存在抛出具有 errno 的错误。 */
export async function readText(filePath) {
  await access(filePath).catch((e) => {
    const err = new Error(`file not found: ${filePath}`);
    err.code = 'ENOENT';
    throw err;
  });
  return readFile(filePath, 'utf8');
}

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

/** 写文件（覆盖）。 */
export async function writeText(filePath, content) {
  await writeFile(filePath, content, 'utf8');
}
