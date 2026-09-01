import { describe, expect, it } from 'vitest';
import { diffLines } from '../src/lib/diff.js';

describe('diffLines', () => {
  it('相同文本无增删', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc');
    expect(rows.every((row) => row.type === 'same')).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('识别新增行', () => {
    const rows = diffLines('a\nb', 'a\nb\nc');
    expect(rows.filter((row) => row.type === 'add').map((row) => row.text)).toEqual(['c']);
  });

  it('识别删除行', () => {
    const rows = diffLines('a\nb\nc', 'a\nc');
    expect(rows.filter((row) => row.type === 'remove').map((row) => row.text)).toEqual(['b']);
  });

  it('空文本边界', () => {
    const rows = diffLines('', 'x');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('add');
  });
});
