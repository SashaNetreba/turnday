// Claude Code PreToolUse hook for Bash (wired in .claude/settings.json). No dependencies; Node >= 22.18.
// Blocks git push and git hook bypasses. Permission rules match text only, so `git -C . push` would slip past
// `Bash(git push *)`; this parses the command instead. Logic and tests: tools/claude-hooks/src/guard.ts.
// Exit 2 = block (stderr is shown to Claude), exit 0 = allow. Unreadable input is blocked (fail closed).
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { checkBashCommand } from '../../tools/claude-hooks/src/guard.ts';

let command;
try {
  command = JSON.parse(readFileSync(0, 'utf8')).tool_input.command;
} catch {
  command = undefined;
}

if (typeof command !== 'string') {
  process.stderr.write('guard-bash: could not read tool_input.command from the hook input; blocked (fail closed).\n');
  process.exit(2);
}

const result = checkBashCommand(command);
if (result.block) {
  process.stderr.write(`guard-bash: ${result.reason}\n`);
  process.exit(2);
}
