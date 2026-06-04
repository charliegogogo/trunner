# AGENTS.md

Repo-specific guidance for AI agents working in `trunner`. Skim this before touching anything.

## What this repo is

pnpm + TypeScript monorepo. POC scope is **Terraform only** — OpenTofu is a placeholder for a later phase; **Terragrunt is explicitly cut from POC scope** (see PLAN.md §1). The `master plan` is in [`PLAN.md`](./PLAN.md); the full phase breakdown (Phases 1 → 3B) is in §7 of that file.

**Status**: Phase 1 ✅, Phase 2A ✅ (CLI TUI shell + Node SEA pipeline), Phase 2A.5 + 2B in design (single-verb surface + `.trunnerrc` + multi-workspace parallel execution + smart version selection in the SDK). `@trunner/sdk` 53/53 unit + 1/1 integration; `@trunner/cli` 14/14. `packages/desktop` is not created yet.

**CLI shape**: single-verb, tool-as-config — `trunner plan`, not `trunner terraform plan`. Tool is set by `.trunnerrc` (per-workspace TOML) or `-t` on the command line. `trunner <command>` discovers all `.trunnerrc` workspaces under cwd and runs the command against each in parallel, with a Claude-Code-style status bar. See PLAN.md §4.8 / §4.9 / §5.1 and gotchas 16–19.

## Layout

```
trunner/
├── pnpm-workspace.yaml          # packages/* only — no nested globs
├── tsconfig.base.json           # strict + noUncheckedIndexedAccess + noImplicitOverride
├── package.json                 # recursive root scripts (pnpm -r …)
├── .nvmrc                       # 26.1.0 (exact)
├── PLAN.md
├── README.md
└── packages/
    ├── sdk/                     # Phase 1 done; Phase 2A.5 + 2B live here
    │   ├── src/
    │   │   ├── index.ts         # PUBLIC API BARREL — re-exports everything
    │   │   ├── types/           # Tool, CommandSpec, RunnerEventMap, ResolvedManifest, …
    │   │   ├── utils/           # logger, fs, os
    │   │   ├── env/             # ~/.trunner paths + persistent TrunnerConfig
    │   │   ├── installer/       # checksum, downloader, extractor (tar+adm-zip),
    │   │   │                    # version-solver, constraint-set, hcl-walker,
    │   │   │                    # provider-registry (Phase 2B)
    │   │   ├── workspace/       # Phase 2A.5: trunner-rc (TOML schema), discover,
    │   │   │                    # runner (parallel + stream multiplexing)
    │   │   ├── tools/
    │   │   │   ├── base/        # BaseTool (with resolveAll), BaseBinaryManager
    │   │   │   │                # (with resolveVersion/listInstalled), BaseProviderManager
    │   │   │   ├── terraform/   # concrete impl (release-source, binary, provider, commands)
    │   │   │   └── opentofu/    # placeholder
    │   │   ├── runner/          # RunnerStream (EventEmitter), executor, parser
    │   │   └── registry/        # ToolRegistry
    │   ├── test/
    │   │   ├── unit/            # 12 files, 53 tests (will grow to ~67 with 2A.5 + 2B)
    │   │   └── integration/     # full init/plan/apply/destroy cycle (Phase 1)
    │   │                        # + smart-resolve.test.ts (Phase 2B)
    │   ├── tsup.config.ts       # ESM + CJS + dts, target node26
    │   ├── vitest.config.ts     # pool: 'forks', 60s timeouts
    │   └── tsconfig.json        # extends ../../tsconfig.base.json
    └── cli/                     # Phase 2A done; 2A.5 rewrites the surface
        ├── src/
        │   ├── trunner.tsx      # entry (single-verb parsing, global flags)
        │   ├── app.tsx          # discover + runWorkspaces + StatusBar
        │   ├── ui/              # StatusBar, WorkspacePane, Spinner, ProgressBar,
        │   │                    # Confirm, OutputView
        │   ├── hooks/           # useWorkspaces (multi-stream), useRunner (single)
        │   └── commands/        # tools, providers (Phase 2A.5 keeps the layout)
        ├── scripts/
        │   ├── build-sea.sh     # macOS/Linux
        │   └── build-sea.ps1    # Windows
        ├── sea-config.json      # mainFormat:"module", useCodeCache:true
        ├── tsup.config.ts       # ESM, noExternal, inlineHcl2jsonWasm plugin
        ├── test/                # ink-testing-library component tests (14 tests)
        └── tsconfig.json
```

## Required toolchain

| Tool | Version | Notes |
| --- | --- | --- |
| Node | **26.1.0** exact | `.nvmrc` and `engines.node`. Use `nvm use` before anything else. |
| pnpm | `pnpm@11.5.0` (enforced via `packageManager`) | Don't swap to npm/yarn. |
| TypeScript | `^6.0.3` | Strict, `noUncheckedIndexedAccess`, `noImplicitOverride`. Note: TS 6 deprecates `moduleResolution: bundler` when `module: preserve` is implied — keep `module: ESNext` + `moduleResolution: Bundler` explicit until that lands. TS 6 also hard-errors (`TS5101`) on `baseUrl` deprecation — `packages/sdk/tsconfig.json` carries `ignoreDeprecations: "6.0"` to silence it for now; remove once the tsconfig migrates. |

## Command cheatsheet

```sh
nvm use                                 # pick up .nvmrc → 26.1.0
pnpm install                            # one-time / after lockfile change
pnpm rebuild esbuild                    # see gotcha below
pnpm typecheck                          # pnpm -r typecheck → tsc --noEmit everywhere
pnpm build                              # pnpm -r build → tsup for the SDK
pnpm test                               # pnpm -r test → unit + integration
pnpm test:unit                          # recursive
pnpm test:integration                   # recursive, downloads a real Terraform binary
```

Per-package:

```sh
pnpm -F @trunner/sdk typecheck
pnpm -F @trunner/sdk build
pnpm -F @trunner/sdk exec vitest run               # full suite — preferred form
pnpm -F @trunner/sdk exec vitest run --dir test/unit   # NOTE: this filter is unreliable, see below
pnpm -F @trunner/cli typecheck
pnpm -F @trunner/cli build
pnpm -F @trunner/cli build:sea:macos               # produce dist/trunner (~139 MB single-file binary)
pnpm -F @trunner/cli exec vitest run               # 14 unit tests
```

## Gotchas (will cost you time if you don't know)

### 1. `pnpm install` skips `esbuild` post-install

`pnpm install` prints `Ignored build scripts: esbuild`. `tsup` cannot bundle without it. After every fresh install run:

```sh
pnpm rebuild esbuild
```

If `pnpm build` fails with a missing `esbuild` binary, this is why.

### 2. `vitest --dir` filter is unreliable from inside the SDK

In `vitest.config.ts` the include pattern is `test/**/*.test.ts`. Calling `vitest run --dir test/unit` from `packages/sdk` may exit with `No test files found` because the `--dir` argument is not applied to the `include` glob. **Use the unfiltered form instead:**

```sh
pnpm -F @trunner/sdk exec vitest run   # runs every test/unit/*.test.ts AND test/integration/*.test.ts
```

To run a single test file by name:

```sh
pnpm -F @trunner/sdk exec vitest run test/unit/extractor.test.ts
```

### 3. Integration test env vars

`packages/sdk/test/integration/terraform-cycle.test.ts` reads:

| Var | Default | Effect |
| --- | --- | --- |
| `TRUNNER_SKIP_INTEGRATION` | unset | `=1` → skip the test entirely |
| `TRUNNER_TERRAFORM_VERSION` | `1.6.6` | version to download |
| `TRUNNER_TERRAFORM_BIN` | unset | if set, reuse this binary and skip the download |

The test takes ~3s warm and downloads an ~88MB zip on first run. It writes to `~/.trunner/{binaries,downloads,cache,providers}` — outside the repo, so it does not pollute the working tree.

### 4. TypeScript strict-mode footguns

Two flags are on that bite often:

- `noUncheckedIndexedAccess` — `arr[i]` and `obj[key]` are `T | undefined`. You must guard before use. See e.g. `runner/parser.ts` for the pattern.
- `noImplicitOverride` — every `EventEmitter` override in `RunnerStream` (`on`, `off`, `once`, `removeListener`, `addListener`, `emit`) needs the `override` keyword. Same applies to any future class that extends `EventEmitter` or another base class.

### 5. `@cdktf/hcl2json` is pinned to `^0.21.0`

In `packages/sdk/package.json` it is `^0.21.0` (released May 2025; caret range allows 0.21.x patches without lockfile churn). The actual API surface to use is `parse(filename, contents): Record<string, unknown>` (NOT `parseToObject`). Output is `{ "<block>": [{ … }] }`; the SDK normalises this via an `unwrapRoot` helper in `tools/terraform/provider.ts`.

### 6. Zip extraction is in-process

`installer/extractor.ts` uses the pure-JS `adm-zip` package for `.zip` and the `tar` package for `.tar.gz`. **No system binaries required** — earlier versions shell'd out to `unzip`; that path is gone. If a new contributor suggests shelling out to `unzip`, push back.

### 7. Public API surface = `src/index.ts`

Everything the SDK exports comes from `packages/sdk/src/index.ts`. New types and helpers go **inside** an appropriate `src/<area>/` file and get re-exported there. Do not import from `src/installer/checksum.ts` etc. directly from outside the package.

### 8. No CI yet

`.github/workflows/` does not exist, even though `PLAN.md` §9 mentions a CI matrix. If you're asked to add CI, build it from scratch (macos-latest + ubuntu-latest + windows-latest, all pinned to Node 26.1.0).

### 9. Node SEA requires `mainFormat: "module"` for ESM bundles

The CLI ships an ESM bundle (Ink 7 + yoga-layout use TLA — won't bundle to CJS). When packaging it as a Node single-executable application (`packages/cli/sea-config.json` + `scripts/build-sea.sh`), the SEA's main script is loaded as CJS by default and will throw `SyntaxError: Cannot use import statement outside a module`. Fix: set `"mainFormat": "module"` in `sea-config.json`. **This is incompatible with `"useSnapshot": true`** — use `useCodeCache: true` instead. Use `node --build-sea sea-config.json` (Node 25.5+) for the one-step build — no `postject` needed. See `packages/cli/scripts/build-sea.sh` for the macOS/Linux pipeline; the `.ps1` script covers Windows.

### 10. Top-level `await` in CLI entry crashes SEA at startup

`trunner.tsx` (the CLI entry) must not use `await` at the top level. Wrap any `await` in an `async function main()` and call `main().catch(...)`. esbuild will reject TLA in CJS output, and SEA's CJS loader will also choke. The `main()` wrapper is the correct pattern.

### 11. CLI `--version` is for trunner, `--tool-version` is for terraform

The CLI uses two distinct version flags to avoid clashing with the conventional `--version`:

| Flag | Meaning |
| --- | --- |
| `trunner --version` | prints trunner's own version. Reserved. |
| `trunner plan --tool-version 1.6.6` | pins the tool binary to `1.6.6` for every discovered workspace, bypasses the smart-resolver's `required_version` solve. |
| `trunner plan --include-prerelease` | allow pre-release candidates (`1.0.0-rc1`) in the solver. |
| `trunner plan --mirror <url>` | override the default terraform + provider mirror. |

If you add a new tool flag that looks like a version, **do not use `--version`** — add a new flag with `--tool-` prefix or similar.

### 12. `BaseBinaryManager.binaryPath(version)` rejects `'latest'`

`binaryPath('1.6.6')` → `~/.trunner/binaries/terraform/terraform-1.6.6`. `binaryPath('latest')` is **not** a symlink resolver — it produces a literal filename `terraform-latest` which doesn't exist on disk. Callers must resolve `'latest'` (or any non-semver ref) to a concrete version first via `binary.resolveVersion('latest') → "1.6.6"`, then pass the resolved string. `binaryPath` throws on `'latest'` with a clear error message.

### 13. Provider mirror path layout is strict (Phase 2B)

Provider files are written to `~/.trunner/providers/<namespace>/<type>/terraform-provider-<ns>-<type>_<v>_<os>_<arch>` — **exact match** to terraform's `.terraform/providers/` layout, because the [filesystem_mirror](https://developer.hashicorp.com/terraform/internals/remote-service-discovery#filesystem_mirror) lookup uses strict path conventions. If the path is misaligned, `terraform init` fails to find the provider. Layout is covered by a unit test that compares against a known-good `terraform init` output. The CLI generates `~/.trunner/.terraformrc` with the `provider_installation.filesystem_mirror` block and exports `TF_CLI_CONFIG_FILE` to spawned terraform.

### 14. Remote Service Discovery Protocol is mandatory (Phase 2B)

Smart resolve always `GET`s `https://registry.terraform.io/.well-known/terraform.json` first; the response contains the `providers.v1` / `modules.v1` URLs and trunner uses those (not hardcoded ones). This is required by [the spec](https://developer.hashicorp.com/terraform/internals/remote-service-discovery) and is what makes TFE / private registries work. Do not hardcode `https://registry.terraform.io/v1/providers/...` — read the well-known endpoint and use the returned base. Unit tests mock `globalThis.fetch`; integration tests use the real endpoint.

### 15. Lock file is ground truth (Phase 2B)

`.terraform.lock.hcl` pins a provider → the solver is **skipped** for that provider; the locked version is used verbatim. trunner never mutates the lock file (the user runs `terraform init -upgrade` for that). Lock file is read once per `resolveAll` call. If a provider is in the HCL `required_providers` but **not** in the lock file, the solver runs normally.

### 16. CLI surface is single-verb — there is no `<tool>` positional (Phase 2A.5)

`trunner plan`, not `trunner terraform plan`. The tool is selected by the workspace's `.trunnerrc` `tool` field, or overridden with `-t <tool>` for one invocation. Running `trunner plan` with no `.trunnerrc` under cwd and no `-t` errors with `no .trunnerrc found under <cwd>; cd to a project root, create a .trunnerrc, or pass --cwd <path> and -t <tool>`. The Phase 2A shape (`trunner <tool> <command>`) is gone. See PLAN.md §5.1.

### 17. `.trunnerrc` lookup is scan-down only, not scan-up (Phase 2A.5)

`trunner` recursively scans the **descendants** of cwd for `.trunnerrc`, stopping at the first one it finds in any subtree (a "project boundary"). It does **not** scan upward to find a parent `.trunnerrc`. If you `cd` into a subdirectory that has no `.trunnerrc` underneath it, trunner errors — `cd` to a project root or pass `--cwd <path>`. The scan always skips `.git` and `.terraform`; additional excludes (`.trunnerrc` `exclude` field or CLI `--exclude`) layer on top. Symlinks are not followed. See PLAN.md §4.8.

### 18. Multi-workspace runs are concurrent, not pipelined (Phase 2A.5)

When N workspaces are discovered, trunner runs the user's command against each in parallel up to a worker-pool cap of `os.cpus().length` (overridable via `.trunnerrc` `concurrency` or CLI `--concurrency`). Output streams are multiplexed through a single `AsyncIterable<WorkspaceEvent>`; the CLI's `useWorkspaces` hook routes each event to the right workspace's slot in the `StatusBar`. A failed workspace does **not** abort the others — all run to completion, the final summary lists per-workspace exit codes, and the overall process exit code is `0` iff all succeeded. See PLAN.md §4.9.

### 19. `trunner tools` and `trunner providers` are the management commands (Phase 2A.5)

The old `trunner tool list` and `trunner provider list` shapes are renamed to **plural** to free the singular nouns for use as workspace `tool` values. `trunner tools install terraform 1.6.6`, `trunner providers list`, `trunner providers install hashicorp/aws`. The single-verb form `trunner plan` never collides with these because of the strict noun-verb separation. See PLAN.md §5.1.

## Test command order for a clean PR

```sh
pnpm install && pnpm rebuild esbuild \
  && pnpm -r typecheck \
  && pnpm -F @trunner/sdk build \
  && pnpm -F @trunner/cli build \
  && pnpm -r test
```

Typecheck must be clean; both packages must build; the full vitest run (53 SDK unit + 1 SDK integration + 14 CLI tests) must pass. After Phase 2A.5 + 2B land, the SDK unit count will be ~67 (workspace discovery + runner + solver + walker + registry) and SDK integration will be 2/2 (smart-resolve on a 3-workspace fixture). Add `pnpm -F @trunner/cli build:sea:macos` to verify the SEA pipeline locally before pushing.

## Adding a new `Tool` (OpenTofu / …)

Terragrunt is out of POC scope; the only realistic next Tool is OpenTofu.

1. Create `packages/sdk/src/tools/<name>/` with at minimum `index.ts` exporting a class that extends `BaseTool`.
2. Implement `binary` (subclass `BaseBinaryManager`) and `provider` (subclass `BaseProviderManager`).
3. Implement `resolveAll(req)` on the tool — orchestrates `binary.resolveVersion`, `provider.resolveVersion`, `provider.ensureInstalled` (see PLAN.md §4.5). Most of the logic is in the SDK base classes; OpenTofu reuses the same registry client and HCL walker.
4. Add a `commands` registry (or compose a sibling Tool's commands).
5. Register in `packages/sdk/src/registry/tool-registry.ts` — one line: `registry.register('<name>', () => new YourTool())`.
6. Re-export from `packages/sdk/src/index.ts`.
7. CLI/Desktop surfaces need **no changes** — they look up tools via the registry.

See `packages/sdk/src/tools/terraform/` for the reference implementation.

## Adding a new `.trunnerrc` field (Phase 2A.5)

Schema lives in `packages/sdk/src/workspace/trunner-rc.ts` as a `zod`-style validator (hand-rolled, no runtime zod dep) plus a `parseRc(path)` that uses `smol-toml` to read the file. To add a field:

1. Add the field to the `TrunnerRc` interface and the parse function's allow-list in `trunner-rc.ts`.
2. If the field affects scanning (like `exclude`): thread it into `workspace/discover.ts` via the discovered `Workspace.config`.
3. If the field affects execution (like `concurrency`): thread it into `workspace/runner.ts`'s `runWorkspaces` options.
4. Add a unit test for both happy path and an invalid value (e.g. `concurrency = -1`).
5. If the field is mirrored in a CLI flag, add it to the meow config in `trunner.tsx` and document it in PLAN.md §5.1.

## References

- [`PLAN.md`](./PLAN.md) — full implementation plan, risks, milestones
- [`README.md`](./README.md) — onboarding commands, dev/test/build cheatsheet
- [`packages/sdk/README.md`](./packages/sdk/README.md) — SDK API usage examples
