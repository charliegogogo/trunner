import { render } from 'ink';
import meow from 'meow';
import React from 'react';
import { App } from './app.js';

const cli = meow(
  `
    Usage
      $ trunner <tool> <command> [args...]
      $ trunner terraform plan
      $ trunner terraform apply -auto-approve

    Options
      --mock       Use scripted mock data instead of running the real binary
      --cwd <dir>  Working directory for the underlying tool (default: cwd)
      --auto-yes   Auto-answer yes to all confirm prompts
      --no-color   Disable ANSI color in output
      --help       Show this help
      --version    Print the trunner version

    Examples
      $ trunner terraform plan
      $ trunner terraform apply -auto-approve
      $ trunner --mock terraform plan
  `,
  {
    importMeta: import.meta,
    autoHelp: true,
    autoVersion: true,
    booleanDefault: undefined,
    flags: {
      mock: {
        type: 'boolean',
        default: false,
      },
      cwd: {
        type: 'string',
        default: process.cwd(),
      },
      autoYes: {
        type: 'boolean',
        default: false,
      },
      color: {
        type: 'boolean',
        default: true,
      },
    },
  },
);

const positionals = cli.input;
const tool = positionals[0];
const command = positionals[1];
const commandArgs = positionals.slice(2);

if (!tool) {
  cli.showHelp();
  process.exit(0);
}

async function main(): Promise<void> {
  const app = render(
    React.createElement(App, {
      tool,
      command,
      commandArgs,
      flags: cli.flags,
    }),
  );
  await app.waitUntilExit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
