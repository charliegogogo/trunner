# trunner

> Cross-platform CLI + Desktop tool for running **OpenTofu** / **Terraform** / **Terragrunt** commands.

`trunner` wraps the official binaries of these IaC tools behind a single, consistent interface — same install, same execution model, same event stream — and ships the CLI as a **single native executable** per platform (via Node.js SEA) so end users don't need to install Node.

The POC targets **Terraform only**; the architecture is designed so OpenTofu and Terragrunt can be added as peer `Tool` implementations without touching the CLI/Desktop surfaces.

---

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase 1** | `@trunner/sdk` — Tool abstraction, runner, installer, Terraform implementation | ✅ Complete (full `init/plan/apply/destroy` cycle against a real Terraform binary) |
| **Phase 2A** | CLI UI shell (React Ink) | ⏳ Planned |
| **Phase 2B** | Desktop UI shell (Electron + Vite + React + Tailwind + Zustand) | ⏳ Planned |
| **Phase 3A** | CLI features (real SDK wiring + SEA-packaged executables) | ⏳ Planned |
| **Phase 3B** | Desktop features (real SDK wiring + cross-platform installers) | ⏳ Planned |
| **Phase 5** | OpenTofu & Terragrunt implementations | ⏳ Post-POC |

See [`plan.md`](./plan.md) for the full plan.

---

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | `26.1.0` (exact) | pinned in `.nvmrc` and root `engines.node` |
| **pnpm** | `11.5.0` | enforced via root `packageManager` |

For development commands, the test suite, the `esbuild` post-install quirk, integration-test env vars, and everything else an agent or contributor needs on day one, see **[`AGENTS.md`](./AGENTS.md)** — it is the single source of truth for "how to work in this repo."

---

## Quick Start

```sh
nvm use            # pick up .nvmrc → 26.1.0
pnpm install
pnpm rebuild esbuild    # one-time, see AGENTS.md → Gotchas
pnpm build
pnpm test
```

That's it. No global installs, no `.env` files, no DB to seed.

---

## Repository Layout

```
trunner/
├── pnpm-workspace.yaml        # pnpm workspace config
├── tsconfig.base.json         # Shared strict TypeScript config
├── package.json               # Root scripts (recursive build/test/lint/typecheck/clean)
├── .nvmrc                     # Pinned Node version (26.1.0)
├── .npmrc                     # pnpm settings
├── plan.md                    # Full implementation plan
├── README.md                  # This file
├── AGENTS.md                  # Dev/test/build cheatsheet + gotchas (single source of truth)
└── packages/
    ├── sdk/                   # @trunner/sdk — pure TS, no UI deps (Phase 1 ✅)
    │   ├── src/               # types, utils, env, installer, runner, registry, tools
    │   ├── test/unit/         # Unit tests
    │   ├── test/integration/  # Full Terraform lifecycle test
    │   └── README.md          # SDK-level usage guide
    ├── cli/                   # (Phase 2A) React Ink + meow, packaged as SEA
    └── desktop/               # (Phase 2B) Electron + Vite + React + Tailwind + Zustand
```

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
        │  Runner  ←→  ToolRegistry  ←→  {Terraform, OpenTofu, │
        │     │              │              Terragrunt, …}    │
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

The **Tool** interface is the only contract a tool must satisfy. Adding OpenTofu or Terragrunt is a single folder under `packages/sdk/src/tools/<name>/` plus one line in the registry — no CLI/Desktop changes. See [plan.md §8](./plan.md) for the full extensibility plan.

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
- [`AGENTS.md`](./AGENTS.md) — **dev/test/build cheatsheet and gotchas (read this first)**
- [`packages/sdk/README.md`](./packages/sdk/README.md) — SDK API overview and quick-start

---

## License

[MIT](./LICENSE) © Charlie Huang
