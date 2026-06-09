import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as tomlParse } from 'smol-toml';
import type { ToolId } from '../types/tool.js';

export const TRUNNERRC_FILENAME = '.trunnerrc';

export interface TrunnerRc {
  /** Absolute path to the .trunnerrc file. */
  readonly path: string;
  /** The tool to use for this workspace. */
  readonly tool: ToolId;
  /** Optional tool binary version constraint (e.g. "~> 1.6"). */
  readonly version?: string;
  /** Optional per-workspace concurrency override. */
  readonly concurrency?: number;
  /** Optional extra dirs to skip during the recursive scan. */
  readonly exclude?: readonly string[];
  /** Optional default command for interactive mode (e.g. "plan", "apply"). */
  readonly command?: string;
}

export interface ParseRcWarning {
  key: string;
  message: string;
}

export interface ParseRcResult {
  config: TrunnerRc;
  warnings: ParseRcWarning[];
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(['tool', 'version', 'concurrency', 'exclude', 'command']);

const TOOL_ALIASES: Record<string, ToolId> = {
  terraform: 'terraform',
  opentofu: 'opentofu',
  tofu: 'opentofu',
};

const VALID_TOOLS: ReadonlySet<ToolId> = new Set(['terraform', 'opentofu']);

export class RcParseError extends Error {
  override readonly name = 'RcParseError';
  readonly rcPath: string;
  constructor(message: string, rcPath: string, cause?: unknown) {
    super(`${rcPath}: ${message}`);
    this.rcPath = rcPath;
    this.cause = cause;
  }
}

export async function parseRc(path: string): Promise<ParseRcResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    throw new RcParseError(`could not read ${TRUNNERRC_FILENAME}: ${(err as Error).message}`, path, err);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = tomlParse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new RcParseError(`TOML parse error: ${(err as Error).message}`, path, err);
  }

  const warnings: ParseRcWarning[] = [];
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push({ key, message: `unknown key '${key}' in ${TRUNNERRC_FILENAME} (ignored)` });
    }
  }

  const toolRaw = parsed.tool;
  if (typeof toolRaw !== 'string' || toolRaw.length === 0) {
    throw new RcParseError("missing required field 'tool'", path);
  }
  const toolResolved = TOOL_ALIASES[toolRaw];
  if (!toolResolved || !VALID_TOOLS.has(toolResolved)) {
    throw new RcParseError(
      `invalid value for 'tool': ${JSON.stringify(toolRaw)} (expected: terraform | opentofu | tofu)`,
      path,
    );
  }

  let version: string | undefined;
  if (parsed.version !== undefined) {
    if (typeof parsed.version !== 'string') {
      throw new RcParseError(`invalid value for 'version': expected string, got ${typeof parsed.version}`, path);
    }
    version = parsed.version;
  }

  let concurrency: number | undefined;
  if (parsed.concurrency !== undefined) {
    if (typeof parsed.concurrency !== 'number' || !Number.isInteger(parsed.concurrency) || parsed.concurrency < 1) {
      throw new RcParseError(
        `invalid value for 'concurrency': expected positive integer, got ${JSON.stringify(parsed.concurrency)}`,
        path,
      );
    }
    concurrency = parsed.concurrency;
  }

  let exclude: readonly string[] | undefined;
  if (parsed.exclude !== undefined) {
    if (!Array.isArray(parsed.exclude) || !parsed.exclude.every((e) => typeof e === 'string' && e.length > 0)) {
      throw new RcParseError(
        `invalid value for 'exclude': expected array of non-empty strings`,
        path,
      );
    }
    exclude = parsed.exclude as string[];
  }

  let command: string | undefined;
  if (parsed.command !== undefined) {
    if (typeof parsed.command !== 'string' || parsed.command.length === 0) {
      throw new RcParseError(`invalid value for 'command': expected non-empty string, got ${typeof parsed.command}`, path);
    }
    command = parsed.command;
  }

  const config: TrunnerRc = {
    path,
    tool: toolResolved,
    ...(version !== undefined ? { version } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
    ...(command !== undefined ? { command } : {}),
  };

  return { config, warnings };
}

export function rcPathFor(workspaceDir: string): string {
  return join(workspaceDir, TRUNNERRC_FILENAME);
}
