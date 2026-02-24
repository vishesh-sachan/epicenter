---
name: arktype
description: Arktype patterns for discriminated unions using .merge() and .or(), spread key syntax, and type composition. Use when building union types, combining base schemas with variants, or defining command/event schemas with arktype.
---

# Arktype Discriminated Unions

Patterns for composing discriminated unions with arktype's `.merge()` and `.or()` methods.

## When to Apply This Skill

- Defining a discriminated union schema (e.g., commands, events, actions)
- Composing a base type with per-variant fields
- Working with `defineTable()` schemas that use union types

## `type.or()` + `.merge()` Pattern (Recommended for 5+ variants)

Use when you have shared base fields, per-variant payloads discriminated on a literal key, and **5 or more variants**. The static `type.or()` form avoids deeply nested `.or()` chaining and reads as a flat list.

**Important**: `.merge()` only accepts object types, not unions. You cannot do `commandBase.merge(variantA.or(variantB))` — you must merge each variant individually, then combine via `type.or()`.

```typescript
import { type } from 'arktype';

const commandBase = type({
	id: 'string',
	deviceId: DeviceId,
	createdAt: 'number',
	_v: '1',
});

const Command = type.or(
	commandBase.merge({
		action: "'closeTabs'",
		tabIds: 'string[]',
		'result?': type({ closedCount: 'number' }).or('undefined'),
	}),
	commandBase.merge({
		action: "'openTab'",
		url: 'string',
		'result?': type({ tabId: 'string' }).or('undefined'),
	}),
	commandBase.merge({
		action: "'activateTab'",
		tabId: 'string',
		'result?': type({ activated: 'boolean' }).or('undefined'),
	}),
);
```

### How it works

1. `commandBase.merge({...})` creates a new object type with all base fields plus the variant-specific fields. Conflicting keys are overwritten by the merge argument.
2. `type.or(...)` creates the union from all branches at once. Arktype auto-detects the `action` key as a discriminant because each branch has a distinct literal value.
3. `switch (cmd.action)` in TypeScript narrows the full union — payload fields and result types are type-safe per branch.

### Why this pattern

| Property                  | Benefit                                                       |
| ------------------------- | ------------------------------------------------------------- |
| Base is a real `Type`     | Reusable, composable, inspectable at runtime                  |
| `.merge()` is first-class | Not a workaround — arktype's own API for type combination     |
| `type.or()` is flat       | No deeply nested `.or()` chains — reads as a list of variants |
| Auto-discrimination       | No manual discriminant config needed                          |
| Flat payload              | No nested `payload` object — fields are top-level             |

## `.merge().or()` Chaining Pattern (Good for 2-4 variants)

Use when you have a small number of variants where chaining reads naturally.

```typescript
const Command = commandBase
	.merge({
		action: "'closeTabs'",
		tabIds: 'string[]',
		'result?': type({ closedCount: 'number' }).or('undefined'),
	})
	.or(
		commandBase.merge({
			action: "'openTab'",
			url: 'string',
			'result?': type({ tabId: 'string' }).or('undefined'),
		}),
	);
```

Same semantics as `type.or()` — the only difference is readability at scale. For 5+ variants, prefer `type.or()`.

## The `"..."` Spread Key Pattern (Alternative)

Use when defining inline without a pre-declared base variable, or when you prefer a more compact syntax.

```typescript
const User = type({ isAdmin: 'false', name: 'string' });

const Admin = type({
	'...': User,
	isAdmin: 'true',
	permissions: 'string[]',
});
```

The `"..."` key spreads all properties from the referenced type into the new object definition. Conflicting keys in the outer object override the spread type (same as `.merge()`).

### Spread key in unions

```typescript
const Command = type({
	'...': commandBase,
	action: "'closeTabs'",
	tabIds: 'string[]',
}).or({
	'...': commandBase,
	action: "'openTab'",
	url: 'string',
});
```

Functionally equivalent to `.merge().or()`. Choose based on readability preference.

## `.or()` Chaining vs `type.or()` Static

### Chaining (preferred for 2-4 variants)

```typescript
const Command = variantA.or(variantB).or(variantC);
```

### Static `type.or()` (preferred for 5+ variants)

```typescript
const Command = type.or(variantA, variantB, variantC, variantD, variantE);
```

The static form avoids deeply nested chaining and creates the union in a single call.

## `.merge()` Limitations

**`.merge()` only accepts object types.** You cannot pass a union type into `.merge()`:

```typescript
// ❌ WRONG: .merge() rejects union types
commandBase.merge(variantA.or(variantB));

// ✅ CORRECT: merge each variant individually, then union
type.or(commandBase.merge(variantA), commandBase.merge(variantB));
```

Arktype's `NaryMergeParser` validates that each argument `extends object` and will produce an error if you pass a union.

## Optional Properties in Unions

Use arktype's `'key?'` syntax for optional properties. Never use `| undefined` for optionals — it breaks JSON Schema conversion.

```typescript
// Good: optional property syntax
commandBase.merge({
	action: "'openTab'",
	url: 'string',
	'windowId?': 'string',
	'result?': type({ tabId: 'string' }).or('undefined'),
});

// Bad: explicit undefined union on a required key
commandBase.merge({
	action: "'openTab'",
	url: 'string',
	windowId: 'string | undefined', // Breaks JSON Schema
});
```

The `'result?': type({...}).or('undefined')` pattern is correct — the `?` makes the key optional, and `.or('undefined')` allows the value to be explicitly `undefined` when present. This is the standard pattern for "pending = absent, done = has value" semantics.

## Merge Behavior

- **Override**: When both the base and merge argument define the same key, the merge argument wins
- **Optional preservation**: If a key is optional (`'key?'`) in the base and required in the merge, the merge argument's optionality wins
- **No deep merge**: `.merge()` is shallow — it replaces top-level keys, not nested objects

## Discriminant Detection

Arktype auto-detects discriminants when union branches have distinct literal values on the same key:

```typescript
const AorB = type({ kind: "'A'", value: 'number' }).or({
	kind: "'B'",
	label: 'string',
});

// Arktype internally uses `kind` as the discriminant
// Validation checks `kind` first, then validates only the matching branch
```

This works with any literal type — string literals, number literals, or boolean literals.

## Anti-Patterns

### JS object spread (loses Type composition)

```typescript
// Bad: base is a plain object, not a Type
const baseFields = { id: 'string', deviceId: DeviceId, createdAt: 'number' };
const Command = type({ ...baseFields, action: "'closeTabs'" }).or({
	...baseFields,
	action: "'openTab'",
});
```

This works but `baseFields` is not an arktype `Type` — you can't call `.merge()`, `.or()`, or inspect it at runtime. Prefer `.merge()` when the base should be a proper type.

### Passing unions into `.merge()`

```typescript
// Bad: .merge() only accepts object types
commandBase.merge(variantA.or(variantB));

// Good: merge individually, then union
type.or(commandBase.merge(variantA), commandBase.merge(variantB));
```

### Forgetting `'key?'` syntax for optionals

```typescript
// Bad: makes windowId required but accepting undefined
commandBase.merge({ windowId: 'string | undefined' });

// Good: makes windowId truly optional
commandBase.merge({ 'windowId?': 'string' });
```

## References

- `apps/tab-manager/src/lib/workspace.ts` — Commands table using `type.or()` + `.merge()` (when implemented)
- `.agents/skills/typescript/SKILL.md` — Arktype optional properties section
- `.agents/skills/workspace-api/SKILL.md` — `defineTable()` accepts union types
