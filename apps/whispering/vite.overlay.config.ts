import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// Vite config for building the overlay window separately
export default defineConfig({
	plugins: [
		svelte({
			compilerOptions: {
				// Enable Svelte 5 runes
				runes: true,
			},
		}),
	],
	build: {
		outDir: 'build/overlay',
		emptyOutDir: true,
		rollupOptions: {
			input: resolve(__dirname, 'src/overlay/index.html'),
		},
	},
});
