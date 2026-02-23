# `.at()` Is Better, Except on Const Tuples

Everyone knows `.at()` is the modern way to access array elements. It returns `T | undefined`, which correctly models the reality that your array might not have an element at that index. It also supports negative indices, so `.at(-1)` replaces the clunky `arr[arr.length - 1]`.

Use `.at()` by default. But there's one exception where bracket access is genuinely better.

## The Exception: `as const` Tuples

When an array is declared `as const`, TypeScript knows its exact contents at every position. Bracket access on a const tuple gives you the literal type at that index, not `T | undefined`:

```typescript
const MODELS = ['claude-opus-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'] as const;

const first = MODELS[0];
//    ^? 'claude-opus-4-6'

const firstAt = MODELS.at(0);
//    ^? 'claude-opus-4-6' | 'claude-sonnet-4-5' | 'claude-haiku-4-5' | undefined
```

`MODELS[0]` gives you the exact string `'claude-opus-4-6'`. `MODELS.at(0)` gives you the full union plus `undefined`. The bracket version is more precise because TypeScript can prove the element exists; `.at()` throws that information away.

## Why `.at()` Can't Do This

`.at()` accepts any number, including negative indices and computed values. TypeScript can't narrow based on "the number `0` passed to `.at()`" the way it can narrow `tuple[0]` on a fixed-length type. The method signature is `at(index: number): T | undefined`, and that's the best it can do.

Bracket access on tuples is different. TypeScript has special handling for numeric literal indices on tuple types. `tuple[0]` isn't a runtime bounds check; it's a compile-time lookup into a known structure.

## When to Use Which

```typescript
// Dynamic array, unknown length → .at()
const users: User[] = await fetchUsers();
const last = users.at(-1); // User | undefined ✓

// Const tuple, known structure → bracket access
const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
const defaultProvider = PROVIDERS[0]; // 'openai' ✓

// Negative index on anything → .at()
const last = MODELS.at(-1); // no bracket equivalent without .length - 1
```

| Scenario | Prefer | Why |
| --- | --- | --- |
| Dynamic arrays | `.at()` | Correctly returns `T \| undefined` |
| Negative indices | `.at()` | Clean syntax, no `.length - 1` |
| Const tuple, known index | `[n]` | Preserves the exact literal type |
| Computed index on any array | `.at()` | Safer, handles out-of-bounds |

## A Real Example

We had a map of AI providers to their model arrays, all `as const`. The default model was hardcoded as `'gpt-4o-mini'`, which went stale when the upstream package updated. The fix:

```typescript
const PROVIDER_MODELS = {
  openai: OPENAI_CHAT_MODELS,
  anthropic: ANTHROPIC_MODELS,
  gemini: GeminiTextModels,
} as const;

const DEFAULT_PROVIDER: Provider = 'anthropic';
const DEFAULT_MODEL = PROVIDER_MODELS[DEFAULT_PROVIDER][0];
//    ^? 'claude-opus-4-6'
```

`[0]` gives us the exact model string as a type. If we'd used `.at(0)`, we'd need a non-null assertion to get rid of `undefined`, and we'd lose the literal narrowing. The bracket access is both safer (no assertion needed) and more informative (exact type).

The default model now auto-updates when the upstream `@tanstack/ai-anthropic` package ships new models. No hardcoded strings to go stale.
