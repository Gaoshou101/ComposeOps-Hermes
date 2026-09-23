import assert from 'node:assert/strict';
import test from 'node:test';
import { shellJoin } from '../src/services/remote-shell.js';

test('shellJoin: 单引号转义', () => {
  assert.equal(shellJoin(['echo', "a'b"]), "'echo' 'a'\\''b'");
});

test('shellJoin: 拒绝换行', () => {
  assert.throws(() => shellJoin(['echo', 'a\nb']), /非法字符/);
});
