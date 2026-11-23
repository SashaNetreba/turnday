// Decides whether a Bash command Claude Code wants to run must be blocked: git push (the user pushes) and any way
// of bypassing the git hooks (CLAUDE.md: hooks are never bypassed).
//
// Claude Code permission rules match the command text only, so `git -C . push` slips past `Bash(git push *)`.
// This module parses the shell command instead: it splits it into simple commands (also inside $(…), `…`,
// sh -c "…" and eval), strips prefixes (VAR=x, env, timeout, pnpm exec, …), and reads git's subcommand after its
// global options. It parses, it doesn't execute: commands built at runtime are not seen.

export type GuardResult = { block: false } | { block: true; reason: string };

const ALLOW: GuardResult = { block: false };
const MAX_DEPTH = 5;

function block(reason: string): GuardResult {
  return { block: true, reason };
}

const pushBlocked = (how: string) =>
  block(
    `git push is blocked (${how}): the user pushes. Hand over the PR text instead (CLAUDE.md).`,
  );
const bypassBlocked = (how: string) =>
  block(`git hooks are never bypassed (${how}). Fix what the hook reports instead (CLAUDE.md).`);

export function checkBashCommand(command: string): GuardResult {
  return checkScript(command, 0);
}

function checkScript(source: string, depth: number): GuardResult {
  if (depth > MAX_DEPTH)
    return block('the command nests shells too deeply to check; blocked to be safe');
  let commands: Word[][];
  try {
    commands = parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return block(`the command could not be parsed (${detail}); blocked to be safe`);
  }
  for (const words of commands) {
    const result = checkArgs(dropRedirections(words), depth);
    if (result.block) return result;
  }
  return ALLOW;
}

// ---------------------------------------------------------------------------------------------------------------
// Shell parsing: just enough of POSIX sh / bash to find the simple commands.

interface Word {
  text: string;
  quoted: boolean;
}

interface Scanner {
  src: string;
  pos: number;
  out: Word[][];
}

function parse(src: string): Word[][] {
  const scanner: Scanner = { src, pos: 0, out: [] };
  parseList(scanner, null);
  return scanner.out;
}

/** Parses commands until `stop` (the end of a $(…) or `…`) or the end of the input. */
function parseList(s: Scanner, stop: ')' | '`' | null): void {
  let words: Word[] = [];
  let text = '';
  let quoted = false;
  let inWord = false;
  let parens = 0;
  const heredocs: { delimiter: string; stripTabs: boolean }[] = [];

  const endWord = () => {
    if (inWord) words.push({ text, quoted });
    text = '';
    quoted = false;
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) s.out.push(words);
    words = [];
  };

  while (s.pos < s.src.length) {
    const c = s.src.charAt(s.pos);
    const next = s.src.charAt(s.pos + 1);

    if (stop === '`' && c === '`') {
      endCommand();
      s.pos++;
      return;
    }
    if (c === ')') {
      endCommand();
      s.pos++;
      if (parens === 0 && stop === ')') return;
      parens = Math.max(0, parens - 1);
      continue;
    }
    if (c === '(') {
      endCommand();
      parens++;
      s.pos++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      endWord();
      s.pos++;
      continue;
    }
    if (c === '\n') {
      endCommand();
      s.pos++;
      skipHeredocBodies(s, heredocs.splice(0));
      continue;
    }
    if (c === '#' && !inWord) {
      while (s.pos < s.src.length && s.src.charAt(s.pos) !== '\n') s.pos++;
      continue;
    }
    if (c === '\\') {
      if (next !== '\n') {
        text += next;
        quoted = true;
        inWord = true;
      }
      s.pos += 2;
      continue;
    }
    if (c === "'") {
      const end = s.src.indexOf("'", s.pos + 1);
      if (end < 0) throw new Error('unterminated single quote');
      text += s.src.slice(s.pos + 1, end);
      quoted = true;
      inWord = true;
      s.pos = end + 1;
      continue;
    }
    if (c === '"') {
      s.pos++;
      text += readDoubleQuoted(s);
      quoted = true;
      inWord = true;
      continue;
    }
    if (c === '$' && next === '(') {
      s.pos += 2;
      parseList(s, ')');
      text += '$(…)';
      inWord = true;
      continue;
    }
    if (c === '`') {
      s.pos++;
      parseList(s, '`');
      text += '`…`';
      inWord = true;
      continue;
    }
    if (c === '<' && next === '<' && s.src.charAt(s.pos + 2) !== '<') {
      endWord();
      s.pos += 2;
      const stripTabs = s.src.charAt(s.pos) === '-';
      if (stripTabs) s.pos++;
      while (s.src.charAt(s.pos) === ' ' || s.src.charAt(s.pos) === '\t') s.pos++;
      heredocs.push({ delimiter: readHeredocDelimiter(s), stripTabs });
      continue;
    }
    if (c === '&' || c === '|' || c === ';') {
      // `>&2`, `2>&1`, `&>file` are redirections, not separators.
      if (c === '&' && (text.endsWith('>') || text.endsWith('<') || next === '>')) {
        text += c;
        inWord = true;
        s.pos++;
        continue;
      }
      endCommand();
      s.pos++;
      continue;
    }
    text += c;
    inWord = true;
    s.pos++;
  }

  if (stop !== null) throw new Error(`unterminated ${stop === ')' ? '$(' : '`'}`);
  endCommand();
}

function readDoubleQuoted(s: Scanner): string {
  let text = '';
  while (s.pos < s.src.length) {
    const c = s.src.charAt(s.pos);
    const next = s.src.charAt(s.pos + 1);
    if (c === '"') {
      s.pos++;
      return text;
    }
    if (c === '\\' && next !== '' && '$`"\\\n'.includes(next)) {
      if (next !== '\n') text += next;
      s.pos += 2;
      continue;
    }
    if (c === '$' && next === '(') {
      s.pos += 2;
      parseList(s, ')');
      text += '$(…)';
      continue;
    }
    if (c === '`') {
      s.pos++;
      parseList(s, '`');
      text += '`…`';
      continue;
    }
    text += c;
    s.pos++;
  }
  throw new Error('unterminated double quote');
}

function readHeredocDelimiter(s: Scanner): string {
  let delimiter = '';
  while (s.pos < s.src.length) {
    const c = s.src.charAt(s.pos);
    if (' \t\n;|&<>()'.includes(c)) break;
    if (c === "'" || c === '"') {
      const end = s.src.indexOf(c, s.pos + 1);
      if (end < 0) throw new Error('unterminated quote in a heredoc delimiter');
      delimiter += s.src.slice(s.pos + 1, end);
      s.pos = end + 1;
      continue;
    }
    if (c === '\\') {
      delimiter += s.src.charAt(s.pos + 1);
      s.pos += 2;
      continue;
    }
    delimiter += c;
    s.pos++;
  }
  if (delimiter === '') throw new Error('heredoc without a delimiter');
  return delimiter;
}

/** Heredoc bodies are data (a commit message, a file), not commands: skip them. */
function skipHeredocBodies(
  s: Scanner,
  heredocs: { delimiter: string; stripTabs: boolean }[],
): void {
  for (const { delimiter, stripTabs } of heredocs) {
    while (s.pos < s.src.length) {
      const newline = s.src.indexOf('\n', s.pos);
      const end = newline < 0 ? s.src.length : newline;
      const line = s.src.slice(s.pos, end);
      s.pos = newline < 0 ? s.src.length : newline + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break;
    }
  }
}

const REDIRECTION = /^(?:\d+|&)?(?:<<<|>>|>\||<>|>|<)&?(.*)$/s;

/** Drops `>file`, `2>&1`, `> file`, … so they aren't mistaken for arguments. */
function dropRedirections(words: Word[]): string[] {
  const args: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === undefined) continue;
    const match = word.quoted ? null : REDIRECTION.exec(word.text);
    if (match) {
      if (match[1] === '') i++; // the target is the next word
      continue;
    }
    args.push(word.text);
  }
  return args;
}

// ---------------------------------------------------------------------------------------------------------------
// One simple command.

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const RESERVED_WORDS = new Set([
  '{',
  '}',
  '!',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
]);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const DECLARATIONS = new Set(['export', 'declare', 'typeset', 'readonly', 'local']);

/** Wrappers that run the rest of the line as a command, and their options that take a value. */
const WRAPPERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['env', new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])],
  ['command', new Set<string>()],
  ['builtin', new Set<string>()],
  ['exec', new Set(['-a'])],
  ['nohup', new Set<string>()],
  ['time', new Set(['-f', '-o'])],
  ['nice', new Set(['-n'])],
  ['sudo', new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U'])],
  ['xargs', new Set(['-I', '-n', '-L', '-P', '-d', '-E', '-s', '-a'])],
  ['npx', new Set(['-p', '--package'])],
  ['timeout', new Set(['-s', '--signal', '-k', '--kill-after'])],
]);
const PNPM_VALUE_OPTIONS = new Set([
  '-C',
  '--dir',
  '-F',
  '--filter',
  '--filter-prod',
  '-w',
  '--workspace-dir',
]);

function basename(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1);
}

/** Index of the first argument at or after `from` that isn't an option (skipping option values). */
function skipOptions(args: string[], from: number, valueOptions: ReadonlySet<string>): number {
  let i = from;
  for (let arg = args[i]; arg?.startsWith('-') && arg !== '-'; arg = args[i]) {
    i += valueOptions.has(arg) ? 2 : 1;
  }
  return i;
}

function checkArgs(args: string[], depth: number): GuardResult {
  let i = 0;
  // Strip everything that only prefixes the real command.
  for (;;) {
    const word = args[i];
    if (word === undefined) return ALLOW;
    const assignment = ASSIGNMENT.exec(word);
    if (assignment) {
      const result = checkAssignment(assignment[1] ?? '', assignment[2] ?? '');
      if (result.block) return result;
      i++;
      continue;
    }
    if (RESERVED_WORDS.has(word)) {
      i++;
      continue;
    }
    const name = basename(word);
    const wrapperOptions = WRAPPERS.get(name);
    if (wrapperOptions) {
      i = skipOptions(args, i + 1, wrapperOptions);
      if (name === 'timeout') i++; // the duration
      continue;
    }
    if (name === 'pnpm' || name === 'yarn') {
      const sub = skipOptions(args, i + 1, PNPM_VALUE_OPTIONS);
      const subcommand = args[sub];
      if (subcommand === 'exec' || subcommand === 'dlx') {
        i = skipOptions(args, sub + 1, new Set());
        continue;
      }
      if (subcommand === 'lefthook') {
        i = sub;
        continue;
      }
      return ALLOW;
    }
    break;
  }

  const command = basename(args[i] ?? '');
  const rest = args.slice(i + 1);

  if (DECLARATIONS.has(command)) {
    for (const arg of rest) {
      const assignment = ASSIGNMENT.exec(arg);
      if (!assignment) continue;
      const result = checkAssignment(assignment[1] ?? '', assignment[2] ?? '');
      if (result.block) return result;
    }
    return ALLOW;
  }
  if (SHELLS.has(command)) {
    const flag = rest.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
    const script = flag < 0 ? undefined : rest.slice(flag + 1).find((arg) => !arg.startsWith('-'));
    return script === undefined ? ALLOW : checkScript(script, depth + 1);
  }
  if (command === 'eval') return checkScript(rest.join(' '), depth + 1);
  if (command === 'git') return checkGit(rest);
  if (command === 'lefthook') {
    return rest[skipOptions(rest, 0, new Set())] === 'uninstall'
      ? bypassBlocked('lefthook uninstall removes the hooks')
      : ALLOW;
  }
  return ALLOW;
}

function checkAssignment(name: string, value: string): GuardResult {
  if (name === 'LEFTHOOK' && value !== '1' && value.toLowerCase() !== 'true') {
    return bypassBlocked(`${name}=${value} disables lefthook`);
  }
  if (name === 'LEFTHOOK_SKIP' || name === 'LEFTHOOK_EXCLUDE') {
    return bypassBlocked(`${name} skips lefthook commands`);
  }
  return ALLOW;
}

// ---------------------------------------------------------------------------------------------------------------
// git

const GIT_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix',
]);

function checkGit(args: string[]): GuardResult {
  const configs: string[] = [];
  let i = 0;
  for (let arg = args[i]; arg?.startsWith('-'); arg = args[i]) {
    if (GIT_VALUE_OPTIONS.has(arg)) {
      if (arg === '-c' || arg === '--config-env') configs.push(args[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (arg.startsWith('--config-env=')) configs.push(arg.slice('--config-env='.length));
    i++;
  }
  for (const setting of configs) {
    const key = (setting.split('=')[0] ?? '').toLowerCase();
    if (key === 'core.hookspath')
      return bypassBlocked(`git -c ${setting} points git away from the hooks`);
    if (key.startsWith('alias.'))
      return bypassBlocked(`git -c ${setting} defines an alias the guard can't see through`);
  }

  const subcommand = args[i];
  if (subcommand === undefined) return ALLOW;
  const end = args.indexOf('--', i + 1);
  const subArgs = args.slice(i + 1, end < 0 ? undefined : end);

  if (subcommand === 'push') return pushBlocked(`git ${args.slice(0, i + 1).join(' ')}`);
  const noVerify = subArgs.find(
    (arg) => arg.length >= '--no-ver'.length && '--no-verify'.startsWith(arg),
  );
  if (noVerify !== undefined) return bypassBlocked(`git ${subcommand} ${noVerify}`);
  if (subcommand === 'commit') return checkCommit(subArgs);
  if (subcommand === 'config') return checkConfig(subArgs);
  return ALLOW;
}

const COMMIT_SHORT_WITH_VALUE = 'mFCct';
const COMMIT_SHORT_ATTACHED_VALUE = 'Su';
const COMMIT_LONG_WITH_VALUE = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--template',
  '--author',
  '--date',
  '--fixup',
  '--squash',
  '--trailer',
  '--cleanup',
  '--pathspec-from-file',
]);

/** `git commit -n` is --no-verify; also inside a cluster like `-nm`, but not as the value of `-m`. */
function checkCommit(args: string[]): GuardResult {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg.startsWith('--')) {
      if (COMMIT_LONG_WITH_VALUE.has(arg)) i++;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') continue;
    for (let k = 1; k < arg.length; k++) {
      const flag = arg.charAt(k);
      if (flag === 'n') return bypassBlocked(`git commit ${arg} (-n is --no-verify)`);
      if (COMMIT_SHORT_ATTACHED_VALUE.includes(flag)) break;
      if (COMMIT_SHORT_WITH_VALUE.includes(flag)) {
        if (k === arg.length - 1) i++; // the value is the next argument
        break;
      }
    }
  }
  return ALLOW;
}

const CONFIG_VALUE_OPTIONS = new Set([
  '-f',
  '--file',
  '--blob',
  '-t',
  '--type',
  '--default',
  '--comment',
  '--value',
]);
const CONFIG_WRITE_OPTIONS = new Set(['--add', '--replace-all']);
const CONFIG_OTHER_ACTIONS = new Set([
  '--get',
  '--get-all',
  '--get-regexp',
  '--get-urlmatch',
  '--get-color',
  '--get-colorbool',
  '-l',
  '--list',
  '--unset',
  '--unset-all',
  '--rename-section',
  '--remove-section',
  '-e',
  '--edit',
]);
const CONFIG_OTHER_SUBCOMMANDS = new Set([
  'get',
  'list',
  'unset',
  'rename-section',
  'remove-section',
  'edit',
]);

/** Writing core.hooksPath or an alias is blocked; reading config is fine. */
function checkConfig(args: string[]): GuardResult {
  let action: 'write' | 'other' | 'auto' = 'auto';
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (arg.includes('=')) continue;
    if (CONFIG_VALUE_OPTIONS.has(arg)) i++;
    else if (CONFIG_WRITE_OPTIONS.has(arg)) action = 'write';
    else if (CONFIG_OTHER_ACTIONS.has(arg)) action = 'other';
  }
  if (action === 'auto' && positionals[0] === 'set') {
    action = 'write';
    positionals.shift();
  } else if (action === 'auto' && CONFIG_OTHER_SUBCOMMANDS.has(positionals[0] ?? '')) {
    action = 'other';
  }
  const key = (positionals[0] ?? '').toLowerCase();
  const writes = action === 'write' || (action === 'auto' && positionals.length >= 2);
  if (!writes) return ALLOW;
  if (key === 'core.hookspath')
    return bypassBlocked(`git config ${positionals.join(' ')} points git away from the hooks`);
  if (key.startsWith('alias.')) {
    return bypassBlocked(
      `git config ${positionals.join(' ')} defines an alias the guard can't see through`,
    );
  }
  return ALLOW;
}
