import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    _resetExternalVimMode,
    getExternalVimMode,
    neovimModeToVimMode,
    onExternalVimMode,
    resolveVimModeWithExternal,
    setExternalVimMode,
} from '../../../src/vim/external-mode';

afterEach(() => {
    _resetExternalVimMode();
});

describe('mapping Neovim mode strings', () => {
    // Values from `:h mode()`. The operator-pending and select rows are the
    // ones prefix order can silently get wrong.
    it.each([
        ['n', 'normal'],
        ['niI', 'normal'],
        ['nt', 'normal'],
        ['no', 'operator-pending'],
        ['nov', 'operator-pending'],
        ['noV', 'operator-pending'],
        ['v', 'visual'],
        ['V', 'visual line'],
        ['\x16', 'visual block'],
        ['s', 'visual'],
        ['S', 'visual line'],
        ['\x13', 'visual block'],
        ['i', 'insert'],
        ['ic', 'insert'],
        ['R', 'replace'],
        ['Rv', 'replace'],
        ['t', 'insert'],
        ['c', 'normal'],
        ['', 'normal'],
    ])('maps %j to %s', (mode, expected) => {
        expect(neovimModeToVimMode(mode)).toBe(expected);
    });

    it('does not read operator-pending as plain normal', () => {
        expect(neovimModeToVimMode('no')).not.toBe(neovimModeToVimMode('n'));
    });

    it('distinguishes the three visual modes', () => {
        expect([
            neovimModeToVimMode('v'),
            neovimModeToVimMode('V'),
            neovimModeToVimMode('\x16'),
        ]).toEqual(['visual', 'visual line', 'visual block']);
    });
});

describe('per-mode rendering precedence', () => {
    it('prefers the external mode over the fork state', () => {
        setExternalVimMode('insert');
        expect(resolveVimModeWithExternal('normal')).toBe('insert');
    });

    it('falls back to the fork state when no backend owns keys', () => {
        expect(resolveVimModeWithExternal('visual block')).toBe('visual block');
    });

    it('returns the fork state again once the backend clears', () => {
        setExternalVimMode('insert');
        setExternalVimMode(null);
        expect(resolveVimModeWithExternal('normal')).toBe('normal');
    });

    it('reports nothing when neither source knows', () => {
        expect(resolveVimModeWithExternal(undefined)).toBeUndefined();
    });
});

describe('external mode source', () => {
    it('reports nothing until a backend publishes', () => {
        expect(getExternalVimMode()).toBeNull();
    });

    it('notifies subscribers on change and stores the value', () => {
        const seen = vi.fn();
        onExternalVimMode(seen);
        setExternalVimMode('insert');
        expect(getExternalVimMode()).toBe('insert');
        expect(seen).toHaveBeenCalledWith('insert');
    });

    it('does not notify when the mode is unchanged', () => {
        const seen = vi.fn();
        onExternalVimMode(seen);
        setExternalVimMode('insert');
        setExternalVimMode('insert');
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it('clears back to null so the fork regains ownership', () => {
        const seen = vi.fn();
        onExternalVimMode(seen);
        setExternalVimMode('visual');
        setExternalVimMode(null);
        expect(getExternalVimMode()).toBeNull();
        expect(seen).toHaveBeenLastCalledWith(null);
    });

    it('stops notifying after unsubscribe', () => {
        const seen = vi.fn();
        const unsubscribe = onExternalVimMode(seen);
        unsubscribe();
        setExternalVimMode('insert');
        expect(seen).not.toHaveBeenCalled();
    });
});
