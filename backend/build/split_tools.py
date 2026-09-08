#!/usr/bin/env python3
"""机械地把 agent-tools.js 的 registerTool 块按域切到 build/domains/。
每个工具调用形如 .registerTool('name', { … }):定位名字后首个 { ,做括号/引号/模板/注释
感知的配平,拿到对象结束 },其后的第一个 ) 即调用收尾。逐块字节搬运,不改语义。
"""
import io, os

SRC = 'src/services/agent-tools.js'
OUT = 'build/domains'

DOMAINS = {
    'compose': ['compose.up', 'compose.stop', 'compose.restart', 'compose.pull',
                'compose.logs', 'compose.ps', 'compose.scale', 'compose.exec'],
    'config': ['config.preview', 'config.validate', 'config.edit', 'config.rollback', 'config.diff',
               'environment.get', 'environment.set', 'volume.mount',
               'diagnostic.probe', 'diagnostic.analyze', 'network.inspect', 'security.audit'],
    'maintenance': ['alert.create', 'maintenance.clean', 'maintenance.update',
                    'metrics.query', 'alert.configure', 'alert.list', 'alert.delete',
                    'backup.trigger', 'notification.test', 'cron.create', 'performance.baseline'],
}
ALL = [n for ns in DOMAINS.values() for n in ns]


def find_str_end(s, i, quote):
    """从开引号后一字符开始,返回闭合引号的索引(跳过转义)。"""
    while i < len(s):
        c = s[i]
        if c == '\\':
            i += 2
            continue
        if c == quote:
            return i
        i += 1
    raise ValueError('unterminated string')


def match_brace(s, open_idx):
    """返回与 s[open_idx]=='{' 配平的 '}' 索引。感知字符串/模板/注释;正则用启发式。"""
    depth = 0
    i = open_idx
    n = len(s)
    while i < n:
        c = s[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i
        elif c == "'":
            i = find_str_end(s, i + 1, "'")
        elif c == '"':
            i = find_str_end(s, i + 1, '"')
        elif c == '`':
            # 模板字符串:内部可有 ${…};跳转义与插值
            i += 1
            while i < n:
                c2 = s[i]
                if c2 == '\\':
                    i += 2
                    continue
                if c2 == '$' and i + 1 < n and s[i + 1] == '{':
                    i = match_brace(s, i + 1)  # 插值内递归配平(结构上只计一次外层深度外)
                    i += 1
                    continue
                if c2 == '`':
                    break
                i += 1
        elif c == '/':
            nxt = s[i + 1] if i + 1 < n else ''
            if nxt == '/':
                nl = s.find('\n', i)
                i = n if nl < 0 else nl
            elif nxt == '*':
                end = s.find('*/', i + 2)
                i = n if end < 0 else end + 2
            else:
                # 除号或正则起点:若前一个非空字符像是表达式/值,视为除号(原样步进);
                # 否则按正则跳到未转义 '/' 或换行 —— 正则内出现 { } 的概率极低,若误判会被 node --check 暴露。
                prev = s[:i].rstrip()
                if prev and prev[-1] not in '([{:;,=+-*/%&|?!<>':
                    i += 1
                    continue
                i += 1
                while i < n:
                    c2 = s[i]
                    if c2 == '\\':
                        i += 2
                        continue
                    if c2 == '/':
                        break
                    if c2 == '\n':
                        break
                    i += 1
        i += 1
    raise ValueError('unbalanced brace')


def main():
    src = io.open(SRC, encoding='utf-8').read()
    body_start = src.index('export function registerAgentTools(agent) {')
    # 用同一配平器找函数体结束:定位该行 '{'
    brace = src.index('{', body_start)
    func_end = match_brace(src, brace)
    body = src[brace + 1:func_end]

    # 收集每个 registerTool 块: [name, start(含 4 空格), end(含 ')' )]
    blocks = {}
    i = 0
    while True:
        pos = body.find(".registerTool('", i)
        if pos < 0:
            break
        name_end = body.find("'", pos + len(".registerTool('"))
        name = body[pos + len(".registerTool('"):name_end]
        # 名字串结束后的下一个 '{' 即对象开头
        obj_open = body.find('{', name_end)
        obj_close = match_brace(body, obj_open)
        # 对象后首个 ')' 为调用收尾
        call_end = body.find(')', obj_close)
        # 块的字节起点 = 所在行行首(含前导空格)
        line_start = body.rfind('\n', 0, pos) + 1
        blocks[name] = body[line_start:call_end + 1]
        i = pos + 4

    missing = set(ALL) - set(blocks)
    extra = set(blocks) - set(ALL)
    assert not missing, f'缺工具:{sorted(missing)}'
    assert not extra, f'多余工具:{sorted(extra)}'

    os.makedirs(OUT, exist_ok=True)
    for domain, names in DOMAINS.items():
        chain = '  agent\n' + '\n'.join(blocks[n].rstrip('\n') for n in names) + ';\n'
        with io.open(os.path.join(OUT, f'{domain}.chain'), 'w', encoding='utf-8') as f:
            f.write(chain)
    print('split OK:', {d: len(ns) for d, ns in DOMAINS.items()}, 'total', len(ALL))


if __name__ == '__main__':
    main()
