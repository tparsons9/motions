import { defineConfig } from 'vitest/config';
import { luaTextPlugin, wasmBinaryPlugin } from './test/helpers.js';

export default defineConfig({
    plugins: [wasmBinaryPlugin(), luaTextPlugin()],
    define: {
        __DEV__: 'true',
    },
    test: {
        include: ['test/unit/**/*.test.ts'],
        benchmark: {
            include: ['test/bench/**/*.bench.ts'],
        },
        globals: true,
        setupFiles: ['test/unit/setup.ts'],
    },
    resolve: {
        alias: {
            obsidian: new URL(
                'test/unit/__mocks__/obsidian.ts',
                import.meta.url,
            ).pathname,
        },
    },
});
