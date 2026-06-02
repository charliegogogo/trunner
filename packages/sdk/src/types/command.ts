import type { ToolId } from './tool.js';

export interface ArgSpec {
  flags: string[];
  description: string;
  takesValue?: boolean;
  default?: string | boolean;
}

export interface EnvSpec {
  key: string;
  description: string;
  required?: boolean;
  defaultValue?: string;
}

export type CommandName = string;

export interface CommandSpec {
  name: CommandName;
  description: string;
  args: ArgSpec[];
  env: EnvSpec[];
  requiresConfirmation?: boolean;
  autoApproveFlag?: string;
}

export interface CommandRegistry {
  readonly toolId: ToolId;
  get(name: CommandName): CommandSpec | undefined;
  list(): CommandSpec[];
  buildInvocation(name: CommandName, opts: CommandOptions): string[];
}

export interface CommandOptions {
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  autoApprove?: boolean;
  extraArgs?: string[];
}
