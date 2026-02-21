# Bun Compile Is 57MB Because It's Not Your Code

It's a fundamentally different architecture. Not an optimization problem: a category problem.

## Go and Rust: Your code IS the binary

```
Source code → Compiler → Machine code
```

The compiler translates your logic directly into CPU instructions. The binary contains your program logic as native instructions, a small runtime (Go: goroutine scheduler + GC at ~1.5MB, Rust: almost nothing), and only the standard library functions you actually called. Dead code elimination happens at link time.

The linker literally strips everything you don't use. A Go HTTP server only includes the `net/http` code paths it reaches. Rust is even more aggressive: no runtime, no GC, just your code.

## Bun (and Deno/Node): Your code rides on top of a VM

```
Bun binary = JavaScriptCore VM + Bun runtime + your JS appended at the end
```

Your code is **not** compiled to machine code at build time. It's bundled as JavaScript (or bytecode) and **stapled onto the full interpreter**. At runtime, JavaScriptCore JIT-compiles it on the fly.

The binary isn't "your program." It's **an entire JavaScript engine that happens to run your script.** A `console.log("Hello World")` compiles to 57MB. Your code adds almost nothing. The rest is JavaScriptCore, the bundler, the test runner, the package manager, embedded SQLite, the Node.js compatibility layer, the HTTP server, and the TypeScript transpiler. None of it tree-shaken.

## Why tree-shaking the runtime is brutally hard

This is why [oven-sh/bun#14546](https://github.com/oven-sh/bun/issues/14546) has no timeline. It's not laziness: it's genuinely difficult.

**1. JavaScriptCore is monolithic (~40MB+ of the binary)**

It's Apple's JS engine. Bun doesn't own it. It includes the interpreter, multiple JIT tiers (Baseline, DFG, FTL/B3), garbage collector, and the entire ECMAScript spec implementation. You can't remove "the parts you don't use" because it's a tightly coupled C++ codebase designed to work as a unit. Stripping the JIT? Now your code runs 10-100x slower.

**2. `eval()` and dynamic imports break static analysis**

Go and Rust know at compile time exactly what functions are called. JavaScript doesn't:

```js
// Which APIs does this use? Nobody knows until runtime.
const module = await import(userInput);
globalThis[dynamicKey]();
eval(arbitrary);
```

You can't prove that `bun:sqlite` or `node:crypto` won't be needed. So you ship everything.

**3. Node.js compatibility is a massive surface area**

Bun promises Node compat. That means `node:fs`, `node:http`, `node:crypto`, `node:zlib`, `node:net`, `node:child_process`, `node:stream`, and more, all reimplemented in Zig/C++ and baked in. These have deep cross-dependencies. Pulling one out risks breaking others.

**4. It's a binary blob, not a linkable library**

Go and Rust use a linker that says "function X is never called → remove it." Bun's compile just takes the pre-built `bun` executable and appends your bundled JS to the end. There's no link step. There's no dead code elimination. It's literally:

```
cat bun-runtime your-bundle.js > output-binary
```

(Simplified, but that's the essence.)

## What "minimal runtime" would actually require

Making the Bun runtime modularly compilable means rebuilding from source with only needed features, which requires restructuring a massive Zig/C++ codebase into optional compilation units. Static analysis of the JS bundle could determine which Node and Bun APIs are reachable, then exclude the rest at C++ compile time. And shipping a JavaScriptCore "lite" that strips JIT tiers for simpler programs is theoretically possible (interpreter-only mode exists but performance suffers).

Each of these is months of engineering. And JavaScriptCore alone sets a hard floor of ~30-40MB no matter what.

## The honest takeaway

|                       | Go/Rust              | Bun/Deno/Node                   |
| --------------------- | -------------------- | ------------------------------- |
| Compilation model     | AOT to native code   | Bundle JS + ship full VM        |
| Dead code elimination | Yes, at link time    | Not possible (dynamic language) |
| Runtime overhead      | ~0-2MB               | ~50-60MB (the entire engine)    |
| Theoretical minimum   | Your code + syscalls | ~30-40MB (just JSC)             |

Bun compile will never match Go/Rust on binary size. The floor is the JS engine. The question is whether they can get from 57MB down to ~30-35MB by stripping the bundler, test runner, package manager, and unused Node polyfills. That's the tractable version of the problem, and it's still hard.

---

_Sources:_

- [oven-sh/bun#14546](https://github.com/oven-sh/bun/issues/14546): "Use a minimal runtime for binary executables" (open, assigned)
- [oven-sh/bun#4453](https://github.com/oven-sh/bun/issues/4453): "Smaller Executable build size" (closed as not planned)
- [Optimizing Bun compiled binary for gg2](https://www.peterbe.com/plog/optimizing-bun-compiled-binary-for-gg2): real-world size measurements with `--bytecode` and `--production`
