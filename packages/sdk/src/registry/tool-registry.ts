import type { Tool, ToolId } from '../types/tool.js';
import { TerraformTool } from '../tools/terraform/index.js';
import { OpenTofuTool } from '../tools/opentofu/index.js';

export type ToolFactory = () => Tool;

export class ToolRegistry {
  private readonly factories = new Map<ToolId, ToolFactory>();
  private readonly instances = new Map<ToolId, Tool>();

  register(id: ToolId, factory: ToolFactory): void {
    this.factories.set(id, factory);
  }

  has(id: ToolId): boolean {
    return this.factories.has(id);
  }

  list(): ToolId[] {
    return [...this.factories.keys()];
  }

  get(id: ToolId): Tool {
    const inst = this.instances.get(id);
    if (inst) return inst;
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Tool not registered: ${id}`);
    const created = factory();
    this.instances.set(id, created);
    return created;
  }

  /** Forget cached instances (e.g. after config changes). */
  reset(): void {
    this.instances.clear();
  }
}

let defaultRegistry: ToolRegistry | null = null;

export function getDefaultRegistry(): ToolRegistry {
  if (!defaultRegistry) defaultRegistry = createDefaultRegistry();
  return defaultRegistry;
}

export function createDefaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  registerBuiltinTools(reg);
  return reg;
}

export function registerBuiltinTools(reg: ToolRegistry): void {
  reg.register('terraform', () => new TerraformTool());
  reg.register('opentofu', () => new OpenTofuTool());
}
