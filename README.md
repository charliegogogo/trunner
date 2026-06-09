# trunner

> Cross-platform CLI + Desktop tool for running **OpenTofu** / **Terraform** commands.

`trunner` wraps the official binaries of these IaC tools behind a single, consistent interface — same install, same execution model, same event stream — and ships the CLI as a **single native executable** per platform (via Node.js SEA) so end users don't need to install Node.

The POC targets **Terraform only**; the architecture is designed so OpenTofu can be added as a peer `Tool` implementation without touching the CLI/Desktop surfaces.

---

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase 1** | `@trunner/sdk` — Tool abstraction, runner, installer, Terraform implementation | ✅ Complete (full `init/plan/apply/destroy` cycle against a real Terraform binary) |
| **Phase 2A** | CLI TUI shell (React Ink) + Node.js SEA pipeline (single-file native binary) | ✅ Complete (139 MB `dist/trunner` per platform) |
| **Phase 2A.5** | Single-verb surface + `.trunnerrc` discovery + multi-workspace parallel execution + Claude-Code-style carousel view | ✅ Complete |
| **Phase 2B** | Smart binary + provider version selection in the SDK (`tool.resolveAll`) | ⏳ Planned |
| **Phase 2C** | Desktop UI shell (Electron + Vite + React + Tailwind + Zustand) | ⏳ Planned |
| **Phase 3A** | CLI features (real SDK wiring + `.trunner` config + SEA-packaged executables) | ⏳ Planned |
| **Phase 3B** | Desktop features (real SDK wiring + cross-platform installers) | ⏳ Planned |
| **M7** | OpenTofu implementation | ⏳ Post-POC |

See [`PLAN.md`](./PLAN.md) for the full plan.

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
├── PLAN.md                    # Full implementation plan
├── README.md                  # This file
├── AGENTS.md                  # Dev/test/build cheatsheet + gotchas (single source of truth)
└── packages/
    ├── sdk/                   # @trunner/sdk — pure TS, no UI deps (Phase 1 ✅)
    │   ├── src/               # types, utils, env, installer, runner, registry, tools
    │   ├── test/unit/         # Unit tests
    │   ├── test/integration/  # Full Terraform lifecycle test
    │   └── README.md          # SDK-level usage guide
    ├── cli/                   # (Phase 2A ✅, 2A.5 ✅) React Ink + meow, packaged as SEA
    └── desktop/               # (Phase 2C ⏳) Electron + Vite + React + Tailwind + Zustand
```

---

## Architecture

```
                        ┌────────────────────────────────┐
                        │   Desktop (Electron + React)   │   ← Phase 2C / 3B
                        │   CLI (React Ink)              │   ← Phase 2A / 2A.5 / 3A
                        └──────────────┬─────────────────┘
                                       │  IPC / process
                                       ▼
        ┌──────────────────────────────────────────────────────┐
        │                   @trunner/sdk                       │
         │  Runner  ←→  ToolRegistry  ←→  {Terraform, OpenTofu, …} │
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

The **Tool** interface is the only contract a tool must satisfy. Adding OpenTofu is a single folder under `packages/sdk/src/tools/<name>/` plus one line in the registry — no CLI/Desktop changes. See [PLAN.md §8](./PLAN.md) for the full extensibility plan.

---

## Roadmap

- **M1** ✅ Phase 1 — `@trunner/sdk` publishable, tested, real Terraform end-to-end
- **M2** ✅ Phase 2A — CLI TUI shell + Node.js SEA pipeline (single-file native binary per platform)
- **M2.5** ⏳ Phase 2A.5 — single-verb `trunner <command>` surface + `.trunnerrc` discovery + multi-workspace parallel execution
- **M3** ⏳ Phase 2B — smart binary + provider version selection in the SDK; one-shot `trunner plan` against a cold `~/.trunner`
- **M4** ⏳ Phase 2C — Desktop UI shell mirroring the multi-workspace model
- **M5** ⏳ Phase 3A — production-grade CLI for Terraform workflows + SEA-packaged executables per platform
- **M6** ⏳ Phase 3B — production-grade Desktop app for Terraform workflows on macOS / Linux / Windows
- **M7** ⏳ Post-POC — OpenTofu on the same `Tool` abstraction

Tracked in detail in [`PLAN.md`](./PLAN.md) sections 7–11.

---

## Documentation

- [`PLAN.md`](./PLAN.md) — full implementation plan, phase breakdown, technical decisions, risks
- [`AGENTS.md`](./AGENTS.md) — **dev/test/build cheatsheet and gotchas (read this first)**
- [`packages/sdk/README.md`](./packages/sdk/README.md) — SDK API overview and quick-start

---

## License

[MIT](./LICENSE) © Charlie Huang
