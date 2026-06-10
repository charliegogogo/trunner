import { describe, expect, it } from 'vitest';
import { ToolRegistry, registerBuiltinTools } from '../../src/registry/tool-registry.js';
import { TerraformTool } from '../../src/tools/terraform/index.js';
import { OpenTofuTool } from '../../src/tools/opentofu/index.js';

describe('registry/tool-registry', () => {
  it('createDefaultRegistry has terraform and opentofu registered', () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    expect(reg.has('terraform')).toBe(true);
    expect(reg.has('opentofu')).toBe(true);
    expect(reg.list()).toEqual(['terraform', 'opentofu']);
  });

  it('get() lazily instantiates a Tool', () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const t1 = reg.get('terraform');
    const t2 = reg.get('terraform');
    expect(t1).toBe(t2);
    expect(t1).toBeInstanceOf(TerraformTool);
  });

  it('get() lazily instantiates OpenTofuTool', () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const t1 = reg.get('opentofu');
    const t2 = reg.get('opentofu');
    expect(t1).toBe(t2);
    expect(t1).toBeInstanceOf(OpenTofuTool);
  });

  it('get() throws for unknown tool id', () => {
    const reg = new ToolRegistry();
    expect(() => reg.get('unknown' as never)).toThrow();
  });

  it('custom factory takes precedence over defaults', () => {
    const reg = new ToolRegistry();
    const fake: unknown = { id: 'terraform', displayName: 'fake' };
    reg.register('terraform', () => fake as never);
    expect(reg.get('terraform')).toBe(fake);
  });
});
