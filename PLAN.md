# trunner — Implementation Plan

> Cross-platform CLI + Desktop tool for running OpenTofu / Terraform / Terragrunt commands.
> POC scope is **Terraform only**, with extensibility designed in for OpenTofu and Terragrunt.

---

## 1. Goals & Non-Goals

### Goals
- Unified execution surface for IaC tools (Terraform in POC, OpenTofu & Terragrunt later).
- Monorepo with three packages: `sdk`, `cli`, `desktop`.
- Consistent developer experience (pnpm + TypeScript everywhere).
- Extensible `Tool` abstraction so new tools can be added without touching CLI/Desktop.
- Testable at every layer: SDK unit/integration, CLI component, Desktop IPC.

### Non-Goals (POC)
- Code signing / notarization of desktop installers.
- Cloud account / remote backend management.
- State file editing, drift detection UI.
- Full TUI parity (Ink) with Desktop — feature parity is the target, not visual parity.
- Supporting OpenTofu and Terragrunt at the same level as Terraform in the POC milestone (only structural extensibility is required).

---

## 2. Monorepo Layout

```
trunner/
├── pnpm-workspace.yaml
├── package.json                      # Root scripts, devDeps, husky, lint-staged
├── tsconfig.base.json                # Shared strict TS config
├── .editorconfig
├── .gitignore
├── .nvmrc                            # Pin Node 26.1.0
├── .npmrc                            # link-workspace-packages=true, shamefully-hoist=false
├── packages/
│   ├── sdk/                          # Pure TS, no frontend deps
│   ├── cli/                          # React Ink
│   └── desktop/                      # Electron + Vite + React + Tailwind + Zustand
└── docs/
    ├── architecture.md
    └── roadmap.md
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

Root `package.json` scripts (all recursive):
- `build` / `dev` / `test` / `test:integration` / `lint` / `typecheck` / `clean`

---

## 3. Tech Stack Decisions

| Concern | Choice | Reason |
| --- | --- | --- |
| Package manager | pnpm workspaces | Fast, hoisting control, link-workspace-packages |
| Language | TypeScript (strict) | Shared types across packages |
| SDK bundler | tsup | Zero-config CJS+ESM+dts |
| CLI bundler | tsup (CJS single-file) | Single-file CJS bundle required by Node.js SEA |
| CLI packaging | Node.js SEA (Single Executable Application) | Ship the CLI as a single native executable per platform; no `node` install required for end users |
| CLI framework | React Ink | React mental model in terminal |
| CLI arg parser | meow | Lightweight, type-safe |
| Desktop shell | Electron | Mature cross-platform desktop |
| Desktop renderer | Vite + React | Fast HMR, modern bundling |
| Desktop styling | Tailwind CSS | Utility-first, easy theming |
| Desktop state | Zustand | Minimal, hooks-native, fits event-stream state |
| Desktop routing | react-router (HashRouter) | Avoids file:// path issues in Electron |
| Streaming API | EventEmitter + callbacks | Node-idiomatic, easy React wrapping |
| Testing (unit) | Vitest | Fast, ESM-native |
| Testing (CLI UI) | ink-testing-library | First-party Ink testing |
| Testing (Desktop) | Playwright for Electron (phase 3B) | Cross-platform E2E |

---

## 4. SDK Architecture (`packages/sdk`)

### 4.1 Core Abstraction — `Tool`

All tool-specific capabilities are funneled through a single `Tool` interface so OpenTofu and Terragrunt can be added as peers.

```ts
// src/types/tool.ts
export interface Tool {
  readonly id: 'terraform' | 'opentofu' | 'terragrunt';
  readonly displayName: string;
  readonly binary: BinaryManager;
  readonly provider: ProviderManager;
  readonly commands: CommandRegistry;
  detectInstalled(): Promise<VersionInfo | null>;
}
```

- `BinaryManager`: download (official source + custom mirror), SHA256 verify, extract, version pinning, cache.
- `ProviderManager`: parse `.terraform.lock.hcl` / HCL config, fetch from registry, write to local `filesystem_mirror`.
- `CommandRegistry`: declares supported subcommands with `argSpec` and `envSpec`.

### 4.2 Module Tree

```
packages/sdk/src/
├── index.ts                          # Public API
├── types/
│   ├── tool.ts
│   ├── command.ts
│   ├── result.ts
│   ├── events.ts
│   └── provider.ts
├── tools/
│   ├── base/
│   │   ├── base-tool.ts              # Abstract class
│   │   ├── base-binary-manager.ts
│   │   └── base-provider-manager.ts
│   ├── terraform/                    # First concrete implementation
│   │   ├── index.ts
│   │   ├── binary.ts
│   │   ├── provider.ts
│   │   ├── commands.ts               # init/plan/apply/destroy/validate/output/fmt
│   │   └── release-source.ts         # releases.hashicorp.com
│   ├── opentofu/                     # Placeholder (README + .gitkeep)
│   └── terragrunt/                   # Placeholder, will compose TerraformTool
├── registry/
│   └── tool-registry.ts              # register('terraform', () => new TerraformTool())
├── runner/
│   ├── executor.ts                   # spawn child process, inject env
│   ├── stream.ts                     # EventEmitter<RunnerEvent>
│   └── parser.ts                     # Parse plan/apply output
├── installer/
│   ├── downloader.ts                 # node:fetch + retries
│   ├── checksum.ts                   # SHA256
│   └── extractor.ts                  # zip / tar.gz per platform
├── env/
│   ├── paths.ts                      # ~/.trunner/{binaries,providers,config}
│   └── config.ts                     # Persistent JSON: active tool, versions, mirror
└── utils/
    ├── logger.ts                     # Injectable logger sink
    ├── fs.ts
    └── os.ts                         # Platform/arch detection
```

### 4.3 Streaming API (EventEmitter)

```ts
// runner/stream.ts
export interface RunnerEventMap {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  progress: (info: ProgressInfo) => void;
  prompt:  (q: PromptRequest, answer: (v: string) => void) => void;
  exit:    (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface Runner {
  on<K extends keyof RunnerEventMap>(e: K, l: RunnerEventMap[K]): this;
  off<K extends keyof RunnerEventMap>(e: K, l: RunnerEventMap[K]): this;
  cancel(signal?: AbortSignal): Promise<void>;
}
```

- Compatible with React Ink (`useEffect` subscription) and Electron (main → IPC → renderer).
- The `prompt` event lets the upper layer (CLI confirm dialog, Desktop modal) uniformly handle `apply`/`destroy` `yes/no` prompts.

### 4.4 HCL Parsing

HCL parsing for `.terraform.lock.hcl` and `required_providers` blocks uses:

- **`@cdktf/hcl2json`** — converts HCL to JSON, which is then consumed by typed adapters in `tools/terraform/provider.ts`.
- Wrapped behind a small `parseHcl(filePath: string): Promise<unknown>` utility so we can swap implementations later if needed.

### 4.5 Public API Entry

```ts
// src/index.ts
export { createRunner } from './runner/executor';
export { ToolRegistry, registerBuiltinTools } from './registry/tool-registry';
export { TerraformTool } from './tools/terraform';
export type {
  Tool, CommandSpec, RunnerEventMap, ProgressInfo, VersionInfo,
} from './types';
```

### 4.6 Build Output

`tsup.config.ts`:
- `entry`: `src/index.ts`
- `format: ['esm', 'cjs']`
- `dts: true`
- `platform: 'node'`, `splitting: false`

---

## 5. CLI Design (`packages/cli`)

### 5.1 Command Surface

```
trunner <tool> <command> [args]   # e.g. trunner terraform plan
trunner tool list|install|use|uninstall
trunner provider list|install
trunner config get|set
trunner --version
```

### 5.2 Module Tree

```
packages/cli/src/
├── bin.tsx                          # shebang + meow parsing
├── app.tsx                          # Root <App/>
├── commands/
│   ├── tool.tsx
│   ├── provider.tsx
│   └── terraform/
│       ├── init.tsx
│       ├── plan.tsx
│       ├── apply.tsx                # Confirm dialog
│       ├── destroy.tsx
│       ├── validate.tsx
│       ├── output.tsx
│       └── fmt.tsx
├── ui/
│   ├── OutputView.tsx               # ANSI-colored, live
│   ├── Spinner.tsx
│   ├── ProgressBar.tsx
│   └── Confirm.tsx                  # Drives Runner.prompt
└── hooks/
    └── useRunner.ts                 # EventEmitter → React state
```

### 5.3 UI Behaviors

- `OutputView`: ANSI parsing (e.g. `ansi-to-react`) + highlight for plan/apply key lines.
- `Confirm`: listens to `runner.on('prompt', ...)`, blocks until user answers.
- Top-level error boundary surfaces structured errors and exit codes.

### 5.4 Build & Packaging — Node.js SEA

The CLI ships as a **single, native executable per platform** — end users do not need to install Node. We use Node.js's built-in [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) (SEA) feature, which is stable in Node 26.x.

`tsup.config.ts` for the CLI (`packages/cli/tsup.config.ts`):
- `entry: 'src/bin.tsx'`
- `format: ['cjs']` — SEA requires a CJS entry
- `platform: 'node'`, `target: 'node26'`
- `bundle: true`, `external: []` — bundle the `@trunner/sdk` workspace dep and any other deps
- `outfile: 'dist/trunner.cjs'`
- `shims: false`, `minify: true`

Build pipeline (per platform, e.g. `packages/cli/scripts/build-sea.sh` and `build-sea.ps1`):

1. **Bundle** the CLI into a single CJS file:
   ```
   pnpm -F @trunner/cli build         # produces dist/trunner.cjs
   ```
2. **Generate the SEA config** (`packages/cli/sea-config.json`):
   ```json
   { "main": "dist/trunner.cjs", "output": "dist/trunner.blob" }
   ```
3. **Produce the SEA blob** with the Node 26.1.0 binary that matches `.nvmrc`:
   ```
   node --experimental-sea-config sea-config.json
   ```
4. **Copy the Node binary** as the per-platform executable:
   - `trunner-darwin-arm64` / `trunner-darwin-x64`
   - `trunner-linux-x64` / `trunner-linux-arm64`
   - `trunner-win-x64.exe`
5. **Inject the blob** with `postject`:
   ```
   npx postject <executable> NODE_SEA_BLOB dist/trunner.blob \
     --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
   ```
6. **(Out of POC scope)** code-sign and notarize the produced executable.

Root scripts (added to root `package.json`):
- `cli:build:sea:macos` / `cli:build:sea:linux` / `cli:build:sea:windows` — run the pipeline on the current host.
- `cli:build:sea` — convenience: detects current platform and runs the matching script.

Cross-platform note: SEA must run on a host matching the target platform (you cannot cross-compile the binary itself), so the GitHub Actions matrix builds each platform's executable on its own runner.

---

## 6. Desktop Design (`packages/desktop`)

### 6.1 Process Model

```
desktop/
├── electron/
│   ├── main.ts                      # BrowserWindow + IPC handlers (owns SDK instances)
│   ├── preload.ts                   # contextBridge → window.trunner
│   └── tsconfig.json                # CommonJS, target Node
├── vite.config.ts                   # Renderer build
├── index.html
├── tailwind.config.js
├── postcss.config.js
├── src/                             # Renderer
│   ├── main.tsx
│   ├── App.tsx                      # HashRouter
│   ├── views/
│   │   ├── Home.tsx
│   │   ├── Run.tsx                  # Command + live output
│   │   ├── Providers.tsx
│   │   ├── Tools.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── OutputPanel.tsx          # xterm.js or custom + ANSI
│   │   ├── ToolSelector.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── Sidebar.tsx
│   ├── store/                       # Zustand
│   │   ├── useToolsStore.ts
│   │   ├── useRunnerStore.ts        # One subscription per runId
│   │   └── useSettingsStore.ts
│   └── ipc/
│       └── client.ts                # Typed wrapper around window.trunner
```

### 6.2 IPC Contract (main ↔ renderer)

`preload.ts`:
```ts
contextBridge.exposeInMainWorld('trunner', {
  tool: {
    list:        () => ipcRenderer.invoke('tool:list'),
    install:     (id, version) => ipcRenderer.invoke('tool:install', id, version),
    use:         (id, version) => ipcRenderer.invoke('tool:use', id, version),
  },
  provider: { /* list / install */ },
  run: {
    start:   (req) => ipcRenderer.invoke('run:start', req),
    onEvent: (runId, cb) => { /* subscribe to main-process push */ },
    cancel:  (runId) => ipcRenderer.invoke('run:cancel', runId),
    answer:  (runId, promptId, value) => ipcRenderer.invoke('run:answer', runId, promptId, value),
  },
});
```

Main process holds a `RunnerSupervisor` keyed by `runId`; events are pushed via `webContents.send('run:event', runId, evt)`.

### 6.3 Security Baseline

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Strict CSP: `default-src 'self'`, no inline scripts.
- Renderer **never** imports `@trunner/sdk` directly — all calls go through IPC.

---

## 7. Phased Roadmap (POC: Terraform only)

Each phase ends with passing tests and a working demo.

### Phase 1 — SDK Foundation

**Goal**: A publishable, tested `@trunner/sdk` that can download a Terraform binary, install providers, and execute commands via an EventEmitter-based runner.

- [x] Initialize monorepo root: `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`, root `package.json`, `.gitignore`, `.editorconfig`, `.nvmrc`.
- [x] Add root scripts: `build`, `dev`, `test`, `test:integration`, `lint`, `typecheck`, `clean`.
- [x] Configure pnpm workspace and shared TS settings (strict, `target: ES2022`, `moduleResolution: Bundler`).
- [x] Bootstrap `packages/sdk` with `package.json`, `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts`.
- [x] Implement `types/`: `tool.ts`, `command.ts`, `result.ts`, `events.ts`, `provider.ts`.
- [x] Implement `utils/`: `logger.ts`, `fs.ts`, `os.ts`.
- [x] Implement `env/paths.ts` (cross-platform `~/.trunner/{binaries,providers,config}`).
- [x] Implement `env/config.ts` (persistent JSON state: active tool, versions, mirror).
- [x] Implement `installer/checksum.ts` (SHA256 verification).
- [x] Implement `installer/extractor.ts` (zip + tar.gz per platform).
- [x] Implement `installer/downloader.ts` (fetch + retries + progress).
- [x] Implement `tools/base/base-tool.ts`, `base-binary-manager.ts`, `base-provider-manager.ts`.
- [x] Implement `tools/terraform/release-source.ts` (releases.hashicorp.com).
- [x] Implement `tools/terraform/binary.ts` (download/extract/cache/version-pinning).
- [x] Implement `tools/terraform/provider.ts` (HCL parsing via `@cdktf/hcl2json`, registry fetch, filesystem mirror).
- [x] Implement `tools/terraform/commands.ts` (init/plan/apply/destroy/validate/output/fmt with argSpec/envSpec).
- [x] Implement `runner/executor.ts` (spawn, env injection, AbortSignal).
- [x] Implement `runner/stream.ts` (EventEmitter, stdout/stderr/progress/prompt/exit).
- [x] Implement `runner/parser.ts` (plan/apply output parsing — changes, errors, summaries).
- [x] Implement `registry/tool-registry.ts` with `register('terraform', ...)`.
- [x] Implement `src/index.ts` public API exports.
- [x] Unit tests: types, paths, checksum, extractor, HCL parsing (fixture-based).
- [x] Unit tests: executor with mocked `child_process` (event order, env injection, cancellation).
- [x] Integration tests: download Terraform to a tmp dir and run `init` → `plan` → `apply` → `destroy` on a minimal fixture.
- [x] Verify `pnpm -F @trunner/sdk build` produces ESM + CJS + `.d.ts`.

**Phase 1 acceptance**: ✅ `packages/sdk/test/integration` completes a full `init/plan/apply/destroy` cycle against a real Terraform binary (53/53 tests pass, ~2.3s).

---

### Phase 2A — CLI UI Shell

**Goal**: An Ink-based CLI scaffold with reusable components and a mock-runner-driven UI to validate interaction patterns before wiring to the real SDK.

- [x] Bootstrap `packages/cli` with Ink, meow, `ink-testing-library`, `tsx`.
- [x] Configure `tsup.config.ts` for the CLI: ESM single-file bundle (Ink 7 = ESM-only with TLA), `target: 'node26'`, bundled deps.
- [x] Add `sea-config.json` (`mainFormat: "module"`, `useCodeCache: true`) and `scripts/build-sea.{sh,ps1}` for the Node.js SEA pipeline (`node --build-sea` one-step).
- [x] Add root scripts: `cli:build:sea:macos` / `cli:build:sea:linux` / `cli:build:sea:windows` and a `cli:build:sea` dispatcher.
- [x] Implement `trunner.tsx` (renamed from `bin.tsx` to match bundle output) with shebang and meow arg parsing.
- [x] Implement `ui/Spinner.tsx`.
- [x] Implement `ui/ProgressBar.tsx`.
- [x] Implement `ui/Confirm.tsx` (mock `runner.prompt`).
- [x] Implement `ui/OutputView.tsx` (ANSI stripping, streaming).
- [x] Implement `hooks/useRunner.ts` (EventEmitter → React state).
- [x] Implement `app.tsx` with lazy SDK import to avoid eager `@cdktf/hcl2json` WASM load; mock vs real invocation paths.
- [x] Component tests with `ink-testing-library` for `Spinner`, `ProgressBar`, `MockRunner`.
- [x] Manual smoke: run `trunner` with a mock runner producing stdout/stderr/prompt events.

**Phase 2A acceptance**: `pnpm -F @trunner/cli test` passes (14/14), `pnpm -F @trunner/cli dev` shows a working TUI shell with mock data, and `pnpm -F @trunner/cli build:sea:macos` produces a 137 MB self-contained `dist/trunner` binary that runs `--help` and `--mock terraform plan --auto-yes` correctly.

---

### Phase 2B — Desktop UI Shell

**Goal**: An Electron + Vite + React + Tailwind + Zustand app with all views in place and IPC plumbing verified end-to-end against a mock event source.

- [ ] Bootstrap `packages/desktop` with Electron, Vite, React, Tailwind, Zustand, react-router (HashRouter).
- [ ] Configure `electron/main.ts` (BrowserWindow, security baseline).
- [ ] Configure `electron/preload.ts` with `contextBridge` and full IPC surface (placeholder handlers).
- [ ] Configure `vite.config.ts` and Tailwind/PostCSS.
- [ ] Implement `src/main.tsx` and `src/App.tsx` with HashRouter.
- [ ] Implement `src/store/useToolsStore.ts`, `useRunnerStore.ts`, `useSettingsStore.ts`.
- [ ] Implement `src/ipc/client.ts` (typed wrapper for `window.trunner`).
- [ ] Implement `src/views/Home.tsx`.
- [ ] Implement `src/views/Run.tsx` (consumes mock event stream).
- [ ] Implement `src/views/Providers.tsx` (placeholder list).
- [ ] Implement `src/views/Tools.tsx` (placeholder list).
- [ ] Implement `src/views/Settings.tsx` (placeholder).
- [ ] Implement `src/components/OutputPanel.tsx` (ANSI rendering, scrollback).
- [ ] Implement `src/components/ToolSelector.tsx`, `ConfirmDialog.tsx`, `Sidebar.tsx`.
- [ ] Wire `RunnerSupervisor` in main: mock event push via `webContents.send('run:event', ...)`.
- [ ] Manual smoke: launch Electron app, navigate all views, trigger a mock run, confirm events appear in `OutputPanel`.

**Phase 2B acceptance**: `pnpm -F @trunner/desktop dev` launches the app, all 5 views render, mock run streams to `OutputPanel`, and IPC roundtrips succeed.

---

### Phase 3A — CLI Features

**Goal**: Replace the CLI mock with real SDK calls; ship a working `trunner` CLI for Terraform workflows.

- [ ] Wire `commands/tool.tsx` to SDK `ToolRegistry` (`list`, `install`, `use`, `uninstall`).
- [ ] Wire `commands/provider.tsx` to SDK provider manager (`list`, `install`).
- [ ] Wire `commands/terraform/init.tsx` to SDK.
- [ ] Wire `commands/terraform/plan.tsx` to SDK.
- [ ] Wire `commands/terraform/apply.tsx` to SDK (with `Confirm`).
- [ ] Wire `commands/terraform/destroy.tsx` to SDK (with `Confirm`).
- [ ] Wire `commands/terraform/validate.tsx` to SDK.
- [ ] Wire `commands/terraform/output.tsx` to SDK.
- [ ] Wire `commands/terraform/fmt.tsx` to SDK.
- [ ] Implement `--json` and `--quiet` output flags.
- [ ] Structured error formatting and consistent exit codes.
- [ ] End-to-end CLI tests via `zx` shell harness (subprocess invocation, assert stdout/exit code).
- [ ] Verify `pnpm -F @trunner/cli build:sea` produces a working single-file executable on macOS, Linux, and Windows; smoke-test each (`--version`, `tool list`, real `terraform plan`).
- [ ] Add a GitHub Actions matrix job that runs the SEA build per platform and uploads the executable as a build artifact.
- [ ] README with usage examples for every command.

**Phase 3A acceptance**: All Terraform subcommands work end-to-end against a real Terraform binary, and the e2e harness passes on macOS, Linux, and Windows.

---

### Phase 3B — Desktop Features

**Goal**: Replace the Desktop mock with real SDK-driven flows; ship a usable cross-platform desktop app for Terraform.

- [ ] Wire `Tools.tsx` to `window.trunner.tool` IPC (list/install/use).
- [ ] Wire `Providers.tsx` to `window.trunner.provider` IPC.
- [ ] Wire `Settings.tsx` to local config reads/writes via IPC.
- [ ] Wire `Run.tsx` to `window.trunner.run` (start/onEvent/cancel/answer).
- [ ] Replace mock `RunnerSupervisor` with the real SDK runner.
- [ ] Add run history (zustand store keyed by `runId`).
- [ ] Add `ConfirmDialog` integration with the `prompt` event.
- [ ] Add download progress UI in `Tools.tsx` (subscribe to runner `progress`).
- [ ] Configure `electron-builder` for macOS, Windows, Linux targets (no signing in POC).
- [ ] Playwright for Electron E2E tests for Tools, Providers, Run flow.
- [ ] Manual verification: run the same `init/plan/apply/destroy` flow from the desktop UI on macOS, Linux, Windows.
- [ ] Package unsigned installers for all three platforms.

**Phase 3B acceptance**: Desktop app installs and runs on macOS, Linux, and Windows; completes a full Terraform workflow; Playwright suite green.

---

## 8. Extensibility Plan for OpenTofu & Terragrunt

- **OpenTofu** (peer `Tool`):
  - Reuse `BaseTool`, `BaseBinaryManager`, `BaseProviderManager`.
  - New `tools/opentofu/` folder: download from `github.com/opentofu/opentofu` releases.
  - Commands and provider behavior are nearly 1:1 with Terraform.
  - Add one line: `registry.register('opentofu', () => new OpenTofuTool())`.
- **Terragrunt** (peer `Tool`):
  - Own `tools/terragrunt/` for `github.com/gruntwork-io/terragrunt/releases` releases.
  - `provider` delegates to a shared `TerraformTool.provider` instance (shared cache directory).
  - `commands` parses Terragrunt HCL entry points and orchestrates inner `terraform` calls.
  - Add one line: `registry.register('terragrunt', () => new TerragruntTool(terraformTool))`.
- **Any new tool** only needs to satisfy the `Tool` interface and register itself — CLI/Desktop UI and IPC are unaffected.

---

## 9. Testing Strategy

| Layer | Framework | Coverage |
| --- | --- | --- |
| SDK unit | Vitest | types, parser, paths, checksum, extractor, executor (mocked `child_process`) |
| SDK integration | Vitest + real Terraform binary (CI cached) | init/plan/apply end-to-end |
| HCL parsing | Vitest + fixtures | `@cdktf/hcl2json` outputs for `required_providers`, lock files |
| CLI component | `ink-testing-library` | `OutputView`, `Confirm`, `Spinner` |
| CLI end-to-end | `zx` shell harness | All subcommands' exit codes and key stdout |
| Desktop E2E | Playwright for Electron (Phase 3B) | Tools, Providers, Run flows |

CI matrix (GitHub Actions): `macos-latest`, `ubuntu-latest`, `windows-latest`, all pinned to Node 26.1.0 (matches `.nvmrc`). Each platform runner also produces its SEA-packaged CLI executable as a build artifact.

---

## 10. Key Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| HashiCorp/OpenTofu release page structure changes | Isolate parsing in `release-source.ts`; fallback to `X-Checksum-Sha256` header when present |
| HCL parsing edge cases | Use `@cdktf/hcl2json` with a thin adapter so we can swap if needed |
| Cross-platform paths and executable bits | Centralize in `env/paths.ts` and `utils/os.ts` (handle `.exe`, `chmod`) |
| Electron bundle size | Enable `electron-builder` asar + per-platform trimming in Phase 3B |
| Interactive prompt detection | Phase 1 covers `auto-approve`; `runner.prompt` event surfaces interactive prompts in Phase 3 |

---

## 11. Milestones Summary

- **M1 — Phase 1 complete**: `@trunner/sdk` publishable, tested, runs real Terraform end-to-end.
- **M2 — Phase 2A + 2B complete**: CLI TUI shell and Desktop UI shell both render and consume mock runners.
- **M3 — Phase 3A complete**: Production-grade CLI for Terraform workflows.
- **M4 — Phase 3B complete**: Production-grade Desktop app for Terraform workflows on macOS/Linux/Windows.
- **M5 (post-POC)**: OpenTofu and Terragrunt implementations, leveraging the same `Tool` abstraction.
