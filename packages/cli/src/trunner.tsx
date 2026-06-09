import { render } from 'ink';
import meow from 'meow';
import React from 'react';
import { App } from './app.js';
import { renderToolsCommand } from './commands/tools.js';
import { renderProvidersCommand } from './commands/providers.js';
import type { CliFlags, CliSubcommand } from './types.js';

const cli = meow(
  `
    Usage
      $ trunner                  Interactive mode: select command and tool step-by-step
      $ trunner <command> [args...]   Run a tool command across every discovered workspace
      $ trunner tools                 List installed tools + their versions
      $ trunner tools install <name>  Install a tool (e.g. trunner tools install terraform 1.6.6)
      $ trunner providers             List installed providers
      $ trunner providers install <source>  Install a provider
      $ trunner --version

    Options
       -t, --tool <name>         Override the .trunnerrc \`tool\` field for this invocation
       --cwd <path>              Start the workspace scan from <path> instead of the actual cwd
       --tool-version <semver>   Pin the tool binary version (e.g. 1.6.6, ~> 1.6)
       --include-prerelease      Allow pre-release versions in the solver (Phase 2B)
       --mirror <url>            Override the default terraform + provider mirror (Phase 2B)
       --concurrency <n>         Max workspaces running in parallel (default: os.cpus().length)
       --exclude <dir>           Add <dir> to the scan's exclude set (repeatable)
       --no-alt-screen           Skip the alternate screen buffer (scrollback stays visible; risky in reflow terminals)
       --json                    Emit one JSON line per workspace event (CI-friendly; no TUI)
       --quiet                   Suppress the status bar; emit only the final summary
       --auto-approve            Pass --auto-approve / -auto-approve when supported
       --no-color                Disable ANSI color in output
       --help                    Show this help
       --version                 Print the trunner version

    Examples
      $ trunner
      $ trunner plan
      $ trunner apply -auto-approve
      $ trunner plan -t opentofu
      $ trunner plan --concurrency 1
      $ trunner plan --exclude vendor
  `,
  {
    importMeta: import.meta,
    autoHelp: true,
    autoVersion: true,
    booleanDefault: undefined,
    flags: {
      tool: { type: 'string', shortFlag: 't' },
      cwd: { type: 'string' },
      toolVersion: { type: 'string' },
      includePrerelease: { type: 'boolean', default: false },
      mirror: { type: 'string' },
      concurrency: { type: 'string' },
      exclude: { type: 'string', isMultiple: true, default: [] },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      autoApprove: { type: 'boolean', default: false },
      color: { type: 'boolean', default: true },
      altScreen: { type: 'boolean', default: true },
    },
  },
);

// Buffer to hold results to print after Ink exits (alternate screen restoration)
let exitResults: string | null = null;

function handleExit(results: string): void {
  exitResults = results;
}

async function main(): Promise<void> {
  const positionals = cli.input;
  const verb = positionals[0];
  const subArgs = positionals.slice(1);

  const subcommand = detectSubcommand(verb);

  if (subcommand === 'tools' || subcommand === 'providers') {
    const subPositionals: string[] = [];
    if (verb) subPositionals.push(verb);
    for (const a of subArgs) if (a) subPositionals.push(a);
    await runSubcommand(subcommand, subPositionals, cli.flags);
    return;
  }

  // Interactive mode: show wizard, then run command.
  // Use alternate screen for proper resize handling.
  const interactiveMode = verb === undefined;
  if (interactiveMode) {
    const flags: CliFlags = parseFlags(cli);
    const interactive = process.stdout.isTTY !== false;
    const alternateScreen = flags.altScreen && interactive;
    const app = render(
      React.createElement(App, {
        command: null,
        commandArgs: [],
        flags,
        interactiveMode: true,
        onExit: handleExit,
      }),
      {
        ...(interactive ? { interactive: true } : {}),
        ...(alternateScreen ? { alternateScreen: true } : {}),
      },
    );
    await app.waitUntilExit();
    // Print results after Ink exits (alternate screen is restored)
    if (exitResults) {
      process.stdout.write(exitResults + '\n');
      exitResults = null;
    }
    return;
  }

  // Non-interactive mode: run a tool command across all discovered workspaces.
  // Use alternate screen for proper resize handling.
  const flags: CliFlags = parseFlags(cli);
  const interactive = process.stdout.isTTY !== false;
  const alternateScreen = flags.altScreen && interactive;
  const app = render(
    React.createElement(App, {
      command: verb,
      commandArgs: subArgs,
      flags,
      interactiveMode: false,
      onExit: handleExit,
    }),
    {
      ...(interactive ? { interactive: true } : {}),
      ...(alternateScreen ? { alternateScreen: true } : {}),
    },
  );
  await app.waitUntilExit();
  // Print results after Ink exits (alternate screen is restored)
  if (exitResults) {
    process.stdout.write(exitResults + '\n');
    exitResults = null;
  }
}

function detectSubcommand(verb: string | undefined): CliSubcommand | null {
  if (verb === 'tools' || verb === 'providers' || verb === 'config') {
    return verb;
  }
  return null;
}

async function runSubcommand(
  sub: CliSubcommand,
  positionals: string[],
  rawFlags: Record<string, unknown>,
): Promise<void> {
  switch (sub) {
    case 'tools':
      await renderToolsCommand(positionals, rawFlags);
      return;
    case 'providers':
      await renderProvidersCommand(positionals, rawFlags);
      return;
    case 'config':
      // Phase 3A: stub for now.
      console.error('trunner config is not yet implemented (Phase 3A)');
      process.exit(1);
  }
}

function parseFlags(cli: { flags: Record<string, unknown> }): CliFlags {
  const f = cli.flags;
  const concurrencyRaw = f.concurrency;
  const concurrency =
    typeof concurrencyRaw === 'string' && /^\d+$/.test(concurrencyRaw)
      ? Number.parseInt(concurrencyRaw, 10)
      : undefined;
  const exclude = Array.isArray(f.exclude) ? (f.exclude as string[]) : [];
  return {
    tool: typeof f.tool === 'string' ? f.tool : undefined,
    cwd: typeof f.cwd === 'string' ? f.cwd : process.cwd(),
    toolVersion: typeof f.toolVersion === 'string' ? f.toolVersion : undefined,
    includePrerelease: f.includePrerelease === true,
    mirror: typeof f.mirror === 'string' ? f.mirror : undefined,
    concurrency,
    exclude,
    json: f.json === true,
    quiet: f.quiet === true,
    autoApprove: f.autoApprove === true,
    color: f.color !== false,
    altScreen: f.altScreen !== false,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
