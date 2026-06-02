import { describe, expect, it } from 'vitest';
import { ToolRegistry, registerBuiltinTools } from '../../src/registry/tool-registry.js';
import { TerraformTool } from '../../src/tools/terraform/index.js';

describe('registry/tool-registry', () => {
  it('createDefaultRegistry has terraform registered', () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    expect(reg.has('terraform')).toBe(true);
    expect(reg.has('opentofu')).toBe(false);
    expect(reg.list()).toEqual(['terraform']);
  });

  it('get() lazily instantiates a Tool', () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const t1 = reg.get('terraform');
    const t2 = reg.get('terraform');
    expect(t1).toBe(t2);
    expect(t1).toBeInstanceOf(TerraformTool);
  });

  it('get() throws for unknown tool id', () => {
    const reg = new ToolRegistry();
    expect(() => reg.get('opentofu')).toThrow();
  });

  it('custom factory takes precedence over defaults', () => {
    const reg = new ToolRegistry();
    const fake: unknown = { id: 'terraform', displayName: 'fake' };
    reg.register('terraform', () => fake as never);
    expect(reg.get('terraform')).toBe(fake);
  });
});
