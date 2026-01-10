/**
 * Creates a debounced version of a function that delays invoking `fn` until after `delay` milliseconds
 * have elapsed since the last time the debounced function was invoked.
 *
 * @param fn - The function to debounce
 * @param delay - The number of milliseconds to delay
 * @returns A debounced version of the function with a `cancel` method to cancel pending invocations
 *
 * @example
 * ```ts
 * const debouncedSave = debounce((value: string) => {
 *   settings.updateKey('prompt', value);
 * }, 500);
 *
 * // In component
 * $effect(() => {
 *   debouncedSave(localValue);
 * });
 *
 * // Cleanup
 * onDestroy(() => {
 *   debouncedSave.cancel();
 * });
 * ```
 */
export function debounce<TArgs extends unknown[]>(
	fn: (...args: TArgs) => void,
	delay: number,
) {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	const debounced = (...args: TArgs) => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			fn(...args);
			timeoutId = null;
		}, delay);
	};

	debounced.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	return debounced;
}
