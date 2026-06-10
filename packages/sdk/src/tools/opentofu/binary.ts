import { BaseBinaryManager, type BinaryManagerOptions } from '../base/base-binary-manager.js';
import { OpenTofuReleaseSource } from './release-source.js';

export class OpenTofuBinaryManager extends BaseBinaryManager {
  constructor(opts: Partial<BinaryManagerOptions> & { logger?: BinaryManagerOptions['logger'] } = {}) {
    super({
      toolId: 'opentofu',
      binaryName: 'tofu',
      releaseSource: opts.releaseSource ?? new OpenTofuReleaseSource(),
      paths: opts.paths,
      logger: opts.logger,
      platform: opts.platform,
    });
  }
}
