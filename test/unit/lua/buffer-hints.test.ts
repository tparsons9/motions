import { describe, expect, it } from 'vitest';
import { BufferHints } from '../../../src/lua/buffer-hints';
import type { WhichKeyConfig } from '../../../src/ui/which-key';
const base: WhichKeyConfig = {
    enabled: true,
    leaderKey: ' ',
    generalMode: false,
    groupLeaderBindings: true,
    leaderBindings: [
        { key: 'ff', command: 'Vault files', source: 'user' },
        { key: 'p', command: 'Paste', source: 'user' },
    ],
    groupLabels: new Map([['<Space>c', { label: 'Shared' }]]),
    commandLabels: new Map([['<Space>ff', { label: 'Vault files' }]]),
    showIcons: false,
    showDelay: 0,
    sortOrder: 'which-key',
};
describe('buffer hints', () => {
    it('composes local descriptions, groups and modes without changing shared metadata', () => {
        const hints = new BufferHints();
        hints.set('code.py', true, {
            key: ' c',
            label: 'Code',
            mode: 'normal',
        });
        hints.set('code.py', false, {
            key: ' ff',
            label: 'Project files',
            mode: 'normal',
        });
        const maps = [
            {
                lhs: ' ff',
                rhs: 'x',
                mode: 'normal' as const,
                noremap: true,
                desc: 'Find code',
            },
            {
                lhs: ' cf',
                rhs: 'x',
                mode: 'normal' as const,
                noremap: true,
                desc: 'Format',
            },
        ];
        const code = hints.compose(base, 'code.py', maps, 'normal');
        expect(code.leaderBindings.map((binding) => binding.key)).toEqual([
            'p',
            'ff',
            'cf',
        ]);
        expect(code.commandLabels.get('<Space>ff')?.label).toBe(
            'Project files',
        );
        expect(code.groupLabels.get('<Space>c')?.label).toBe('Code');
        expect(
            hints
                .compose(base, 'code.py', maps, 'visual')
                .groupLabels.get('<Space>c')?.label,
        ).toBe('Shared');
        expect(
            hints
                .compose(base, 'note.md', [], 'normal')
                .commandLabels.get('<Space>ff')?.label,
        ).toBe('Vault files');
        hints.release('code.py');
        expect(
            hints
                .compose(base, 'code.py', [], 'normal')
                .groupLabels.get('<Space>c')?.label,
        ).toBe('Shared');
        expect(base.leaderBindings.map((binding) => binding.key)).toEqual([
            'ff',
            'p',
        ]);
    });
});
