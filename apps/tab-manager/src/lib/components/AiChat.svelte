<script lang="ts">
	import { aiChatState } from '$lib/state/ai-chat-state.svelte';
	import { Button } from '@epicenter/ui/button';
	import * as Chat from '@epicenter/ui/chat';
	import * as Empty from '@epicenter/ui/empty';
	import ModelCombobox from '$lib/components/ModelCombobox.svelte';
	import * as Select from '@epicenter/ui/select';
	import { Textarea } from '@epicenter/ui/textarea';
	import SendIcon from '@lucide/svelte/icons/send';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SquareIcon from '@lucide/svelte/icons/square';

	let inputValue = $state('');

	function send() {
		const content = inputValue.trim();
		if (!content) return;
		inputValue = '';
		aiChatState.sendMessage(content);
	}

	/** Extract text content from a message's parts array. */
	function getTextContent(
		parts: Array<{ type: string; content?: string }>,
	): string {
		return parts
			.filter((p): p is { type: 'text'; content: string } => p.type === 'text')
			.map((p) => p.content)
			.join('');
	}

	/** Show loading dots when request is submitted but no tokens yet. */
	const showLoadingDots = $derived(aiChatState.status === 'submitted');

	/** Show regenerate button when idle and last message is from assistant. */
	const showRegenerate = $derived(
		aiChatState.status === 'ready' &&
			aiChatState.messages.at(-1)?.role === 'assistant',
	);
</script>

<div class="flex h-full flex-col">
	<!-- Messages area -->
	<div class="min-h-0 flex-1">
		{#if aiChatState.messages.length === 0}
			<Empty.Root class="py-12">
				<Empty.Media>
					<SparklesIcon class="size-8 text-muted-foreground" />
				</Empty.Media>
				<Empty.Title>AI Chat</Empty.Title>
				<Empty.Description>Send a message to start chatting</Empty.Description>
			</Empty.Root>
		{:else}
			<Chat.List class="h-full">
				{#each aiChatState.messages as message (message.id)}
					<Chat.Bubble variant={message.role === 'user' ? 'sent' : 'received'}>
						<Chat.BubbleMessage>
							{getTextContent(message.parts)}
						</Chat.BubbleMessage>
					</Chat.Bubble>
				{/each}
				{#if showLoadingDots}
					<Chat.Bubble variant="received">
						<Chat.BubbleMessage typing />
					</Chat.Bubble>
				{/if}
				{#if showRegenerate}
					<div class="flex justify-start px-2 py-1">
						<Button
							variant="ghost"
							size="sm"
							class="h-7 gap-1 text-xs text-muted-foreground"
							onclick={() => aiChatState.reload()}
						>
							<RotateCcwIcon class="size-3" />
							Regenerate
						</Button>
					</div>
				{/if}
			</Chat.List>
		{/if}
	</div>

	<!-- Error banner -->
	{#if aiChatState.error}
		<div
			class="border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			{aiChatState.error.message || 'Something went wrong'}
		</div>
	{/if}

	<!-- Controls area -->
	<div class="space-y-2 border-t bg-background px-3 py-2">
		<!-- Provider + Model selects -->
		<div class="flex gap-2">
			<Select.Root
				type="single"
				value={aiChatState.provider}
				onValueChange={(v) => {
					if (v) aiChatState.provider = v;
				}}
			>
				<Select.Trigger size="sm" class="flex-1">
					{aiChatState.provider}
				</Select.Trigger>
				<Select.Content>
					{#each aiChatState.availableProviders as p (p)}
						<Select.Item value={p} label={p} />
					{/each}
				</Select.Content>
			</Select.Root>

			<ModelCombobox class="flex-1" />
		</div>

		<!-- Input + send/stop button -->
		<div class="flex gap-2">
			<Textarea
				class="min-h-0 flex-1 resize-none"
				rows={1}
				placeholder="Type a message…"
				bind:value={inputValue}
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}}
				disabled={aiChatState.isLoading}
			/>
			{#if aiChatState.isLoading}
				<Button
					variant="outline"
					size="icon"
					onclick={() => aiChatState.stop()}
				>
					<SquareIcon class="size-4" />
				</Button>
			{:else}
				<Button
					variant="default"
					size="icon"
					onclick={() => send()}
					disabled={!inputValue.trim()}
				>
					<SendIcon class="size-4" />
				</Button>
			{/if}
		</div>
	</div>
</div>
