import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as tomlParse } from 'smol-toml';
import type { ToolId } from '../types/tool.js';

export const TRUNNERRC_FILENAME = '.trunnerrc';

export interface TrunnerRc {
  /** Absolute path to the .trunnerrc file. */
  readonly path: string;
  /** The tool to use for this working directory. Defaults to 'terraform' if not specified. */
  readonly tool: ToolId;
  /** Optional tool binary version constraint (e.g. "~> 1.6"). */
  readonly version?: string;
}

export interface ParseRcWarning {
  key: string;
  message: string;
}

export interface ParseRcResult {
  config: TrunnerRc;
  warnings: ParseRcWarning[];
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(['tool', 'version']);

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
  let toolResolved: ToolId = 'terraform'; // default
  if (toolRaw !== undefined) {
    if (typeof toolRaw !== 'string' || toolRaw.length === 0) {
      throw new RcParseError(`invalid value for 'tool': expected non-empty string`, path);
    }
    const resolved = TOOL_ALIASES[toolRaw];
    if (!resolved || !VALID_TOOLS.has(resolved)) {
      throw new RcParseError(
        `invalid value for 'tool': ${JSON.stringify(toolRaw)} (expected: terraform | opentofu | tofu)`,
        path,
      );
    }
    toolResolved = resolved;
  }

  let version: string | undefined;
  if (parsed.version !== undefined) {
    if (typeof parsed.version !== 'string') {
      throw new RcParseError(`invalid value for 'version': expected string, got ${typeof parsed.version}`, path);
    }
    version = parsed.version;
  }

  const config: TrunnerRc = {
    path,
    tool: toolResolved,
    ...(version !== undefined ? { version } : {}),
  };

  return { config, warnings };
}

export function rcPathFor(workingDir: string): string {
  return join(workingDir, TRUNNERRC_FILENAME);
}
