import type { Tool, VersionInfo, ToolId } from '../../types/tool.js';
import type { CommandRegistry } from '../../types/command.js';
import type { BaseBinaryManager } from './base-binary-manager.js';
import type { BaseProviderManager } from './base-provider-manager.js';
import { ConsoleLogger, type Logger } from '../../utils/logger.js';

export interface BaseToolOptions {
  id: ToolId;
  displayName: string;
  binary: BaseBinaryManager;
  provider: BaseProviderManager;
  commands: CommandRegistry;
  logger?: Logger;
}

export abstract class BaseTool implements Tool {
  readonly id: ToolId;
  readonly displayName: string;
  readonly binary: BaseBinaryManager;
  readonly provider: BaseProviderManager;
  readonly commands: CommandRegistry;
  protected readonly logger: Logger;

  constructor(opts: BaseToolOptions) {
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.binary = opts.binary;
    this.provider = opts.provider;
    this.commands = opts.commands;
    this.logger = opts.logger ?? new ConsoleLogger({ level: 'info' });
  }

  async detectInstalled(): Promise<VersionInfo | null> {
    // Default implementation: try to detect via the system's PATH.
    // Subclasses can override with a pinned-version lookup.
    return null;
  }
}
