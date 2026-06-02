import { describe, expect, it } from 'vitest';
import { terraformCommands } from '../../src/tools/terraform/commands.js';

describe('terraform/commands', () => {
  it('exposes the documented subcommands', () => {
    const names = terraformCommands.list().map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['init', 'plan', 'apply', 'destroy', 'validate', 'output', 'fmt']),
    );
  });

  it('apply and destroy are marked requiresConfirmation with autoApproveFlag', () => {
    const apply = terraformCommands.get('apply');
    const destroy = terraformCommands.get('destroy');
    expect(apply?.requiresConfirmation).toBe(true);
    expect(apply?.autoApproveFlag).toBe('-auto-approve');
    expect(destroy?.requiresConfirmation).toBe(true);
    expect(destroy?.autoApproveFlag).toBe('-auto-approve');
  });

  it('buildInvocation includes user-provided flags', () => {
    const inv = terraformCommands.buildInvocation('plan', { args: ['-out', 'tfplan'] });
    expect(inv).toEqual(['plan', '-out', 'tfplan']);
  });

  it('buildInvocation auto-injects -auto-approve when autoApprove=true', () => {
    const inv = terraformCommands.buildInvocation('apply', { autoApprove: true });
    expect(inv).toEqual(['apply', '-auto-approve']);
  });

  it('buildInvocation does not duplicate user-supplied -auto-approve', () => {
    const inv = terraformCommands.buildInvocation('apply', { args: ['-auto-approve'] });
    expect(inv.filter((a) => a === '-auto-approve')).toHaveLength(1);
  });

  it('buildInvocation appends extraArgs at the end', () => {
    const inv = terraformCommands.buildInvocation('init', { extraArgs: ['-no-color'] });
    expect(inv).toEqual(['init', '-no-color']);
  });

  it('buildInvocation throws on unknown commands', () => {
    expect(() => terraformCommands.buildInvocation('nope', {})).toThrow();
  });
});
