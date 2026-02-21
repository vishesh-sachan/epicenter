# Execute Unify Extension Lifecycle Specification

> **Superseded (Phase 6):** The `ctx.client` factory context pattern proposed in Phase 6 of this spec was superseded by `specs/20260220T195800-flatten-extension-context.md`. Extension factories now receive flat context `{ ydoc, tables, ... }` directly instead of `{ client: { ydoc, tables, ... } }`.

**Specification:** `packages/epicenter/specs/20260220T195900-unify-extension-lifecycle.md`

**Copy the prompt below and paste it to execute the entire specification in parallel.**

---

## Master Execution Prompt

```
Execute the "Unify Extension Lifecycle" specification in phases with parallel work streams.

SPECIFICATION: packages/epicenter/specs/20260220T195900-unify-extension-lifecycle.md

YOUR GOAL: Implement ALL 6 phases (0-6) following the spec exactly. Break into parallel work streams where independent. Mark each task complete in sequence before final verification.

## Parallel Work Streams (can run simultaneously with independent results)

### Stream 1: Phase 0 - Baseline Tests (MUST COMPLETE FIRST)
Add 6 comprehensive baseline tests to packages/epicenter/src/static/create-workspace.test.ts
- Test 0.1: Builder branching creates isolated extension sets
- Test 0.2: Void-returning factory does not appear in extensions
- Test 0.3: Factory throw in workspace cleans up prior extensions (LIFO order)
- Test 0.4: Document extension destroy order is LIFO
- Test 0.5: Workspace whenReady rejection triggers cleanup
- Test 0.6: Document extension whenReady rejection triggers cleanup

Use the EXACT code from spec Phase 0 section (lines with test() blocks).
All 6 tests SHOULD FAIL before phases are implemented.
Run: bun test
Verify: All 6 tests fail

### Stream 2: Phase 1 - Immutable Builder State (STATIC WORKSPACE)
Implement in: packages/epicenter/src/static/create-workspace.ts

1. Define BuilderState type (spec lines ~180)
2. Refactor buildClient to accept state parameter
3. Each withExtension creates new arrays instead of mutating
4. Remove shared mutable arrays
5. Run: bun test
6. Verify: Test 0.1 now PASSES

### Stream 3: Phase 1 - Immutable Builder State (DYNAMIC WORKSPACE)
Implement in: packages/epicenter/src/dynamic/workspace/create-workspace.ts

1. Apply identical changes to dynamic workspace
2. Define same BuilderState type
3. Refactor buildClient identically to static
4. Run: bun test
5. Verify: Test 0.1 still passes (both implementations)

### Stream 4: Phase 2 - LIFO Sequential Destroy (DOCUMENT BINDING)
Implement in: packages/epicenter/src/static/create-document-binding.ts

1. Update close() method (lines ~340-352):
   - Replace Promise.allSettled with LIFO sequential loop
   - Collect errors but don't block
   - Include LIFO pattern
2. Update closeAll() method (lines ~355-368):
   - Same LIFO pattern for each entry
3. Update factory throw cleanup (lines ~281-285):
   - Use LIFO instead of Promise.allSettled
4. Update whenReady rejection cleanup (lines ~321-328):
   - Use LIFO instead of Promise.allSettled
5. Run: bun test
6. Verify: Tests 0.4 and 0.6 now PASS

### Stream 5: Phase 3 - Void Return = Skip (STATIC + DYNAMIC)
Implement in both:
- packages/epicenter/src/static/create-workspace.ts
- packages/epicenter/src/dynamic/workspace/create-workspace.ts

Pre-flight:
1. Run grep: grep -r "return\s*}" packages/epicenter/src/extensions --include="*.ts" | grep -v test
2. Run grep: grep -r "withExtension\|withDocumentExtension" apps --include="*.ts" -A 5 | grep "return\s*}"
3. Document findings (should be ZERO matches)

Implementation (both files):
1. Find: const raw = factory(client); const resolved = defineExtension(raw ?? {});
2. Replace with: const raw = factory(client); if (!raw) return buildClient(extensions, state);
3. Run: bun test
4. Verify: Test 0.2 now PASSES

### Stream 6: Phase 4 - Error Handling (STATIC WORKSPACE)
Implement in: packages/epicenter/src/static/create-workspace.ts

1. Wrap factory call in withExtension with try/catch
2. On catch: LIFO destroy of prior extensions, collect errors, rethrow factory error
3. Add .catch() to final whenReady for rejection handling
4. Idempotent destroy on rejection
5. Run: bun test
6. Verify: Tests 0.3 and 0.5 now PASS

### Stream 7: Phase 4 - Error Handling (DYNAMIC WORKSPACE)
Implement in: packages/epicenter/src/dynamic/workspace/create-workspace.ts

1. Apply identical error handling to dynamic workspace
2. Same try/catch pattern
3. Same LIFO cleanup
4. Same whenReady rejection handling
5. Run: bun test
6. Verify: Tests 0.3 and 0.5 still pass (both implementations)

### Stream 8: Phase 5 - Shared Helper (SEQUENTIAL AFTER PHASES 1-4)
Implement in: packages/epicenter/src/shared/run-extension-factories.ts (NEW FILE)

Create unified factory execution logic:
1. Define ExtensionFactoryEntry type
2. Define RunExtensionFactoriesResult type
3. Implement runExtensionFactories() function with:
   - LIFO cleanup on factory throw
   - Error collection
   - whenReady composition
4. Export for use in all three contexts

Refactor to use helper:
1. packages/epicenter/src/static/create-workspace.ts: withExtension calls helper
2. packages/epicenter/src/dynamic/workspace/create-workspace.ts: withExtension calls helper
3. packages/epicenter/src/static/create-document-binding.ts: open() calls helper
4. Run: bun test
5. Verify: All tests still pass, no logic duplication

### Stream 9: Phase 6 - Unified Context (SEQUENTIAL AFTER PHASE 5)

**MAJOR BREAKING CHANGE - DO ALL AT ONCE**

Part A: Type Definitions
1. shared/lifecycle.ts: Define ExtensionContext<TClient, TExtensions>
2. static/types.ts: Define WorkspaceExtensionClient
3. static/types.ts: Define DocumentExtensionClient
4. dynamic/workspace/types.ts: Define DynamicWorkspaceExtensionClient

Part B: Update Builders
1. static/create-workspace.ts: Pass { client, whenReady, extensions } to factory
2. dynamic/workspace/create-workspace.ts: Pass same shape
3. static/create-document-binding.ts: Pass same shape

Part C: Update All 11 Extension Factories (PARALLEL GROUPS)

Group 1 (sync ecosystem - 3 files):
- packages/epicenter/src/extensions/sync.ts
- packages/epicenter/src/extensions/sync/desktop.ts
- packages/epicenter/src/extensions/sync/web.ts

Group 2 (persistence - 3 files):
- packages/epicenter/src/extensions/sqlite/sqlite.ts
- packages/epicenter/src/extensions/markdown/markdown.ts
- packages/epicenter/src/extensions/revision-history/local.ts

Group 3 (app-level - 5 files):
- apps/tab-manager-markdown/src/markdown-persistence-extension.ts
- apps/epicenter/src/lib/yjs/workspace-persistence.ts
- apps/tab-manager/src/entrypoints/background.ts
- apps/tab-manager/src/lib/workspace-popup.ts
- apps/fs-explorer/src/lib/fs/fs-state.svelte.ts

For EACH factory file:
1. Change signature from (ctx) => to ({ client, whenReady, extensions }) =>
2. Extract properties from ctx.client instead of directly from ctx
3. Example: const { ydoc } = ctx.client; instead of const { ydoc } = ctx;

Part D: Update All Tests
1. static/create-workspace.test.ts: Update to use new context shape
2. static/define-workspace.test.ts: Update to use new context shape
3. static/create-document-binding.test.ts: Update to use new context shape
4. dynamic/workspace/create-workspace.test.ts: Update to use new context shape
5. Run: bun test
6. Verify: All tests pass

Part E: Update Documentation
1. static/create-workspace.ts: Update JSDoc examples
2. static/types.ts: Update JSDoc examples
3. shared/lifecycle.ts: Update JSDoc with context explanation
4. dynamic/workspace/create-workspace.ts: Update examples
5. static/README.md: Update with new patterns
6. dynamic/workspace/README.md: Update with new patterns

## Final Verification (AFTER ALL PHASES)

1. Run: bun test
   Expected: All tests pass ✓

2. Run: bun run typecheck
   Expected: No type errors ✓

3. Grep for old patterns:
   - grep -r "factory\(client\)" packages/epicenter/src --include="*.ts" | grep -v test
   - Expected: ZERO matches (all factories updated)

4. Grep for shared mutable arrays:
   - grep -n "extensionCleanups\|whenReadyPromises" packages/epicenter/src/static/create-workspace.ts | grep "const\|let"
   - Expected: ZERO (only in BuilderState type)

5. Verify LIFO destroy:
   - Search create-document-binding.ts for "for (let i = extensions.length - 1"
   - Expected: Found in close(), closeAll(), and both error paths

6. Verify error handling:
   - Search create-workspace.ts for "try {" and "catch (err)"
   - Expected: Found in withExtension

## Success Definition

✓ All 6 baseline tests pass
✓ Builder branching is isolated (Phase 1)
✓ LIFO destroy is enforced (Phase 2)
✓ Void returns skip (Phase 3)
✓ Error handling with cleanup works (Phase 4)
✓ Shared helper exists (Phase 5)
✓ All 11 factories use ctx.client pattern (Phase 6)
✓ bun test passes
✓ bun run typecheck passes
✓ No type errors, no shared mutable arrays, consistent LIFO, comprehensive error handling
✓ Code is bold, clean, best-in-class

## Execution Tips

1. **Parallel execution:** Streams 1-3 can run in parallel. Then 4-5 in parallel. Then 6-7 in parallel. Then 8 sequential. Then 9 sequential.

2. **Checkpoints:** After each stream completes, run bun test to verify no regressions.

3. **Atomic commits:** After each stream, create an atomic commit. This enables rollback if Phase 6 hits issues.

4. **File references:** All file paths are relative to /Users/braden/Code/epicenter/

5. **Test code:** Copy EXACT test implementations from spec Phase 0 section (lines with test() { ... })

6. **Factory pattern:** For each factory, copy the pattern from spec Phase 6.9 example and apply to each file

Start now. Do not ask for confirmation. Execute all phases. Report completion.
```

---

## How to Use This

1. **Copy the entire "Master Execution Prompt" above (everything between the triple backticks)**

2. **Paste it into me** and I will immediately:
   - Spawn parallel work streams
   - Execute all phases in optimal order
   - Report progress
   - Verify success criteria

3. **Or use it with task delegation:**
   ```
   task(
     category="deep",
     load_skills=["typescript", "monorepo"],
     prompt="[paste the Master Execution Prompt here]",
     run_in_background=false
   )
   ```

---

## Quick Reference

| Stream | Phase | Files          | Parallelizable      |
| ------ | ----- | -------------- | ------------------- |
| 1      | 0     | Tests          | Must complete first |
| 2      | 1     | Static         | Yes, with Stream 3  |
| 3      | 1     | Dynamic        | Yes, with Stream 2  |
| 4      | 2     | Document       | After Phases 1+     |
| 5      | 3     | Static+Dynamic | Yes, parallel       |
| 6      | 4     | Static         | Yes, with Stream 7  |
| 7      | 4     | Dynamic        | Yes, with Stream 6  |
| 8      | 5     | Shared         | After all Phase 4   |
| 9      | 6     | All factories  | After Phase 5       |
