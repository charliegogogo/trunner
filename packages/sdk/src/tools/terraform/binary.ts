import { BaseBinaryManager, type BinaryManagerOptions } from '../base/base-binary-manager.js';
import { TerraformReleaseSource } from './release-source.js';

export class TerraformBinaryManager extends BaseBinaryManager {
  constructor(opts: Partial<BinaryManagerOptions> & { logger?: BinaryManagerOptions['logger'] } = {}) {
    super({
      toolId: 'terraform',
      binaryName: 'terraform',
      releaseSource: opts.releaseSource ?? new TerraformReleaseSource(),
      paths: opts.paths,
      logger: opts.logger,
      platform: opts.platform,
    });
  }
}
