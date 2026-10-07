/** Split an lhs like "]a", "<C-d>", "<leader>q" into key tokens. */
export function tokenizeKeys(lhs: string, leader = ' '): string[] {
    const tokens: string[] = [];
    const re = /<[^<>\s]+>|<lt>|[\s\S]/gu;
    for (const match of lhs.matchAll(re)) {
        const raw = match[0];
        if (raw.length > 2 && raw.startsWith('<') && raw.endsWith('>')) {
            const lower = raw.toLowerCase();
            if (lower === '<leader>') {
                tokens.push(
                    ...tokenizeKeys(leader === ' ' ? '<Space>' : leader, ' '),
                );
                continue;
            }
            tokens.push(normalizeToken(raw));
        } else {
            tokens.push(raw === ' ' ? '<Space>' : raw);
        }
    }
    return tokens;
}

/** Canonical casing for bracketed tokens: <c-d> → <C-d>, <cr> → <CR>. */
export function normalizeToken(token: string): string {
    if (!(token.startsWith('<') && token.endsWith('>')) || token.length < 3)
        return token;
    const parts = token.slice(1, -1).split('-');
    const key = parts.pop()!;
    const mods = parts
        .map((m) => m.toUpperCase())
        .filter((m) => ['C', 'D', 'A', 'S', 'M'].includes(m))
        .map((m) => (m === 'M' ? 'A' : m));
    const names: Record<string, string> = {
        cr: 'CR',
        enter: 'CR',
        return: 'CR',
        esc: 'Esc',
        escape: 'Esc',
        tab: 'Tab',
        bs: 'BS',
        backspace: 'BS',
        del: 'Del',
        delete: 'Del',
        up: 'Up',
        down: 'Down',
        left: 'Left',
        right: 'Right',
        home: 'Home',
        end: 'End',
        pageup: 'PageUp',
        pagedown: 'PageDown',
        space: 'Space',
        lt: 'lt',
        bar: '|',
        bslash: '\\',
    };
    let name = names[key.toLowerCase()] ?? key;
    if (
        name.length === 1 &&
        /[A-Z]/.test(name) &&
        mods.length &&
        !mods.includes('S')
    ) {
        name = name.toLowerCase();
    }
    const order = ['C', 'D', 'A', 'S'];
    const sorted = order.filter((m) => mods.includes(m));
    if (name === 'lt' && !sorted.length) return '<lt>';
    return sorted.length
        ? `<${sorted.join('-')}-${name}>`
        : name.length === 1
          ? name
          : `<${name}>`;
}

/** Human-readable label for a key token in hints: <Space> → ␣, <CR> → ⏎. */
export function displayToken(token: string): string {
    const map: Record<string, string> = {
        '<Space>': '␣',
        '<CR>': '⏎',
        '<Esc>': 'Esc',
        '<Tab>': '⇥',
        '<BS>': '⌫',
        '<lt>': '<',
    };
    return map[token] ?? token;
}
