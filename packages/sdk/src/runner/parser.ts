import type { ChangeCounts, ParsedSummary } from '../types/result.js';

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const PLAN_RE = /Plan:\s+(\d+)\s+to\s+add,\s+(\d+)\s+to\s+change,\s+(\d+)\s+to\s+destroy/;
const PLAN_DESTROY_RE = /Plan:\s+(\d+)\s+to\s+destroy/;
const APPLY_RESULT_RE =
  /Apply complete! Resources:\s+(\d+)\s+added,\s+(\d+)\s+changed,\s+(\d+)\s+destroyed/;
const DESTROY_RESULT_RE = /Destroy complete! Resources:\s+(\d+)\s+destroyed/;
const ERROR_RE = /Error:\s+(.+)/;

export interface ParseOptions {
  /** If true, also extract error/warning lines. */
  includeDiagnostics?: boolean;
}

export function parsePlanAndApplyOutput(stdout: string, stderr: string, opts: ParseOptions = {}): ParsedSummary {
  const combined = `${stdout}\n${stderr}`;
  const clean = stripAnsi(combined);
  const summary: ParsedSummary = {};

  const planMatch = clean.match(PLAN_RE);
  if (planMatch) {
    const counts: ChangeCounts = {
      add: Number.parseInt(planMatch[1]!, 10),
      change: Number.parseInt(planMatch[2]!, 10),
      destroy: Number.parseInt(planMatch[3]!, 10),
    };
    counts.total = counts.add + counts.change + counts.destroy;
    summary.changes = counts;
  } else {
    const destroyMatch = clean.match(PLAN_DESTROY_RE);
    if (destroyMatch) {
      const counts: ChangeCounts = {
        add: 0,
        change: 0,
        destroy: Number.parseInt(destroyMatch[1]!, 10),
      };
      counts.total = counts.destroy;
      summary.changes = counts;
    }
  }

  const applyMatch = clean.match(APPLY_RESULT_RE);
  if (applyMatch) {
    const counts: ChangeCounts = {
      add: Number.parseInt(applyMatch[1]!, 10),
      change: Number.parseInt(applyMatch[2]!, 10),
      destroy: Number.parseInt(applyMatch[3]!, 10),
    };
    counts.total = counts.add + counts.change + counts.destroy;
    summary.changes = counts;
  }

  const destroyMatch = clean.match(DESTROY_RESULT_RE);
  if (destroyMatch) {
    const counts: ChangeCounts = {
      add: 0,
      change: 0,
      destroy: Number.parseInt(destroyMatch[1]!, 10),
    };
    counts.total = counts.destroy;
    summary.changes = counts;
  }

  if (opts.includeDiagnostics) {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const line of clean.split(/\r?\n/)) {
      const em = line.match(ERROR_RE);
      if (em) errors.push(em[1]!.trim());
      else if (/(^|\s)(Warning|warning):/.test(line)) warnings.push(line.trim());
    }
    if (errors.length) summary.errors = errors;
    if (warnings.length) summary.warnings = warnings;
  }

  summary.rawLines = clean.split(/\r?\n/).length;
  return summary;
}
