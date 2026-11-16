---
name: verify
description: Run the project's quality gate (lint, typecheck, unit tests, architecture check) and fix what fails. Use before every commit and whenever asked to check that everything is green.
---

# Verify

1. Run `pnpm verify`.
2. If it fails, read the first error, fix the cause (not the test), and run it again.
3. Never make a check pass by:
   - deleting or skipping a test (`.skip`, `.only`, commenting out),
   - loosening `tsconfig` strictness or adding `any` / `@ts-ignore`,
   - editing the dependency-cruiser rules that keep `packages/domain` pure.
   If one of these really seems necessary, stop and explain why instead.
4. When green, report in one or two lines: what ran, how many tests passed.
