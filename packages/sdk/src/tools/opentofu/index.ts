import { BaseTool } from '../base/base-tool.js';
import { OpenTofuBinaryManager } from './binary.js';
import { OpenTofuProviderManager } from './provider.js';
import { opentofuCommands } from './commands.js';
import type { Logger } from '../../utils/logger.js';

export interface OpenTofuToolOptions {
  binary?: OpenTofuBinaryManager;
  provider?: OpenTofuProviderManager;
  logger?: Logger;
}

export class OpenTofuTool extends BaseTool {
  constructor(opts: OpenTofuToolOptions = {}) {
    super({
      id: 'opentofu',
      displayName: 'OpenTofu',
      binary: opts.binary ?? new OpenTofuBinaryManager({ logger: opts.logger }),
      provider: opts.provider ?? new OpenTofuProviderManager({ logger: opts.logger }),
      commands: opentofuCommands,
      logger: opts.logger,
    });
  }
}
