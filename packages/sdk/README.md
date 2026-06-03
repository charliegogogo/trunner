# @trunner/sdk

Core SDK for **trunner** — a cross-platform tool for running OpenTofu, Terraform, and Terragrunt.

This package provides:

- A **`Tool` abstraction** so new IaC tools (Terraform, OpenTofu, Terragrunt) can be plugged in without changing the CLI/Desktop surfaces.
- A **binary manager** that downloads, verifies (SHA-256), and caches tool binaries in `~/.trunner/binaries/<tool>/<tool>-<version>[.exe]`.
- A **provider manager** that resolves providers from the public Terraform Registry and writes them to the local plugin cache mirror.
- An **EventEmitter-based runner** (`stdout` / `stderr` / `progress` / `prompt` / `exit`) that spawns tool processes, streams their output, detects interactive apply/destroy prompts, parses change counts, and supports cancellation via `AbortSignal`.
- A **tool registry** so callers can look up tools by id.
- HCL parsing adapters built on top of [`@cdktf/hcl2json`](https://www.npmjs.com/package/@cdktf/hcl2json).

POC scope is **Terraform only**. OpenTofu and Terragrunt ship as placeholders ready to be implemented in later phases.

## Install

This package is part of the [`trunner`](https://github.com/) monorepo and is consumed via the workspace. It is published as `@trunner/sdk` once the CLI/Desktop packages are also in place.

```sh
pnpm install
pnpm -F @trunner/sdk build
```

## Quick start

```ts
import {
  TerraformTool,
  createRunner,
  ConsoleLogger,
  getPaths,
  ensurePaths,
} from '@trunner/sdk';

const paths = getPaths();
await ensurePaths(paths);

const tool = new TerraformTool({ logger: new ConsoleLogger({ level: 'info' }) });

// 1) Download and install Terraform 1.6.6 (cached on subsequent calls)
const binary = await tool.binary.ensureInstalled({ version: '1.6.6' });

// 2) Create a runner and start a `plan`
const runner = createRunner({ paths, logger: new ConsoleLogger() });
runner.on('stdout', (chunk) => process.stdout.write(chunk));
runner.on('stderr', (chunk) => process.stderr.write(chunk));
runner.on('prompt', (req, answer) => {
  // Interactive prompts surface here; the upper layer (CLI/Desktop) answers.
  answer('no');
});

const result = await runner.run({
  binaryPath: binary,
  args: tool.commands.buildInvocation('plan', { args: ['-out=tfplan'] }),
  cwd: '/path/to/terraform/project',
});

console.log('exit code:', result.exitCode);
console.log('changes:', result.parsed?.changes);
```

## Layout

```
~/.trunner/
├── binaries/<tool>/<tool>-<version>[.exe]   # installed binaries
├── cache/<tool>/                            # extraction scratch
├── downloads/<tool>/                        # raw archives
├── providers/<tool>/plugins/...             # plugin mirror
└── config/config.json                       # active tool, pinned versions, mirrors
```

## Commands registry

The `TerraformTool` ships with declarative metadata for `init`, `plan`, `apply`, `destroy`, `validate`, `output`, and `fmt`. `apply` and `destroy` are marked `requiresConfirmation` and auto-inject `-auto-approve` when the caller passes `autoApprove: true` to `buildInvocation()`.

## Tests

```sh
pnpm -F @trunner/sdk test          # full suite (unit + integration)
pnpm -F @trunner/sdk test:unit     # unit only
pnpm -F @trunner/sdk test:integration
```

The integration test downloads a real Terraform binary (set `TRUNNER_TERRAFORM_VERSION` to pin the version, or `TRUNNER_TERRAFORM_BIN=/path/to/terraform` to reuse a binary already on disk) and runs a full `init / plan / apply / destroy` cycle against a minimal `null_resource` fixture.

## Notes on archive extraction

Both formats are handled fully in-process — no system binaries required:

- `.tar.gz` is extracted by the [`tar`](https://www.npmjs.com/package/tar) package.
- `.zip` is extracted by [`adm-zip`](https://www.npmjs.com/package/adm-zip), a pure-JS implementation that reads the zip headers and writes entries through `fs.writeFile`. POSIX permission bits are reapplied from the zip's external file attributes (`entry.attr >> 16`); any extracted file whose path matches the `binaryMarker` is force-set to `0o755` so it is executable.
