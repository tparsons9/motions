import { describe, expect, it } from 'vitest';
import {
    bridgeActionLabel,
    leaderGroupLabel,
    leaderGroupPrefixes,
} from '../../../src/rpc/obsidian-feature-bridge';

describe('leader group prefixes', () => {
    // Mapping the leader itself would make it a complete binding and break
    // every leader sequence, so its exclusion is the load-bearing property.
    it('never returns the leader itself', () => {
        expect(
            leaderGroupPrefixes(['\\ff', '\\fb', '\\1'], '\\'),
        ).not.toContain('\\');
    });

    it('returns each interior prefix once', () => {
        expect(
            leaderGroupPrefixes(['\\ff', '\\fb', '\\hn', '\\1'], '\\'),
        ).toEqual(['\\f', '\\h']);
    });

    it('handles a doubled leader', () => {
        expect(leaderGroupPrefixes(['\\\\h'], '\\')).toEqual(['\\\\']);
    });

    it('ignores keys that are not leader bindings', () => {
        expect(leaderGroupPrefixes(['<C-w>v', 'gd', ']h'], '\\')).toEqual([]);
    });

    it('returns nothing when there is no leader', () => {
        expect(leaderGroupPrefixes(['\\ff'], '')).toEqual([]);
    });

    it('labels the known groups and falls back otherwise', () => {
        expect(leaderGroupLabel('\\f', '\\')).toBe('+find');
        expect(leaderGroupLabel('\\h', '\\')).toBe('+harpoon');
        expect(leaderGroupLabel('\\\\', '\\')).toBe('+more');
        expect(leaderGroupLabel('\\z', '\\')).toBe('+…');
    });
});

// These labels are what `:map`, `:command` and any which-key plugin show for
// a bridged binding, so they have to read as prose rather than as an id.
describe('bridged action labels', () => {
    it.each([
        ['pickerFiles', 'Picker files'],
        ['splitVertical', 'Split vertical'],
        ['gotoDefinitionNewTab', 'Goto definition new tab'],
        ['harpoonSelect1', 'Harpoon select 1'],
        ['UndoTreeToggle', 'Undo tree toggle'],
        ['HarpoonAdd', 'Harpoon add'],
        ['nexttab', 'Nexttab'],
    ])('derives %j as %j', (name, expected) => {
        expect(bridgeActionLabel(name)).toBe(expected);
    });

    it.each([
        ['ob', 'Run an Obsidian command'],
        ['hintactivate', 'Hints: activate'],
        ['hintMode', 'Hints: activate'],
        ['gt', 'Go to tab by count'],
        ['ls', 'List buffers'],
        ['Oil', 'Open the Oil file explorer'],
    ])('uses the explicit label for %j', (name, expected) => {
        expect(bridgeActionLabel(name)).toBe(expected);
    });

    it('never leaves a camelCase run unsplit', () => {
        expect(bridgeActionLabel('pickerBacklinks')).not.toContain(
            'pickerBacklinks',
        );
    });

    it('never emits an internal id for a bridged name', () => {
        for (const name of [
            'pickerFiles',
            'ob',
            'hintMode',
            'jumpListWalk',
            'Picker',
        ]) {
            const label = bridgeActionLabel(name);
            expect(label).not.toContain('mapping:');
            expect(label).not.toContain('command:');
            expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
        }
    });
});
