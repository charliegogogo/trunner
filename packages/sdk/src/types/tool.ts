import type { BaseBinaryManager } from '../tools/base/base-binary-manager.js';
import type { BaseProviderManager } from '../tools/base/base-provider-manager.js';
import type { CommandRegistry } from './command.js';

export type ToolId = 'terraform' | 'opentofu';

export interface VersionInfo {
  version: string;
  raw: string;
  source: 'detected' | 'pinned' | 'installed';
}

export interface Tool {
  readonly id: ToolId;
  readonly displayName: string;
  readonly binary: BaseBinaryManager;
  readonly provider: BaseProviderManager;
  readonly commands: CommandRegistry;
  detectInstalled(): Promise<VersionInfo | null>;
}
