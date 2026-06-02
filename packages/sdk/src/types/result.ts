export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  parsed?: ParsedSummary;
}

export interface ParsedSummary {
  changes?: ChangeCounts;
  rawLines?: number;
  errors?: string[];
  warnings?: string[];
}

export interface ChangeCounts {
  add: number;
  change: number;
  destroy: number;
  replace?: number;
  total?: number;
}

export type ResultStatus = 'ok' | 'error' | 'cancelled' | 'prompt-required';
