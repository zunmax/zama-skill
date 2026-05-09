#!/usr/bin/env node
/**
 * @file cli.js
 * @description zama-skill installer CLI: copies the bundled skill assets into a target project for the chosen agent runtime (claude, codex, cursor, windsurf, other).
 */
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, cwd, stderr, stdout } from 'node:process';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));

const SUBCOMMANDS = {
  claude:   { sources: ['.claude'] },
  codex:    { sources: ['.agents', 'AGENTS.md'] },
  cursor:   { sources: ['.cursor', 'AGENTS.md'] },
  windsurf: { sources: ['.windsurfrules', '.agents'] },
  other:    { sources: ['.agents', 'AGENTS.md'] },
};

const HELP = `zama-skill v${PKG.version}

Install the Zama Skill bundle for your AI coding agent.

USAGE:
  npx zama-skill <subcommand> [flags]

SUBCOMMANDS:
  claude    Install the Claude Code bundle (.claude/)
  codex     Install the Codex CLI bundle (.agents/ + AGENTS.md)
  cursor    Install the Cursor bundle (.cursor/ + AGENTS.md)
  windsurf  Install the Windsurf bundle (.windsurfrules + .agents/)
  other     Install the AGENTS.md bundle for other tools (Aider, Cline,
            Continue, Zed, Jules, ...) (.agents/ + AGENTS.md)

FLAGS:
  --target <path>   Destination root (default: current working directory)
  --target=<path>   Same as --target <path> (= form also accepted)
  --force           Overwrite existing files
  --dry-run         Print what would be copied; write nothing
  -h, --help        Show this help
  -V, --version     Show version

EXAMPLES:
  npx zama-skill claude
  npx zama-skill codex --target ./my-project
  npx zama-skill cursor --dry-run
  npx zama-skill windsurf`;

function die(msg) {
  stderr.write(`error: ${msg}\nRun 'npx zama-skill --help' for usage.\n`);
  exit(1);
}

function parseArgs(args) {
  const flags = { target: cwd(), force: false, dryRun: false, help: false, version: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--version' || a === '-V') flags.version = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--target') {
      const v = args[++i];
      if (!v || v.startsWith('-')) die('--target requires a path argument');
      flags.target = resolve(v);
    } else if (a.startsWith('--target=')) {
      const v = a.slice('--target='.length);
      if (!v) die('--target requires a path argument');
      flags.target = resolve(v);
    } else if (a.startsWith('-')) {
      die(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function walkFiles(absRoot) {
  const out = [];
  const stack = [{ dir: absRoot, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const r = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) stack.push({ dir: abs, rel: r });
      else if (entry.isFile()) out.push({ absPath: abs, relPath: r });
    }
  }
  return out;
}

function planCopies(spec, targetDir) {
  const ops = [];
  for (const source of spec.sources) {
    const absSrc = resolve(PACKAGE_ROOT, source);
    if (!existsSync(absSrc)) {
      die(`Bundle source missing: ${source} (looked at ${absSrc}). Package may be corrupted.`);
    }
    const st = statSync(absSrc);
    if (st.isFile()) {
      ops.push({ src: absSrc, dst: join(targetDir, source) });
    } else {
      for (const { absPath, relPath } of walkFiles(absSrc)) {
        ops.push({ src: absPath, dst: join(targetDir, source, relPath) });
      }
    }
  }
  return ops;
}

function main() {
  const { flags, positional } = parseArgs(argv.slice(2));

  if (flags.help) { stdout.write(HELP + '\n'); exit(0); }
  if (flags.version) { stdout.write(`zama-skill v${PKG.version}\n`); exit(0); }
  if (positional.length === 0) {
    stderr.write("error: missing subcommand. Run 'npx zama-skill --help' for usage.\n");
    exit(1);
  }

  const sub = positional[0];
  if (!SUBCOMMANDS[sub]) {
    die(`Unknown subcommand: ${sub}. Run 'npx zama-skill --help' for the list.`);
  }
  if (positional.length > 1) {
    die(`Unexpected extra argument: ${positional[1]}`);
  }

  const targetDir = flags.target;
  const ops = planCopies(SUBCOMMANDS[sub], targetDir);

  const conflicts = ops.filter(({ dst }) => existsSync(dst));
  if (conflicts.length > 0 && !flags.force && !flags.dryRun) {
    stderr.write(`error: ${conflicts.length} file(s) already exist at the target. Re-run with --force to overwrite:\n`);
    for (const c of conflicts) stderr.write(`  - ${relative(targetDir, c.dst)}\n`);
    exit(1);
  }

  const verb = flags.dryRun ? 'would write' : 'wrote';
  for (const { src, dst } of ops) {
    if (!flags.dryRun) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
    stdout.write(`  ${verb} ${relative(targetDir, dst) || dst}\n`);
  }
  const summary = flags.dryRun
    ? `Dry run complete: ${ops.length} file(s) would be installed into ${targetDir}.`
    : `Installed zama-skill (${sub}) into ${targetDir}. ${ops.length} file(s) copied.`;
  stdout.write(`\n${summary}\n`);
}

main();
