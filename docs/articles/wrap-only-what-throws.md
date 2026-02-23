# Wrap Only What Throws

`try-catch` blocks have a gravity problem. They start small, then every line nearby gets pulled in. Before long you're wrapping an entire function body and the catch block handles "something went wrong" because you can't tell which operation actually failed.

`trySync` and `tryAsync` from wellcrafted fix this by making the error boundary explicit: one block, one operation, one failure mode.

## The Before

This is a real handler from our AI streaming endpoint. It calls `chat()` to start an LLM stream, then converts it to an SSE response:

```typescript
try {
	const stream = chat({
		adapter,
		messages,
		conversationId,
		abortController,
	});

	return toServerSentEventsResponse(stream, { abortController });
} catch (error) {
	if (
		error instanceof Error &&
		(error.name === 'AbortError' || abortController.signal.aborted)
	) {
		throw status(499, 'Client closed request');
	}

	const message = error instanceof Error ? error.message : 'Unknown error';
	throw status('Bad Gateway', `Provider error: ${message}`);
}
```

Three problems hide in this code.

First, the `try` wraps two calls, but only one can throw. `toServerSentEventsResponse()` is pure construction; it builds a `Response` around a `ReadableStream` and returns it. It never throws. Wrapping it in the try block is noise that makes you think it might fail.

Second, the catch uses `throw status(...)` while every other early return in the handler uses `return status(...)`. That inconsistency matters in Elysia: `return` sends a normal response, `throw` goes through the error handler. The semantics are different even though the result looks similar.

Third, the comments claim this catches streaming errors (rate limits, client disconnects mid-stream). It doesn't. TanStack AI handles those internally inside the `ReadableStream`, sending `RUN_ERROR` SSE events to the client. The catch only fires for synchronous errors from `chat()` itself: bad adapter config, invalid model name, malformed options. The comments describe a broader scope than the code actually covers.

## The After

```typescript
const { data: stream, error: chatError } = trySync({
	try: () =>
		chat({
			adapter,
			messages,
			conversationId,
			abortController,
		}),
	catch: (e) => Err(e instanceof Error ? e : new Error(String(e))),
});

if (chatError) {
	if (chatError.name === 'AbortError' || abortController.signal.aborted) {
		return status(499, 'Client closed request');
	}
	return status('Bad Gateway', `Provider error: ${chatError.message}`);
}

return toServerSentEventsResponse(stream, { abortController });
```

The structure changed from nested to linear:

```
BEFORE                          AFTER
─────                           ─────
try {                           trySync({ try: () => chat() })
  chat()                        if (error) → return early
  toServerSentEventsResponse()  return toServerSentEventsResponse()
} catch {
  if (abort) throw ...
  throw ...
}
```

`trySync` wraps only `chat()` because that's the only call that can throw. `toServerSentEventsResponse` sits outside the error boundary, in the happy path where it belongs. The error check uses `return status(...)`, consistent with every other guard in the handler. And the `instanceof Error` check moves into the catch normalizer, so the error handling code just works with a typed `Error` object.

## Why trySync Over try-catch

`trySync` and `tryAsync` are thin wrappers from wellcrafted that return `{ data, error }` instead of using control flow for error handling. The mechanical advantage is small; the readability advantage is large.

With try-catch, error handling lives in a different block from the code that produced the error. The catch is separated from the try by however many lines are inside the block, and you're pattern-matching on `error instanceof X` to figure out what went wrong. With trySync, the error is a value you check immediately after the operation. The code reads top-to-bottom: do the thing, check the result, continue or bail.

```typescript
// try-catch: error handling is displaced
try {
  const a = riskyCallA();
  const b = riskyCallB(a);
  const c = riskyCallC(b);
  return transform(c);
} catch (error) {
  // Which call failed? You have to inspect the error to find out.
  if (error instanceof NetworkError) { ... }
  if (error instanceof ValidationError) { ... }
}

// trySync: each operation handles its own failure
const { data: a, error: errA } = trySync({
  try: () => riskyCallA(),
  catch: (e) => Err(new NetworkError(e)),
});
if (errA) return status('Bad Gateway', errA.message);

const { data: b, error: errB } = trySync({
  try: () => riskyCallB(a),
  catch: (e) => Err(new ValidationError(e)),
});
if (errB) return status('Bad Request', errB.message);

return transform(riskyCallC(b));
```

The second version is longer, but each failure has its own error type and its own response. You don't need to untangle a polymorphic catch block to understand what happens when something breaks.

## The Principle

Wrap only the operation that can fail. Not the line before it, not the line after it, not "the whole block just to be safe." Each trySync/tryAsync block should represent one unit of failure with one specific error path.

When only one call can throw, wrap that one call. When two calls can throw independently, wrap them separately. When multiple calls must succeed or fail atomically, wrap them together. The error boundary should match the failure boundary.

| Scenario                           | Wrapping strategy                               |
| ---------------------------------- | ----------------------------------------------- |
| One risky call among safe calls    | Wrap only the risky call                        |
| Two independent risky calls        | Wrap each separately, early return on error     |
| Atomic operation (all-or-nothing)  | Wrap together in one block                      |
| Safe construction after risky init | Risky init inside trySync, construction outside |

That last row is exactly what the AI plugin does. `chat()` is the risky init. `toServerSentEventsResponse()` is the safe construction. One goes inside the boundary, the other goes after it.

The code reads like you think about it: try this thing, handle the failure if it fails, then keep going.
