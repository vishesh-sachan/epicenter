# Catch Type Drift at Compile Time with Expect and Equal

When you cast `unknown` data to a third-party library's type, you're trusting that the type hasn't changed since you wrote the cast. Upgrade the library and that trust might be misplaced. The cast still compiles; your code just breaks at runtime.

Two type utilities—`Expect` and `Equal`—turn that silent drift into a build failure.

## The old way: bidirectional extends

The standard approach checks if A extends B, then B extends A. If both hold, they're "probably" the same.

```typescript
type ExpectedParts = 'text' | 'image' | 'tool-call' | 'tool-result';
type ActualParts = TanStackMessagePart['type'];

type _AExtendsB = ActualParts extends ExpectedParts ? true : never;
type _BExtendsA = ExpectedParts extends ActualParts ? true : never;
const _driftCheck: [_AExtendsB, _BExtendsA] = [true, true];
void _driftCheck;
```

Four lines of ceremony for a single check. A dummy variable, a tuple, a `void` to silence the linter. And it's not even perfectly accurate—bidirectional `extends` can't distinguish `any` from `string`, or properly handle `never` and distributive conditionals.

## Rolling your own

Matt Pocock's [Total TypeScript](https://www.totaltypescript.com/how-to-test-your-types#rolling-your-own) popularized a cleaner pattern. Two type utilities, no runtime cost:

```typescript
type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <
  T,
>() => T extends Y ? 1 : 2
  ? true
  : false;
```

`Expect` constrains its input to `true`. If `Equal` returns `false`, the constraint fails and the build breaks.

`Equal` is the interesting one. It wraps both types inside a function signature—`<T>() => T extends X ? 1 : 2`—and checks if those two signatures are identical. This forces TypeScript to compare the types for identity rather than assignability. `string` extends `string | number`, but they aren't equal. `any` extends everything, but it isn't equal to `string`. The generic function trick catches both.

The four-line ceremony collapses to one:

```typescript
type _DriftCheck = Expect<Equal<TanStackMessagePart['type'], ExpectedParts>>;
```

If the library adds, removes, or renames a member of that union, TypeScript flags `Expect` immediately: `Type 'false' does not satisfy the constraint 'true'`. One line, checked on every build.

This works anywhere you bridge typed and untyped boundaries. If you're casting `unknown` to a library type, drop an `Expect<Equal<>>` next to it. When the library changes, the build tells you before your users do.
