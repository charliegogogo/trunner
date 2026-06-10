// Public API
export { createRunner } from './runner/executor.js';
export type { RunSpec, RunOptions, CreateRunnerOptions, RunnerHandle } from './runner/executor.js';

export { RunnerStream } from './runner/stream.js';
export type { Runner } from './runner/stream.js';

export { parsePlanAndApplyOutput } from './runner/parser.js';
export type { ParseOptions } from './runner/parser.js';

export { ToolRegistry, getDefaultRegistry, createDefaultRegistry, registerBuiltinTools } from './registry/tool-registry.js';
export type { ToolFactory } from './registry/tool-registry.js';

export { TerraformTool } from './tools/terraform/index.js';
export { TerraformBinaryManager } from './tools/terraform/binary.js';
export { TerraformProviderManager, TerraformProviderSource, parseLockFileString, parseRequiredProvidersString } from './tools/terraform/provider.js';
export { TerraformReleaseSource } from './tools/terraform/release-source.js';
export { terraformCommands } from './tools/terraform/commands.js';

export { OpenTofuTool } from './tools/opentofu/index.js';
export { OpenTofuBinaryManager } from './tools/opentofu/binary.js';
export { OpenTofuProviderManager, OpenTofuProviderSource } from './tools/opentofu/provider.js';
export { OpenTofuReleaseSource } from './tools/opentofu/release-source.js';
export { opentofuCommands } from './tools/opentofu/commands.js';

export { BaseTool } from './tools/base/base-tool.js';
export { BaseBinaryManager } from './tools/base/base-binary-manager.js';
export { BaseProviderManager } from './tools/base/base-provider-manager.js';
export type { ReleaseEntry, ReleaseSource } from './tools/base/base-binary-manager.js';
export type { ProviderSource } from './tools/base/base-provider-manager.js';

export { ConfigStore } from './env/config.js';
export type { TrunnerConfig, ToolPin } from './env/config.js';
export { getPaths, ensurePaths, pathExists } from './env/paths.js';
export type { TrunnerPaths } from './env/paths.js';

export { ConsoleLogger, NoopLogger } from './utils/logger.js';
export type { Logger, LogEntry, LogLevel, LogSink } from './utils/logger.js';
export { getPlatformInfo, detectPlatformString, binaryNameFor, archiveNameFor, trunnerHome } from './utils/os.js';
export type { PlatformInfo, SupportedPlatform, SupportedArch } from './utils/os.js';
export { ensureDir, exists, isExecutable, removeIfExists, readJsonFile, writeJsonFile, writeFileAtomic } from './utils/fs.js';

export { sha256OfFile, sha256OfBuffer, verifySha256, verifySha256Buffer } from './installer/checksum.js';
export { extractArchive, extractTarGzStream, streamToFile, gunzipToFile } from './installer/extractor.js';
export type { ExtractResult, ExtractOptions } from './installer/extractor.js';
export { download, fetchBuffer } from './installer/downloader.js';
export type { DownloadOptions, DownloadResult } from './installer/downloader.js';

export { parseRc, rcPathFor, RcParseError, TRUNNERRC_FILENAME } from './workspace/trunner-rc.js';
export type { TrunnerRc, ParseRcWarning, ParseRcResult } from './workspace/trunner-rc.js';

export { discoverWorkspaces, ALWAYS_EXCLUDE } from './workspace/discover.js';
export type { Workspace, DiscoverOptions } from './workspace/discover.js';

export { runWorkspaces } from './workspace/runner.js';
export type { WorkspaceEvent, RunSummary, RunWorkspacesOptions } from './workspace/runner.js';

export type {
  Tool,
  ToolId,
  VersionInfo,
  ArgSpec,
  EnvSpec,
  CommandName,
  CommandSpec,
  CommandRegistry,
  CommandOptions,
  CommandResult,
  ParsedSummary,
  ChangeCounts,
  ResultStatus,
  ProgressInfo,
  PromptRequest,
  PromptAnswer,
  RunnerEventMap,
  ProviderRef,
  ProviderLockEntry,
  ParsedLockFile,
  ParsedRequiredProviders,
  ResolvedProvider,
} from './types/index.js';
