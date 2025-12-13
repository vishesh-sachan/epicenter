import { mount } from 'svelte';
import RecordingOverlay from './RecordingOverlay.svelte';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Root element not found');
}

console.log('[OVERLAY MAIN] Mounting RecordingOverlay component...');

const app = mount(RecordingOverlay, {
	target: rootElement,
});

console.log('[OVERLAY MAIN] RecordingOverlay mounted successfully');

export default app;
