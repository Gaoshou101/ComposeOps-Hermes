import { describe, it, expect } from 'vitest';
import { parseDotenv, serializeDotenv, validateDotenv, isSecretKey } from '../src/lib/dotenv.js';

describe('parseDotenv', () => {
  it('parses plain KEY=VALUE pairs', () => {
    const entries = parseDotenv('FOO=bar\nBAZ=qux\n');
    expect(entries).toEqual([
      { key: 'FOO', value: 'bar', comment: undefined, isSecret: false },
      { key: 'BAZ', value: 'qux', comment: undefined, isSecret: false },
    ]);
  });

  it('recognizes secret keys by keyword', () => {
    const entries = parseDotenv('API_KEY=abc\nDB_PASSWORD=secret\nPUBLIC=visible\n');
    expect(entries[0].isSecret).toBe(true);
    expect(entries[1].isSecret).toBe(true);
    expect(entries[2].isSecret).toBe(false);
    expect(isSecretKey('MY_SECRET_TOKEN')).toBe(true);
    expect(isSecretKey('NORMAL_VALUE')).toBe(false);
  });

  it('attaches standalone comments and trailing comments', () => {
    const entries = parseDotenv('# database config\nDB_HOST=localhost # primary\n\n# token\nTOKEN=xyz\n');
    expect(entries[0].comment).toBe('primary'); // 行内注释优先于行前注释
    expect(entries[0].value).toBe('localhost');
    expect(entries[1].comment).toBe('token');
  });

  it('supports quoted values with hashes and spaces', () => {
    const entries = parseDotenv('MESSAGE="hello # world"\nURL=\'https://example.com/a#b\'\n');
    expect(entries[0].value).toBe('hello # world');
    expect(entries[1].value).toBe('https://example.com/a#b');
  });

  it('supports export prefix', () => {
    const entries = parseDotenv('export MODE=prod\n');
    expect(entries[0].key).toBe('MODE');
    expect(entries[0].value).toBe('prod');
  });

  it('ignores blank lines and malformed lines', () => {
    const entries = parseDotenv('\n\nFOO=1\nnot-a-valid-line\n\nBAR=2\n');
    expect(entries.map((e) => e.key)).toEqual(['FOO', 'BAR']);
  });
});

describe('serializeDotenv', () => {
  it('round-trips parsed entries', () => {
    const raw = 'A=1\nB="two words"\n';
    const entries = parseDotenv(raw);
    const out = serializeDotenv(entries);
    expect(parseDotenv(out)).toEqual(entries);
  });

  it('quotes values containing spaces or special chars', () => {
    const out = serializeDotenv([{ key: 'MSG', value: 'hello world', comment: undefined, isSecret: false }]);
    expect(out).toBe('MSG="hello world"\n');
  });

  it('emits comment line before key', () => {
    const out = serializeDotenv([{ key: 'K', value: 'v', comment: '说明', isSecret: false }]);
    expect(out).toBe('# 说明\nK=v\n');
  });
});

describe('validateDotenv', () => {
  it('accepts valid env content', () => {
    expect(validateDotenv('A=1\n# comment\nB="two"\n').ok).toBe(true);
  });
  it('rejects malformed lines', () => {
    const result = validateDotenv('A=1\nthis is not env\n');
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
  });
});
