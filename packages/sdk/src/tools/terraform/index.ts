import { BaseTool } from '../base/base-tool.js';
import { TerraformBinaryManager } from './binary.js';
import { TerraformProviderManager } from './provider.js';
import { terraformCommands } from './commands.js';
import type { Logger } from '../../utils/logger.js';

export interface TerraformToolOptions {
  binary?: TerraformBinaryManager;
  provider?: TerraformProviderManager;
  logger?: Logger;
}

export class TerraformTool extends BaseTool {
  constructor(opts: TerraformToolOptions = {}) {
    super({
      id: 'terraform',
      displayName: 'Terraform',
      binary: opts.binary ?? new TerraformBinaryManager({ logger: opts.logger }),
      provider: opts.provider ?? new TerraformProviderManager({ logger: opts.logger }),
      commands: terraformCommands,
      logger: opts.logger,
    });
  }
}
