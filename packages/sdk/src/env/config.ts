import type { ToolId } from '../types/tool.js';
import { getPaths, type TrunnerPaths } from './paths.js';
import { readJsonFile, writeJsonFile } from '../utils/fs.js';

export interface ToolPin {
  version: string;
  installedAt: string;
  source: 'official' | 'mirror' | 'local';
  mirrorUrl?: string;
}

export interface TrunnerConfig {
  version: 1;
  activeTool: ToolId | null;
  tools: Partial<Record<ToolId, ToolPin>>;
  mirror: {
    binaries?: string;
    providers?: string;
  };
  telemetry: boolean;
}

const DEFAULT_CONFIG: TrunnerConfig = {
  version: 1,
  activeTool: null,
  tools: {},
  mirror: {},
  telemetry: false,
};

export class ConfigStore {
  constructor(private readonly paths: TrunnerPaths = getPaths()) {}

  async load(): Promise<TrunnerConfig> {
    const data = await readJsonFile<TrunnerConfig>(this.paths.configFile);
    if (!data) return { ...DEFAULT_CONFIG };
    return this.migrate(data);
  }

  async save(cfg: TrunnerConfig): Promise<void> {
    await writeJsonFile(this.paths.configFile, cfg);
  }

  async update(mut: (cfg: TrunnerConfig) => TrunnerConfig): Promise<TrunnerConfig> {
    const cur = await this.load();
    const next = mut(cur);
    await this.save(next);
    return next;
  }

  async setActiveTool(id: ToolId): Promise<TrunnerConfig> {
    return this.update((c) => ({ ...c, activeTool: id }));
  }

  async pinTool(id: ToolId, pin: ToolPin): Promise<TrunnerConfig> {
    return this.update((c) => ({ ...c, tools: { ...c.tools, [id]: pin } }));
  }

  async setBinaryMirror(url: string | undefined): Promise<TrunnerConfig> {
    return this.update((c) => ({ ...c, mirror: { ...c.mirror, binaries: url } }));
  }

  async setProviderMirror(url: string | undefined): Promise<TrunnerConfig> {
    return this.update((c) => ({ ...c, mirror: { ...c.mirror, providers: url } }));
  }

  private migrate(data: TrunnerConfig): TrunnerConfig {
    // Single version so far; merge with defaults to fill any missing keys.
    return {
      ...DEFAULT_CONFIG,
      ...data,
      tools: data.tools ?? {},
      mirror: data.mirror ?? {},
    };
  }
}
