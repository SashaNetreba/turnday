---
name: verify
description: Run the project's quality gate (lint, typecheck, unit tests, architecture check) and fix what fails. Use before every commit and whenever asked to check that everything is green.
---

# Verify

1. Run `pnpm verify`. Pass or fail is decided **only by its exit code**: 0 = pass, anything else = fail.
   - Never pipe it (`| grep`, `| tail`, `| head`, …) when deciding pass/fail: the exit code would then come from the last command in the pipe, not from verify.
   - Never chain a commit after a pipe, e.g. `pnpm verify | grep … && git commit`.
   - If the output is too long, redirect it to a file and check the exit code: `pnpm verify > verify.log 2>&1; echo "exit: $?"`, then read the log.
2. If the exit code is not 0, read the first error, fix the cause (not the test), and run it again.
3. Never make a check pass by:
   - deleting or skipping a test (`.skip`, `.only`, commenting out),
   - loosening `tsconfig` strictness or adding `any` / `@ts-ignore`,
   - editing the dependency-cruiser rules that keep `packages/domain` pure.
   If one of these really seems necessary, stop and explain why instead.
4. When the exit code is 0, report in one or two lines: what ran, how many tests passed.
