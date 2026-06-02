import { describe, expect, it } from 'vitest';
import { parsePlanAndApplyOutput } from '../../src/runner/parser.js';

describe('runner/parser', () => {
  it('parses "Plan: N to add, M to change, K to destroy"', () => {
    const out = 'Terraform will perform the following actions:\n  Plan: 2 to add, 1 to change, 0 to destroy.';
    const parsed = parsePlanAndApplyOutput(out, '', { includeDiagnostics: true });
    expect(parsed.changes).toEqual({ add: 2, change: 1, destroy: 0, total: 3 });
  });

  it('parses "Plan: N to destroy" (destroy-only plan)', () => {
    const out = 'Plan: 5 to destroy.';
    const parsed = parsePlanAndApplyOutput(out, '');
    expect(parsed.changes).toEqual({ add: 0, change: 0, destroy: 5, total: 5 });
  });

  it('parses "Apply complete! Resources: N added, M changed, K destroyed"', () => {
    const err = '';
    const out = 'Apply complete! Resources: 3 added, 1 changed, 0 destroyed.';
    const parsed = parsePlanAndApplyOutput(out, err);
    expect(parsed.changes).toEqual({ add: 3, change: 1, destroy: 0, total: 4 });
  });

  it('parses "Destroy complete! Resources: N destroyed"', () => {
    const out = 'Destroy complete! Resources: 4 destroyed.';
    const parsed = parsePlanAndApplyOutput(out, '');
    expect(parsed.changes).toEqual({ add: 0, change: 0, destroy: 4, total: 4 });
  });

  it('captures Error: lines when includeDiagnostics is true', () => {
    const stderr = 'Error: Invalid reference\n  on main.tf line 1\n';
    const parsed = parsePlanAndApplyOutput('', stderr, { includeDiagnostics: true });
    expect(parsed.errors).toEqual(['Invalid reference']);
  });

  it('returns undefined changes when no summary line is present', () => {
    const parsed = parsePlanAndApplyOutput('hello\n', '');
    expect(parsed.changes).toBeUndefined();
  });
});
