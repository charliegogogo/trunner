# AGENTS.md

Repo-specific guidance for AI agents working in `trunner`. Skim this before touching anything.

## What this repo is

pnpm + TypeScript monorepo. POC scope is **Terraform only** — OpenTofu and Terragrunt are placeholders for a later phase. The `master plan` is in [`plan.md`](./plan.md); the full phase breakdown (Phases 1 → 5) is in §7 of that file.

Currently only `@trunner/sdk` is implemented (Phase 1 ✅, 54/54 tests pass). `packages/cli` and `packages/desktop` are not created yet.

## Layout

```
trunner/
├── pnpm-workspace.yaml          # packages/* only — no nested globs
├── tsconfig.base.json           # strict + noUncheckedIndexedAccess + noImplicitOverride
├── package.json                 # recursive root scripts (pnpm -r …)
├── .nvmrc                       # 26.1.0 (exact)
├── plan.md
├── README.md
└── packages/
    └── sdk/                     # the only workspace package so far
        ├── src/
        │   ├── index.ts         # PUBLIC API BARREL — re-exports everything
        │   ├── types/           # Tool, CommandSpec, RunnerEventMap, …
        │   ├── utils/           # logger, fs, os
        │   ├── env/             # ~/.trunner paths + persistent TrunnerConfig
        │   ├── installer/       # checksum, downloader, extractor (tar+adm-zip)
        │   ├── tools/
        │   │   ├── base/        # BaseTool, BaseBinaryManager, BaseProviderManager
        │   │   ├── terraform/   # concrete impl (release-source, binary, provider, commands)
        │   │   ├── opentofu/    # placeholder
        │   │   └── terragrunt/  # placeholder
        │   ├── runner/          # RunnerStream (EventEmitter), executor, parser
        │   └── registry/        # ToolRegistry
        ├── test/
        │   ├── unit/            # 12 files, 53 tests
        │   └── integration/     # 1 file: full init/plan/apply/destroy cycle
        ├── tsup.config.ts       # ESM + CJS + dts, target node26
        ├── vitest.config.ts     # pool: 'forks', 60s timeouts
        └── tsconfig.json        # extends ../../tsconfig.base.json
```

## Required toolchain

| Tool | Version | Notes |
| --- | --- | --- |
| Node | **26.1.0** exact | `.nvmrc` and `engines.node`. Use `nvm use` before anything else. |
| pnpm | `pnpm@11.5.0` (enforced via `packageManager`) | Don't swap to npm/yarn. |
| TypeScript | 5.6.3 | Strict, `noUncheckedIndexedAccess`, `noImplicitOverride`. |

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

Per-package (only `@trunner/sdk` exists today):

```sh
pnpm -F @trunner/sdk typecheck
pnpm -F @trunner/sdk build
pnpm -F @trunner/sdk exec vitest run               # full suite — preferred form
pnpm -F @trunner/sdk exec vitest run --dir test/unit   # NOTE: this filter is unreliable, see below
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

### 5. `@cdktf/hcl2json` is pinned to `latest`

In `packages/sdk/package.json` it is `^"latest"` — intentional for the POC but it will churn the lockfile. The actual API surface to use is `parse(filename, contents): Record<string, unknown>` (NOT `parseToObject`). Output is `{ "<block>": [{ … }] }`; the SDK normalises this via an `unwrapRoot` helper in `tools/terraform/provider.ts`.

### 6. Zip extraction is in-process

`installer/extractor.ts` uses the pure-JS `adm-zip` package for `.zip` and the `tar` package for `.tar.gz`. **No system binaries required** — earlier versions shell'd out to `unzip`; that path is gone. If a new contributor suggests shelling out to `unzip`, push back.

### 7. Public API surface = `src/index.ts`

Everything the SDK exports comes from `packages/sdk/src/index.ts`. New types and helpers go **inside** an appropriate `src/<area>/` file and get re-exported there. Do not import from `src/installer/checksum.ts` etc. directly from outside the package.

### 8. No CI yet

`.github/workflows/` does not exist, even though `plan.md` §9 mentions a CI matrix. If you're asked to add CI, build it from scratch (macos-latest + ubuntu-latest + windows-latest, all pinned to Node 26.1.0).

## Test command order for a clean PR

```sh
pnpm install && pnpm rebuild esbuild \
  && pnpm -r typecheck \
  && pnpm -F @trunner/sdk build \
  && pnpm -F @trunner/sdk exec vitest run
```

Typecheck must be clean; build must succeed; the full vitest run (54 tests) must pass.

## Adding a new `Tool` (OpenTofu / Terragrunt / …)

1. Create `packages/sdk/src/tools/<name>/` with at minimum `index.ts` exporting a class that extends `BaseTool`.
2. Implement `binary` (subclass `BaseBinaryManager`) and `provider` (subclass `BaseProviderManager`).
3. Add a `commands` registry (or compose a sibling Tool's commands).
4. Register in `packages/sdk/src/registry/tool-registry.ts` — one line: `registry.register('<name>', () => new YourTool())`.
5. Re-export from `packages/sdk/src/index.ts`.
6. CLI/Desktop surfaces need **no changes** — they look up tools via the registry.

See `packages/sdk/src/tools/terraform/` for the reference implementation.

## References

- [`plan.md`](./plan.md) — full implementation plan, risks, milestones
- [`README.md`](./README.md) — onboarding commands, dev/test/build cheatsheet
- [`packages/sdk/README.md`](./packages/sdk/README.md) — SDK API usage examples
