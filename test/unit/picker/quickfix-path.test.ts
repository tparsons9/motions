import { describe, expect, it } from 'vitest';
import { vaultRelative } from '../../../src/picker/sources/quickfix';

/**
 * macOS resolves `/var` through a firmlink to `/private/var`, and the two sides
 * of this comparison disagree about which spelling to use: Obsidian's adapter
 * reports the vault base unresolved, while Neovim resolves the path when it
 * names a buffer. A prefix test that does not account for it returns null, and
 * a null path makes a quickfix entry render absolute and refuse to open.
 */

describe('vaultRelative', () => {
    it('resolves a path that matches the vault base exactly', () => {
        expect(vaultRelative('/vault', '/vault/Notes/One.md')).toBe(
            'Notes/One.md',
        );
    });

    it('resolves a /private-prefixed path against an unprefixed base', () => {
        expect(
            vaultRelative(
                '/var/folders/x/test-vault',
                '/private/var/folders/x/test-vault/Welcome.md',
            ),
        ).toBe('Welcome.md');
    });

    it('resolves an unprefixed path against a /private-prefixed base', () => {
        expect(
            vaultRelative(
                '/private/var/folders/x/test-vault',
                '/var/folders/x/test-vault/Welcome.md',
            ),
        ).toBe('Welcome.md');
    });

    it('returns null for a path outside the vault', () => {
        expect(vaultRelative('/vault', '/elsewhere/One.md')).toBe(null);
    });

    it('does not treat a sibling directory sharing a prefix as inside the vault', () => {
        expect(vaultRelative('/vault', '/vault-other/One.md')).toBe(null);
    });

    it('returns null for an empty filename', () => {
        expect(vaultRelative('/vault', '')).toBe(null);
    });
});
