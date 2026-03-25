import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(__dirname, 'examples/viewer-basic');

export default defineConfig({
    root,
    server: {
        watch: {
            ignored: [
                '**/dist/**',
                '**/.git/**',
            ],
        },
        fs: {
            allow: [
                path.resolve(__dirname),
                path.resolve(__dirname, '..'),
            ],
        },
    },
    preview: {
        host: '0.0.0.0',
        port: 4173,
    },
});
