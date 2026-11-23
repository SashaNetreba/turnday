import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkBashCommand } from './guard.ts';

describe('checkBashCommand — blocked', () => {
  it.each([
    // git push, however it is written
    'git push',
    'git push origin main',
    'git -C . push',
    'git -c x=y push origin main',
    'cd x && git push',
    'git --git-dir=.git push',
    'git --git-dir .git --work-tree . push',
    'git status; git push',
    'git status | cat\ngit push',
    '/usr/bin/git push',
    'env GIT_TRACE=1 git push',
    'bash -c "git push"',
    'echo $(git push)',
    'eval "git push"',
    '{ git push; }',
    'if true; then git push; fi',
    'timeout 60 git push',
    'echo main | xargs git push origin',
    'pnpm --filter x exec git push',
    'git -C . push --dry-run',
    // hook bypass
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'git commit -nm x',
    'git commit -am x -n',
    'git commit --no-veri -m x',
    'git push --no-verify',
    'git merge --no-verify feature',
    'LEFTHOOK=0 git commit -m x',
    'FOO=1 LEFTHOOK=0 git commit -m x',
    'LEFTHOOK_SKIP=pre-commit git commit -m x',
    'env LEFTHOOK=0 git commit -m x',
    'export LEFTHOOK=0',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -c CORE.HOOKSPATH=/dev/null commit -m x',
    'git config core.hooksPath /dev/null',
    'git config --local core.hooksPath x',
    'git config --file .git/config core.hooksPath x',
    'git config set core.hooksPath x',
    'git config alias.p push',
    'git -c alias.p=push p',
    'git config --global alias.x "commit -n"',
    'lefthook uninstall',
    'pnpm exec lefthook uninstall',
    'pnpm lefthook uninstall',
    'npx lefthook uninstall',
    // unparseable → fail closed
    'git commit -m "unterminated',
  ])('blocks %j', (command) => {
    expect(checkBashCommand(command).block).toBe(true);
  });
});

describe('checkBashCommand — allowed', () => {
  it.each([
    'git status',
    'git log --grep=push',
    'git log -n 5',
    'git clean -n',
    'pnpm verify',
    'pnpm test:matrix',
    'git commit -m "no push here"',
    'git commit -m "fix -n flag"',
    'git commit -m -n',
    'git commit -F msg.txt',
    'echo git push',
    'grep -rn "git push" docs',
    'git diff -- push.ts',
    'git add src/push.ts',
    'git config user.email',
    'git config --get core.hooksPath',
    'git config --get-regexp alias',
    'git config get core.hooksPath',
    'lefthook install',
    'pnpm exec lefthook run pre-push',
    'git checkout -- docs/traceability.md',
    'git log --oneline 2>&1 | head -5',
    "git commit -m \"$(cat <<'EOF'\nfix: don't push yet\n\ngit push comes later\nEOF\n)\"",
    'cat <<EOF > notes.md\ngit push\nEOF',
    'LEFTHOOK_VERBOSE=1 git commit -m x',
  ])('allows %j', (command) => {
    expect(checkBashCommand(command)).toEqual({ block: false });
  });
});

describe('.claude/hooks/guard-bash.js — the entry Claude Code runs', () => {
  const entry = fileURLToPath(new URL('../../../.claude/hooks/guard-bash.js', import.meta.url));
  const run = (stdin: string) =>
    spawnSync(process.execPath, [entry], { input: stdin, encoding: 'utf8' });
  const hookInput = (command: string) =>
    JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

  it('exits 2 with a reason for git -C . push', () => {
    const result = run(hookInput('git -C . push'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('push');
  });

  it('exits 0 for git status', () => {
    expect(run(hookInput('git status')).status).toBe(0);
  });

  it('exits 2 when the input is not valid hook JSON (fail closed)', () => {
    expect(run('not json').status).toBe(2);
  });
});
