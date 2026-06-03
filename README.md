# trunner

> Cross-platform CLI + Desktop tool for running **OpenTofu** / **Terraform** / **Terragrunt** commands.

`trunner` wraps the official binaries of these IaC tools behind a single, consistent interface — same install, same execution model, same event stream — and ships the CLI as a **single native executable** per platform (via Node.js SEA) so end users don't need to install Node.

The POC targets **Terraform only**; the architecture is designed so OpenTofu and Terragrunt can be added as peer `Tool` implementations without touching the CLI/Desktop surfaces.

---

## Table of Contents

- [Status](#status)
- [Repository Layout](#repository-layout)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Development Commands](#development-commands)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [License](#license)

---

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase 1** | `@trunner/sdk` — Tool abstraction, runner, installer, Terraform implementation | ✅ Complete (53/53 tests, full `init/plan/apply/destroy` cycle in ~2.3s) |
| **Phase 2A** | CLI UI shell (React Ink) | ⏳ Planned |
| **Phase 2B** | Desktop UI shell (Electron + Vite + React + Tailwind + Zustand) | ⏳ Planned |
| **Phase 3A** | CLI features (real SDK wiring + SEA-packaged executables) | ⏳ Planned |
| **Phase 3B** | Desktop features (real SDK wiring + cross-platform installers) | ⏳ Planned |
| **Phase 5** | OpenTofu & Terragrunt implementations | ⏳ Post-POC |

See [`plan.md`](./plan.md) for the full plan and [`packages/sdk/README.md`](./packages/sdk/README.md) for SDK-level usage.

---

## Repository Layout

```
trunner/
├── pnpm-workspace.yaml             # pnpm workspace config
├── tsconfig.base.json              # Shared strict TypeScript config
├── package.json                    # Root scripts (recursive build/test/lint/typecheck/clean)
├── .nvmrc                          # Pinned Node version
├── .npmrc                          # pnpm settings
├── .editorconfig
├── .gitignore
├── plan.md                         # Full implementation plan
├── README.md                       # This file
└── packages/
    ├── sdk/                        # @trunner/sdk — pure TS, no UI deps
    │   ├── src/                    # types, utils, env, installer, runner, registry, tools
    │   ├── test/unit/              # 52 unit tests
    │   ├── test/integration/       # 1 full lifecycle integration test
    │   └── README.md
    ├── cli/                        # (Phase 2A) React Ink + meow, packaged as SEA
    └── desktop/                    # (Phase 2B) Electron + Vite + React + Tailwind + Zustand
```

---

## Requirements

| Tool | Version | Pinned in |
| --- | --- | --- |
| **Node.js** | `26.1.0` (exact) | `.nvmrc`, root `engines.node`, root `packageManager` |
| **pnpm** | `>=10` (root declares `pnpm@11.5.0`) | root `engines.pnpm`, `packageManager` |

No system binaries are required at runtime — `.zip` archives (HashiCorp ships Terraform as `.zip` for all platforms) are extracted in-process by the pure-JS [`adm-zip`](https://www.npmjs.com/package/adm-zip) library, and `.tar.gz` archives by the [`tar`](https://www.npmjs.com/package/tar) package.

---

## Quick Start

```sh
# 1. Use the pinned Node version
nvm use                # picks up .nvmrc → 26.1.0

# 2. Install workspace dependencies
pnpm install

# 3. Build everything
pnpm build

# 4. Sanity-check with the full test suite
pnpm test              # unit + integration
```

That's it — no global installs, no `.env` files, no DB to seed.

---

## Development Commands

All root scripts run recursively across every workspace package (`pnpm -r …`).

| Command | What it does |
| --- | --- |
| `pnpm install` | Install all workspace + dev dependencies |
| `pnpm build` | Build every package (currently `@trunner/sdk` → ESM + CJS + `.d.ts`) |
| `pnpm dev` | Watch-mode build for every package, in parallel |
| `pnpm typecheck` | `tsc --noEmit` across the whole monorepo |
| `pnpm test` | Run unit **and** integration tests for every package |
| `pnpm test:unit` | Unit tests only (fast, no network) |
| `pnpm test:integration` | Integration tests only (downloads a real Terraform binary) |
| `pnpm lint` | Lint every package (placeholder until ESLint is configured) |
| `pnpm clean` | Remove `dist/`, `coverage/`, `.tsbuildinfo`, and `node_modules` |

### Per-package

Run scripts inside a single package with `pnpm -F <name> …`:

```sh
pnpm -F @trunner/sdk build              # tsup → ESM + CJS + dts
pnpm -F @trunner/sdk dev                # tsup --watch
pnpm -F @trunner/sdk test               # full vitest run
pnpm -F @trunner/sdk test:unit          # unit only
pnpm -F @trunner/sdk test:integration   # integration only
pnpm -F @trunner/sdk test:watch         # vitest watch mode
pnpm -F @trunner/sdk typecheck          # tsc --noEmit
```

### `esbuild` post-install

`tsup` bundles via `esbuild`, which sometimes needs its native binary rebuilt inside the pnpm sandbox:

```sh
pnpm rebuild esbuild
```

If `pnpm install` prints `Ignored build scripts: esbuild`, run the command above once.

---

## Testing

### Unit tests

Pure, no network. 52 tests covering types, paths, config store, checksum, extractor, HCL parsing, executor (mocked `child_process`), commands registry, and the tool registry.

```sh
pnpm -F @trunner/sdk test:unit
```

### Integration test

Downloads a real Terraform binary and runs a full `init / plan / apply / destroy` cycle against a `null_resource` fixture. Takes ~2.3s on a warm cache.

```sh
pnpm -F @trunner/sdk test:integration
```

**Environment variables:**

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRUNNER_SKIP_INTEGRATION` | unset | Set to `1` to skip the integration test entirely |
| `TRUNNER_TERRAFORM_VERSION` | `1.6.6` | Terraform version to download for the test |
| `TRUNNER_TERRAFORM_BIN` | unset | Path to a pre-installed Terraform binary; if set, the test reuses it and skips download |

### Where test data lives

The SDK writes to `~/.trunner/`:

```
~/.trunner/
├── binaries/<tool>/<tool>-<version>[.exe]    # installed binaries
├── cache/<tool>/                             # extraction scratch
├── downloads/<tool>/                         # raw archives
├── providers/<tool>/plugins/...              # plugin mirror
├── config/config.json                        # active tool, pinned versions, mirror
├── logs/                                     # reserved
└── tmp/                                      # reserved
```

The integration test populates and cleans up its own fixture project; it does **not** touch `~/.trunner/binaries/` or `~/.trunner/providers/` between runs.

---

## Project Structure

| Path | What lives here |
| --- | --- |
| `packages/sdk/src/types/` | Public interfaces: `Tool`, `CommandSpec`, `RunnerEventMap`, `ProgressInfo`, `VersionInfo`, provider types |
| `packages/sdk/src/utils/` | `logger` (Console/Noop with child bindings), `fs` (atomic write, JSON helpers), `os` (platform/arch detection) |
| `packages/sdk/src/env/` | `paths.ts` (cross-platform `~/.trunner/...`), `config.ts` (persistent `TrunnerConfig`) |
| `packages/sdk/src/installer/` | `checksum` (SHA-256), `downloader` (fetch + retries + progress + abort), `extractor` (`.tar.gz` via `tar`, `.zip` via `adm-zip`) |
| `packages/sdk/src/tools/base/` | `BaseTool`, `BaseBinaryManager`, `BaseProviderManager` |
| `packages/sdk/src/tools/terraform/` | Concrete Terraform implementation: release source, binary, provider, command registry |
| `packages/sdk/src/runner/` | `RunnerStream` (EventEmitter), `executor` (spawn + AbortSignal + prompt detection), `parser` (plan/apply/destroy summaries) |
| `packages/sdk/src/registry/` | `ToolRegistry` — register/get/list tools, defaults to Terraform |
| `packages/sdk/src/index.ts` | Public API barrel |

See [`packages/sdk/README.md`](./packages/sdk/README.md) for a full SDK usage example.

---

## Architecture

```
                       ┌────────────────────────────────┐
                       │   Desktop (Electron + React)   │   ← Phase 2B / 3B
                       │   CLI (React Ink)              │   ← Phase 2A / 3A
                       └──────────────┬─────────────────┘
                                      │  IPC / process
                                      ▼
       ┌──────────────────────────────────────────────────────┐
       │                   @trunner/sdk                       │
       │  Runner  ←→  ToolRegistry  ←→  {Terraform, OpenTofu,│
       │     │              │              Terragrunt, …}     │
       │     │              │                                │
       │  EventEmitter   Binary/Provider                    │
       │  stdout/stderr  Manager                             │
       │  progress/      (download → verify → extract →     │
       │  prompt/exit    chmod → cache)                      │
       └──────────────────────────────────────────────────────┘
                                      │
                                      ▼
                       ~/.trunner/{binaries,cache,
                                   downloads,providers,
                                   config,logs,tmp}
```

The **Tool** interface is the only contract a tool must satisfy. Adding OpenTofu or Terragrunt is a single folder under `packages/sdk/src/tools/<name>/` plus one line in the registry — no CLI/Desktop changes.

Full design notes: [`plan.md`](./plan.md).

---

## Roadmap

- **M1** ✅ Phase 1 — `@trunner/sdk` publishable, tested, real Terraform end-to-end
- **M2** ⏳ Phase 2A + 2B — CLI TUI shell and Desktop UI shell both render against a mock runner
- **M3** ⏳ Phase 3A — Production-grade CLI for Terraform workflows + SEA-packaged executables per platform
- **M4** ⏳ Phase 3B — Production-grade Desktop app for Terraform workflows on macOS / Linux / Windows
- **M5** ⏳ Post-POC — OpenTofu & Terragrunt on the same `Tool` abstraction

Tracked in detail in [`plan.md`](./plan.md) sections 7–11.

---

## Documentation

- [`plan.md`](./plan.md) — full implementation plan, phase breakdown, technical decisions, risks
- [`packages/sdk/README.md`](./packages/sdk/README.md) — SDK API overview, quick-start, layout
- Future:
  - `docs/architecture.md` — deeper system design
  - `docs/roadmap.md` — release roadmap

---

## Contributing

1. Fork & branch from `main`.
2. Use `nvm use` to pick up Node 26.1.0.
3. Run `pnpm install && pnpm typecheck && pnpm test:unit` before opening a PR.
4. Keep `pnpm -F @trunner/sdk build` green — release artifacts depend on it.

---

## License

[MIT](./LICENSE) © Charlie Huang
