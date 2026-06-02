import type { CommandOptions, CommandRegistry, CommandSpec } from '../../types/command.js';

const COMMANDS: CommandSpec[] = [
  {
    name: 'init',
    description: 'Initialize a Terraform working directory.',
    args: [
      { flags: ['-input'], description: 'Ask for input if necessary.', takesValue: false, default: true },
      { flags: ['-upgrade'], description: 'Upgrade modules and plugins.', takesValue: false, default: false },
    ],
    env: [{ key: 'TF_INPUT', description: 'Disable interactive input (set to "0" or "false").' }],
  },
  {
    name: 'plan',
    description: 'Generate and show an execution plan.',
    args: [
      { flags: ['-out'], description: 'Write the plan to a given file.', takesValue: true },
      { flags: ['-destroy'], description: 'Create a destroy plan.', takesValue: false, default: false },
    ],
    env: [],
    requiresConfirmation: false,
  },
  {
    name: 'apply',
    description: 'Apply the changes required to reach the desired state.',
    args: [
      { flags: ['-auto-approve'], description: 'Skip interactive approval.', takesValue: false, default: false },
      { flags: ['-input'], description: 'Ask for input if necessary.', takesValue: false, default: true },
    ],
    env: [{ key: 'TF_INPUT', description: 'Disable interactive input.' }],
    requiresConfirmation: true,
    autoApproveFlag: '-auto-approve',
  },
  {
    name: 'destroy',
    description: 'Destroy Terraform-managed infrastructure.',
    args: [
      { flags: ['-auto-approve'], description: 'Skip interactive approval.', takesValue: false, default: false },
    ],
    env: [],
    requiresConfirmation: true,
    autoApproveFlag: '-auto-approve',
  },
  {
    name: 'validate',
    description: 'Validate the configuration files.',
    args: [
      { flags: ['-json'], description: 'Output in JSON format.', takesValue: false, default: false },
    ],
    env: [],
  },
  {
    name: 'output',
    description: 'Read an output from a state file.',
    args: [
      { flags: ['-json'], description: 'Output in JSON format.', takesValue: false, default: false },
    ],
    env: [],
  },
  {
    name: 'fmt',
    description: 'Reformat the configuration files in the given directory.',
    args: [
      { flags: ['-check'], description: 'Check if the input is formatted; exit non-zero if not.', takesValue: false, default: false },
      { flags: ['-recursive'], description: 'Also process subdirectories.', takesValue: false, default: false },
    ],
    env: [],
  },
];

class TerraformCommandRegistry implements CommandRegistry {
  readonly toolId = 'terraform' as const;
  private readonly map: Map<string, CommandSpec>;

  constructor(commands: CommandSpec[]) {
    this.map = new Map(commands.map((c) => [c.name, c]));
  }

  get(name: string): CommandSpec | undefined {
    return this.map.get(name);
  }

  list(): CommandSpec[] {
    return [...this.map.values()];
  }

  buildInvocation(name: string, opts: CommandOptions): string[] {
    const spec = this.map.get(name);
    if (!spec) throw new Error(`Unknown terraform command: ${name}`);
    const out: string[] = [name];

    for (const a of spec.args) {
      // Skip flags whose value was not provided; only set defaults that are truthy.
      if (a.takesValue) {
        const provided = findArgValue(opts.args, a.flags);
        if (provided !== undefined) {
          out.push(a.flags[0]!, provided);
        }
        continue;
      }
      const provided = hasFlag(opts.args, a.flags);
      if (provided) {
        out.push(a.flags[0]!);
        continue;
      }
      if (opts.autoApprove && a.flags.includes(spec.autoApproveFlag ?? '')) {
        out.push(spec.autoApproveFlag!);
      }
    }

    if (opts.extraArgs && opts.extraArgs.length > 0) {
      out.push(...opts.extraArgs);
    }

    return out;
  }
}

function hasFlag(args: string[] | undefined, flags: string[]): boolean {
  if (!args) return false;
  return args.some((a) => flags.includes(a));
}

function findArgValue(args: string[] | undefined, flags: string[]): string | undefined {
  if (!args) return undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (flags.includes(a) && i + 1 < args.length) return args[i + 1];
    for (const f of flags) {
      if (a.startsWith(`${f}=`)) return a.slice(f.length + 1);
    }
  }
  return undefined;
}

export const terraformCommands: CommandRegistry = new TerraformCommandRegistry(COMMANDS);
