# trunner — Implementation Plan

> Cross-platform CLI + Desktop tool for running OpenTofu / Terraform commands.
> POC scope is **Terraform only**, with extensibility designed in for OpenTofu. Terragrunt support is **explicitly cut from POC scope** (§1) — its module/provide model diverges from Terraform in ways not worth the design cost right now.
>
> **CLI surface is single-verb with tool-as-config**, not the typical `<tool> <command>` pattern. From a project directory (or any ancestor of one) `trunner plan` discovers all `.trunnerrc` workspaces in the subtree, resolves tool + provider versions, and runs the command against every workspace in parallel — with a Claude-Code-style status bar on top and a switchable stream view per workspace. See §5.1 and §4.8.

---

## 1. Goals & Non-Goals

### Goals
- Unified execution surface for IaC tools (Terraform in POC, OpenTofu later).
- **Monorepo-first**: one `trunner <command>` invocation discovers and runs against every `.trunnerrc` workspace in the cwd subtree, in parallel. Top-level UI shows a status bar; user can switch into any workspace's live output. (See §4.8 and Phase 2A.5.)
- Monorepo with three packages: `sdk`, `cli`, `desktop`.
- Consistent developer experience (pnpm + TypeScript everywhere).
- Extensible `Tool` abstraction so new tools can be added without touching CLI/Desktop.
- **Smart binary + provider version selection** out of the box (§4.5, Phase 2B): given a Terraform project, trunner inspects its `required_version` + `required_providers` constraints, resolves concrete versions (or honors the lock file), installs them, and runs the user's command — all in one shot.
- Testable at every layer: SDK unit/integration, CLI component, Desktop IPC.

### Non-Goals (POC)
- Code signing / notarization of desktop installers.
- Cloud account / remote backend management.
- State file editing, drift detection UI.
- Full TUI parity (Ink) with Desktop — feature parity is the target, not visual parity.
- Supporting OpenTofu at the same level as Terraform in the POC milestone (only structural extensibility is required).
- **Terragrunt support** — cut from POC scope. Terragrunt's HCL config model (DRY, remote state, dependencies) and the way it composes Terraform require their own `Tool` design; out of scope for now.
- **Re-implementing module source resolvers** in the SDK (git, S3, GCS, generic HTTP, registry, local paths) — would be 500–800 LoC of fragile code with little payoff. trunner delegates module fetching to the tool binary itself (`terraform get`), then walks the resulting `.terraform/modules/` tree.
- **Caching the Terraform Registry index on disk.** Every CLI invocation re-discovers via the [Remote Service Discovery Protocol](https://developer.hashicorp.com/terraform/internals/remote-service-discovery). At normal workloads (a handful of provider lookups per run) the round-trip cost is negligible, and we avoid drift between the cached index and the live registry.
- **Cross-machine orchestration.** A `trunner plan` runs on all workspaces on the *current* machine. Distributed / remote execution (over SSH, in CI workers, etc.) is out of POC scope.
- **State-file locking awareness.** If two workspaces in the same monorepo share a state backend, the user is responsible for serializing them via `--concurrency 1` or a remote-state lock. trunner does not detect or prevent this.

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
| CLI bundler | tsup (ESM single-file) | Ink 7 + yoga-layout use TLA — esbuild refuses to bundle TLA into CJS, so the CLI outputs ESM and SEA wraps it with `mainFormat: "module"` |
| Semver logic | `semver` npm package | Constraint parsing (`^`, `~>`, `>=`), `satisfies`, `maxSatisfying` for the version solver |
| `.trunnerrc` parser | `smol-toml` | 10 KB, no deps, full TOML support — keeps `.trunnerrc` (TOML) simple to parse and validate |
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

All tool-specific capabilities are funneled through a single `Tool` interface so OpenTofu can be added as a peer.

```ts
// src/types/tool.ts
export interface Tool {
  readonly id: 'terraform' | 'opentofu';
  readonly displayName: string;
  readonly binary: BinaryManager;
  readonly provider: ProviderManager;
  readonly commands: CommandRegistry;
  detectInstalled(): Promise<VersionInfo | null>;

  /**
   * One-shot smart resolve: given a project directory, pick concrete
   * versions for the tool binary and all required providers, install
   * anything missing, and return the resolved manifest.
   *
   * @param req.projectDir          Path to a directory with `*.tf` files
   * @param req.toolVersionRef      CLI `--tool-version` value, or 'auto'
   * @param req.platform            Current platform (for provider binary selection)
   */
  resolveAll(req: {
    projectDir: string;
    toolVersionRef: 'auto' | string;
    platform: PlatformInfo;
  }): Promise<ResolvedManifest>;
}

export interface ResolvedManifest {
  toolVersion: string;                              // resolved binary version
  providers: Array<{ source: string; version: string }>;
  skipped: Array<{ source: string; reason: string }>; // e.g. "no darwin_arm64 binary"
}
```

- `BinaryManager`: download (official source + custom mirror), SHA256 verify, extract, version pinning, cache. Exposes `resolveVersion(ref)`, `listInstalled()`, and a `binaryPath(version)` that **rejects `'latest'` as a literal filename** (caller must resolve to a concrete version first).
- `ProviderManager`: parse `.terraform.lock.hcl` / HCL config, fetch from registry, write to local `filesystem_mirror`. Exposes `resolveVersion(source, constraints)`, `listInstalled()`, and `ensureInstalled({source, version, platform})`.
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
│   └── opentofu/                     # Placeholder (README + .gitkeep)
├── registry/
│   └── tool-registry.ts              # register('terraform', () => new TerraformTool())
├── runner/
│   ├── executor.ts                   # spawn child process, inject env
│   ├── stream.ts                     # EventEmitter<RunnerEvent>
│   └── parser.ts                     # Parse plan/apply output
├── installer/
│   ├── downloader.ts                 # node:fetch + retries
│   ├── checksum.ts                   # SHA256
│   ├── extractor.ts                  # zip / tar.gz per platform
│   ├── version-solver.ts             # Pure: solve version candidates against constraints
│   ├── constraint-set.ts             # Data structure wrapping the `semver` package
│   ├── hcl-walker.ts                 # Recursive walk of .terraform/modules/ + project root
│   └── provider-registry.ts          # Remote Service Discovery + Registry API client
├── workspace/
│   ├── trunner-rc.ts                 # .trunnerrc schema + parser (smol-toml)
│   ├── discover.ts                   # Recursive scan-down + project-boundary logic
│   └── runner.ts                     # Parallel execution with concurrency control + stream multiplexing
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

### 4.5 Smart Version Selection (Phase 2B)

The smart resolver is a pipeline of small, testable units. The flow is:

```
Tool.resolveAll({ projectDir, toolVersionRef, platform })
  │
  ├─► 1. ensureToolBinary(toolVersionRef)               # download if missing
  ├─► 2. run 'terraform get' in projectDir              # populates .terraform/modules/
  ├─► 3. hclWalker.walk(projectDir)                      # see §4.5.1
  │        → list of (source, constraint) pairs from every .tf file
  │        + lock file map (if present) keyed by source
  ├─► 4. for each provider:
  │        ├─ if lock file has it: pinnedVersion = lock[source]
  │        └─ else: registry.versions(source) → solver.solve(constraint, platform-filtered)
  ├─► 5. for each resolved (source, version):
  │        provider.ensureInstalled({ source, version, platform })
  └─► 6. return ResolvedManifest
```

The user's command (e.g. `trunner plan`) only runs **after** this pipeline completes for every discovered workspace. Failures surface as structured `ResolveError` with a precise reason ("no candidate satisfies `~> 5.34` on darwin_arm64", "lock file pins hashicorp/aws 5.34.0 but local cache is corrupt", etc.).

#### 4.5.1 HCL Walker (`installer/hcl-walker.ts`)

Two-step walk:

1. **Root project** — glob `*.tf` and `*.tf.json` at `projectDir`, parse each with `@cdktf/hcl2json`, extract `terraform { required_version = "..." }` and `required_providers { source = "...", version = "..." }`.
2. **Module tree** — read `.terraform/modules/modules.json` (terraform writes this during `get`; do not glob — it is the canonical manifest), recursively process each `Key` as a sub-project. Avoid infinite loops via a visited set keyed on the absolute resolved path.

#### 4.5.2 Version Solver (`installer/version-solver.ts` + `constraint-set.ts`)

Pure, I/O-free, exhaustive unit-testable. The hard parts are:

- `~>` pessimistic: `~> 5.34` = `[5.34.0, 6.0.0)`; `~> 5.34.0` = `[5.34.0, 5.35.0)`. Implemented with `semver.subset(...)` and explicit boundary tests.
- Pre-release handling: solver picks the highest **stable** version by default; pre-releases (`1.0.0-rc1`) are only considered when the user opts in (CLI flag `--include-prerelease`).
- **Platform filtering** of the candidate list: a provider version that doesn't ship a `darwin_arm64` binary is silently dropped from the candidate set **before** solving. This is what makes "no candidate satisfies `~> 1.0` on linux_arm64" a real error message rather than a downstream crash.

#### 4.5.3 Provider Registry Client (`installer/provider-registry.ts`)

Two responsibilities:

1. **Remote Service Discovery Protocol** — `GET https://registry.terraform.io/.well-known/terraform.json` returns `{ "providers.v1": "...", "modules.v1": "...", "login.v1": {…} }`. trunner uses the returned URLs (not hardcoded ones) for all subsequent calls. This is mandatory for protocol compliance and for compatibility with private registries (`TFE_HOSTNAME`).
2. **Registry API** — `GET {providers.v1}/{namespace}/{type}/versions` returns a list of versions. The response includes `platforms` for each version; trunner filters to the current platform **before** passing candidates to the solver.

Network errors are non-fatal at the discovery step (we fall back to a baked-in default URL with a warning) and fatal at the version-listing step.

#### 4.5.4 Provider Mirror Layout

Provider files are written to `~/.trunner/providers/<namespace>/<type>/terraform-provider-<ns>-<type>_<v>_<os>_<arch>` — **exact match** to terraform's `.terraform/providers/` layout, because the [filesystem_mirror](https://developer.hashicorp.com/terraform/internals/remote-service-discovery#filesystem_mirror) lookup uses strict path conventions. The `installer/provider-registry.ts` writer and the local `filesystem_mirror` reader agree on this layout, and any new mirror mode (e.g. `packaged` for offline) must follow it.

The CLI passes `TF_CLI_CONFIG_FILE=$HOME/.trunner/.terraformrc` to the spawned terraform process. The generated `.terraformrc` contains a single `provider_installation` block:

```hcl
provider_installation {
  filesystem_mirror {
    path    = "/Users/x/.trunner/providers"
    exclude = ["registry.terraform.io/-/null"]
  }
  direct {}  # disabled; if the mirror is missing a provider, fail loudly
}
```

#### 4.5.5 Lock File Priority

`.terraform.lock.hcl` is **ground truth** when present:

- If a provider is in the lock file, the locked version is used verbatim — the solver is skipped for that provider. The hash list is not re-verified (terraform itself does that on `init`).
- If a provider is **not** in the lock file, the solver runs normally.
- Lock file is read once per `resolveAll` call; not persisted or mutated by trunner.

### 4.6 Public API Entry

```ts
// src/index.ts
export { createRunner } from './runner/executor';
export { ToolRegistry, registerBuiltinTools } from './registry/tool-registry';
export { TerraformTool } from './tools/terraform';
export type {
  Tool, CommandSpec, RunnerEventMap, ProgressInfo, VersionInfo,
} from './types';
```

### 4.7 Build Output

`tsup.config.ts`:
- `entry`: `src/index.ts`
- `format: ['esm', 'cjs']`
- `dts: true`
- `platform: 'node'`, `splitting: false`

---

### 4.8 Workspace Discovery (`workspace/discover.ts`)

A **workspace** is a directory containing a `.trunnerrc` file. `trunner <command>` discovers all workspaces under the current working directory and runs `<command>` in each, in parallel. This is the foundation of monorepo orchestration.

#### 4.8.1 `.trunnerrc` Schema (TOML)

```toml
# .trunnerrc — required
tool = "terraform"            # or "opentofu"

# optional
version    = "~> 1.6"         # tool binary version constraint (consumed by Phase 2B's solver)
concurrency = 8               # override os.cpus().length for this workspace's run slot
exclude    = ["vendor", "build"]  # extra dirs to skip during recursive scan (see §4.8.2)
```

`smol-toml` parses the file. Unknown keys produce a warning, not an error (forward-compat).

#### 4.8.2 Recursive Scan Algorithm

```
discoverWorkspaces(cwd, opts = {}):
  results = []
  walk(cwd, opts)
  return results

walk(dir, opts):
  if dir matches ALWAYS_EXCLUDE or opts.exclude: return
  if .trunnerrc exists in dir:
    results.push({ dir, config: parseRc(dir/.trunnerrc) })
    return                     # .trunnerrc is a project boundary — do not descend
  for each entry in dir (withFileTypes):
    if entry.isDirectory: walk(entry.path, opts)
```

- `ALWAYS_EXCLUDE = { '.git', '.terraform' }` — always, no override.
- `opts.exclude` is the union of (CLI `--exclude` flags) ∪ (each `.trunnerrc`'s `exclude` field found in ancestors of cwd) — but we do NOT apply a workspace's own `exclude` to itself; we apply it when discovering siblings of that workspace. (Concretely: `exclude` affects the scan starting at the directory containing that `.trunnerrc`, not the workspace itself.)
- Symlinks are NOT followed (avoid infinite loops in vendored deps).
- Permission errors during scan are logged and skipped, not fatal.

#### 4.8.3 Lookup Scope (no scan-up)

- trunner scans **downward from cwd only**. It does **not** scan upward to a parent directory.
- If the user is in `monorepo/services/api/src/` (no `.trunnerrc` in `src/...`), trunner errors: `no .trunnerrc found under <cwd>; cd to a project root or use --cwd <path>`.
- The user can override cwd with `--cwd <path>` (resolves a different starting point for the scan). The scan still goes down from `--cwd`, not up.

### 4.9 Multi-Project Execution (`workspace/runner.ts`)

```ts
// workspace/runner.ts
export interface WorkspaceEventMap {
  started:    (ws: Workspace) => void;
  progress:   (ws: Workspace, info: ProgressInfo) => void;
  stdout:     (ws: Workspace, chunk: string) => void;
  stderr:     (ws: Workspace, chunk: string) => void;
  exited:     (ws: Workspace, code: number | null, signal: NodeJS.Signals | null) => void;
  done:       (summary: RunSummary) => void;
}

export function runWorkspaces(
  workspaces: Workspace[],
  command: string,
  args: string[],
  opts: { concurrency?: number; toolVersionRef?: string; toolOverride?: string }
): AsyncIterable<WorkspaceEvent>;
```

#### 4.9.1 Concurrency Model

- Default: `os.cpus().length`. Each workspace's `.trunnerrc` `concurrency` field overrides locally; CLI `--concurrency <n>` overrides globally; global wins.
- A simple worker-pool: N concurrent workers pull workspaces from a FIFO queue. A worker runs the full pipeline (`resolveAll` → spawn tool → stream output → exit) for one workspace, then picks the next.
- Output streams are buffered per workspace; the consumer of the `AsyncIterable` is responsible for routing each event to the right pane in the UI (see §5.3).

#### 4.9.2 Per-Workspace Pipeline

For each workspace picked off the queue:

1. `tool.resolveAll({ projectDir: ws.dir, toolVersionRef, platform })` — Phase 2B's smart resolver (§4.5).
2. Set `cwd = ws.dir` and `TF_CLI_CONFIG_FILE` (for the provider mirror) when spawning the tool binary.
3. Stream stdout/stderr through the `WorkspaceEvent` channel tagged with the workspace.
4. On exit, mark the workspace as `done` with the exit code; the next worker picks up the next workspace.

#### 4.9.3 UI Model (Claude Code / opencode style)

Top-level view: a status bar with one entry per workspace — `team-a/api · running · 12s`, `team-b/web · done (3 to add)`, `team-c/db · failed (exit 1)`. The user can press a key (e.g. `Tab` / `j`/`k` / arrow keys) to switch the **detail pane** between workspaces and view the live `OutputView` of the focused workspace. Phase 2A.5 ships a TUI version; the Desktop phase (2C) ships the same model in React with a richer output panel.

A failed workspace does **not** abort the rest — all workspaces run to completion, the summary at the end reports per-workspace exit codes, and the overall process exit code is `0` if all succeeded, `1` otherwise.

---

## 5. CLI Design (`packages/cli`)

### 5.1 Command Surface

Single-verb, tool-as-config. Tool is determined by `.trunnerrc` in the current workspace or by `-t` on the command line — never as a positional argument.

```
trunner <command> [args...]         # e.g. trunner plan, trunner apply -auto-approve
trunner tools                       # list installed tools + their versions
trunner tools install <name> [ver]  # e.g. trunner tools install terraform 1.6.6
trunner providers                   # list installed providers (per-workspace mirror)
trunner providers install <source>  # e.g. trunner providers install hashicorp/aws
trunner config get|set              # global config (mirror, default tool, etc.)
trunner --version
```

If `trunner <command>` is run with no `.trunnerrc` found under cwd (and no `-t` / `--cwd` set), trunner errors with a structured message:

```
error: no .trunnerrc found under /Users/me/monorepo/services/api/src
hint: cd to a project root, create a .trunnerrc, or pass --cwd <path> and -t <tool>
```

**Global flags** (apply to any `trunner <command>`):

| Flag | Meaning | Default |
| --- | --- | --- |
| `-t, --tool <name>` | Override the workspace's `.trunnerrc` `tool` field for this invocation only. | `.trunnerrc`'s `tool` |
| `--cwd <path>` | Start the workspace scan from `<path>` instead of the actual cwd. | `process.cwd()` |
| `--tool-version <semver>` | Pin the tool binary version (e.g. `1.6.6`, `~> 1.6`). Overrides `.trunnerrc`'s `version` and the project's HCL `required_version`. | `auto` |
| `--include-prerelease` | Allow pre-release versions (`1.0.0-rc1`) in the solver candidate list. | off |
| `--mirror <url>` | Override the default terraform + provider mirror. | unset |
| `--concurrency <n>` | Max workspaces running in parallel. | `os.cpus().length` |
| `--exclude <dir>` | Add `<dir>` to the scan's exclude set. Repeatable. | empty |
| `--json` | Emit a single JSON line per workspace event (CI-friendly; no TUI). | off |
| `--quiet` | Suppress per-workspace status bar; emit only the final summary. | off |

Note: `--version` is reserved for the trunner version (`trunner --version` → `0.x.y`). Tool version pinning uses `--tool-version` to avoid clashing.

### 5.2 Module Tree

```
packages/cli/src/
├── trunner.tsx                      # entry (renamed from bin.tsx to match bundle basename)
├── app.tsx                          # Root <App/>: parses flags, calls workspace.discover + workspace.runner
├── ui/
│   ├── StatusBar.tsx                # top-level: one card per workspace
│   ├── WorkspacePane.tsx            # detail view for the focused workspace
│   ├── Spinner.tsx
│   ├── ProgressBar.tsx
│   ├── Confirm.tsx                  # Drives Runner.prompt (forwarded to focused workspace)
│   └── OutputView.tsx               # ANSI-colored, live
├── ipc/                             # (Phase 3A) typed wrapper for IPC push events
└── hooks/
    ├── useWorkspaces.ts             # AsyncIterable<WorkspaceEvent> → React state
    └── useRunner.ts                 # Single-workspace runner (used by ipc/ in Phase 3A)
```

### 5.3 UI Behaviors

- `StatusBar`: top-level — one card per discovered workspace showing state (`pending` / `resolving` / `running` / `done (N changes)` / `failed (exit N)`) and elapsed time. Highlighted card = focused workspace.
- `WorkspacePane`: detail view for the focused workspace — embedded `OutputView` (ANSI parsing via `ansi-to-react` + plan/apply key-line highlight).
- `useWorkspaces`: subscribes to the `AsyncIterable<WorkspaceEvent>` from `workspace.runner.runWorkspaces` and routes each event to the right workspace's state slot in the React tree.
- `Confirm`: a per-workspace prompt — only the focused workspace can prompt; tabbing away auto-defers (cancels with `no`) so a prompt from workspace B never blocks workspace A.
- Top-level error boundary surfaces structured errors and exit codes; on `trunner plan` failure of any workspace, the top-level exit code is `1` and the summary lists which workspace(s) failed.

### 5.4 Build & Packaging — Node.js SEA

The CLI ships as a **single, native executable per platform** — end users do not need to install Node. We use Node.js's built-in [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) (SEA) feature, which is stable in Node 26.x.

`tsup.config.ts` for the CLI (`packages/cli/tsup.config.ts`):
- `entry: 'src/trunner.tsx'` (renamed from `bin.tsx` to match bundle basename)
- `format: ['esm']` — Ink 7 + yoga-layout use TLA; esbuild cannot bundle TLA into CJS, so the CLI outputs ESM and SEA wraps it with `mainFormat: "module"`.
- `platform: 'node'`, `target: 'node26'`
- `bundle: true`, `noExternal: [/.*/]` — bundle everything, including the workspace `@trunner/sdk` and `@cdktf/hcl2json`.
- `outExtension: () => ({ js: '.mjs' })` → output is `dist/trunner.mjs`.
- `esbuildPlugins: [inlineHcl2jsonWasm]` — custom plugin that inlines `main.wasm.gz` as base64 at build time so the bundled `__dirname` shim (in the SEA binary root) does not break the WASM load. See AGENTS.md gotcha #6.
- `shims: false`, `minify: true`
- `banner: { js: '...' }` — injects `createRequire(import.meta.url)` + `__filename`/`__dirname` shims (React 19 CJS uses `require('assert')`; SDK WASM loader uses `__dirname`).
- esbuild `alias` for `react-devtools-core` and `performance` → `data:text/javascript,export default {};` (stubs that would otherwise break bundling).

Build pipeline (per platform, e.g. `packages/cli/scripts/build-sea.sh` and `build-sea.ps1`):

1. **Bundle** the CLI into a single ESM file:
   ```
   pnpm -F @trunner/cli build         # produces dist/trunner.mjs (~3.2 MB)
   ```
2. **Generate the SEA config** (`packages/cli/sea-config.json`):
   ```json
   {
     "main": "dist/trunner.mjs",
     "output": "dist/trunner.blob",
     "mainFormat": "module",
     "useCodeCache": true,
     "disableExperimentalSEAWarning": true
   }
   ```
   `mainFormat: "module"` is **required** because the SEA loader defaults to CJS. Incompatible with `useSnapshot: true`; we use `useCodeCache: true` instead.
3. **Strip any existing signature** (macOS only — the bundled Node binary is signed by HashiCorp and re-injection breaks the signature; we re-sign ad-hoc at the end):
   ```
   codesign --remove-signature dist/trunner
   ```
4. **Produce the SEA binary** with Node 25.5+'s one-step `node --build-sea` (no `postject` needed):
   ```
   node --build-sea sea-config.json    # writes dist/trunner
   ```
5. **Re-sign** the binary ad-hoc (macOS — without this the OS sends SIGKILL on launch, exit 137):
   ```
   codesign --sign - --force --deep dist/trunner
   ```
6. **(Out of POC scope)** code-sign and notarize the produced executable.

Root scripts (added to root `package.json`):
- `cli:build:sea:macos` / `cli:build:sea:linux` / `cli:build:sea:windows` — run the pipeline on the current host.
- `cli:build:sea` — convenience: detects current platform and runs the matching script.

Final artifact: **`dist/trunner` ≈ 139 MB** (macOS arm64) — dominated by the embedded Node binary, not our code.

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

**Phase 2A acceptance**: `pnpm -F @trunner/cli test` passes (14/14), `pnpm -F @trunner/cli dev` shows a working TUI shell with mock data, and `pnpm -F @trunner/cli build:sea:macos` produces a 139 MB self-contained `dist/trunner` binary. **The CLI surface shipped at this milestone is the provisional `<tool> <command>` shape** (e.g. `--mock terraform plan --auto-yes`); it is replaced by the single-verb shape in Phase 2A.5.

---

### Phase 2A.5 — CLI Surface, `.trunnerrc` & Multi-Project

**Goal**: Replace the provisional `<tool> <command>` shape with the final single-verb surface; introduce `.trunnerrc` workspace discovery; run the command against every discovered workspace in parallel with a Claude-Code-style status bar. This phase makes `trunner plan` in a monorepo do the right thing without flags. See §4.8, §4.9, and §5.1 for the full design.

**Implementation order** (each step unblocks the next):

1. **`workspace/trunner-rc.ts`** — `.trunnerrc` schema (TOML, parsed via `smol-toml`) + `parseRc(path)`. Schema: `tool` (required), `version` / `concurrency` / `exclude` (all optional). Unit tests for happy path, missing `tool`, unknown keys (warning not error). **~0.5h**
2. **`workspace/discover.ts`** — `discoverWorkspaces(cwd, { exclude })` implementing the §4.8.2 algorithm (always-skip `.git`/`.terraform`, project-boundary at `.trunnerrc`, no symlink following, no scan-up). Unit tests: single workspace, nested `.trunnerrc` (boundary), hidden `.git` skipped, exclude patterns respected, no symlink loops. **~1.5h**
3. **CLI flag plumbing** — extend `trunner.tsx` meow config with all global flags from §5.1 (`-t`, `--cwd`, `--tool-version`, `--include-prerelease`, `--mirror`, `--concurrency`, `--exclude`, `--json`, `--quiet`). Re-export from `packages/sdk/src/index.ts`. **~1h**
4. **`workspace/runner.ts`** — `runWorkspaces(workspaces, command, args, opts)` returning `AsyncIterable<WorkspaceEvent>`. Worker-pool with concurrency = `os.cpus().length` (overridable). Per-workspace: `tool.resolveAll` → spawn tool binary with `cwd = ws.dir` and `TF_CLI_CONFIG_FILE` set → stream tagged events. Failures do not abort siblings; final `done` event carries the per-workspace exit-code map. **~2h**
5. **CLI TUI** — `ui/StatusBar.tsx` (top-level card list, key-based navigation: `Tab` / `j` / `k` / arrow keys), `ui/WorkspacePane.tsx` (focused workspace detail), `hooks/useWorkspaces.ts` (subscribes to the `AsyncIterable`, routes events to React state). **~2h**
6. **Component tests** — extend `ink-testing-library` suite: 5+ tests for `StatusBar` (workspace state transitions), 3+ for `useWorkspaces` (event routing, multi-stream multiplexing). **~1h**
7. **End-to-end smoke** — create a 3-workspace fixture under a tmp dir, run `trunner plan` against it, verify all 3 run in parallel (3 progress events before any `done`), final summary lists all 3 results. **~0.5h**

**Total estimate**: ~8.5h. SDK is the bulk (steps 1, 2, 4); CLI TUI (steps 5, 6) is the rest.

- [ ] Step 1: `workspace/trunner-rc.ts` (schema + parser).
- [ ] Step 2: `workspace/discover.ts` (scan algorithm + project boundary + excludes).
- [ ] Step 3: CLI global flags (`-t`, `--cwd`, `--tool-version`, `--include-prerelease`, `--mirror`, `--concurrency`, `--exclude`, `--json`, `--quiet`).
- [ ] Step 4: `workspace/runner.ts` (worker-pool + stream multiplexing).
- [ ] Step 5: `StatusBar` + `WorkspacePane` + `useWorkspaces` TUI.
- [ ] Step 6: component tests for multi-workspace routing.
- [ ] Step 7: end-to-end smoke on a 3-workspace fixture.
- [ ] Re-export `discoverWorkspaces`, `runWorkspaces`, `Workspace`, `WorkspaceEventMap` from `packages/sdk/src/index.ts`.
- [ ] Deprecate the old `<tool> <command>` shape (remove `commands/<tool>/*.tsx` scaffolding; keep the file layout for later per-tool subcommand files in Phase 3A).
- [ ] Re-verify `pnpm -r typecheck` and `pnpm -F @trunner/sdk build` are clean.

**Phase 2A.5 acceptance**: In a tmp monorepo with three `.trunnerrc` workspaces (`team-a/api` terraform 1.6, `team-b/web` terraform 1.5, `team-c/db` opentofu), running `trunner plan` discovers all three, runs them in parallel (concurrent tool processes, status bar shows `running` per workspace), and produces a final summary with per-workspace results. `trunner plan -t opentofu` overrides every workspace's tool to opentofu. `trunner plan --concurrency 1` serializes. `trunner plan --exclude vendor` skips a `vendor/.trunnerrc` (fixture has it). The old `--mock terraform plan --auto-yes` shape is removed; the new shape is the only supported surface.

---

### Phase 2B — Smart Version Selection (SDK)

**Goal**: For each discovered workspace, trunner inspects its `required_version` + `required_providers`, resolves concrete versions (or honors the lock file), installs anything missing, and returns a `ResolvedManifest` — all without the user having to manually run `terraform init` or pin versions. This is the feature that makes `trunner <command>` truly one-shot. See §4.5 for the full design. Phase 2A.5 must be in place — the resolver is invoked per-workspace from `workspace/runner.ts`.

**Implementation order** (each step unblocks the next):

1. **`installer/constraint-set.ts`** + **`installer/version-solver.ts`** — pure logic, no I/O, exhaustive unit tests (boundary cases for `~>`, `^`, `>=`, pre-releases, empty constraint, no candidates). **~1h**
2. **`installer/hcl-walker.ts`** — walk `*.tf` at `projectDir` + recurse into `.terraform/modules/modules.json` entries. Use `@cdktf/hcl2json`. Cycle detection via visited set. **~1.5h**
3. **`installer/provider-registry.ts`** — Service Discovery Protocol (`GET /.well-known/terraform.json`) + `GET {providers.v1}/{ns}/{type}/versions` + platform filtering. Mock the network in unit tests via `vi.spyOn(globalThis, 'fetch')`. **~1.5h**
4. **`tools/base/base-binary-manager.ts`** — add `resolveVersion(ref: 'auto' | string): Promise<string>` and `listInstalled(): Promise<string[]>`. Make `binaryPath(version)` **reject `'latest'`** with a clear error. **~1h**
5. **`tools/base/base-provider-manager.ts`** — add `resolveVersion(source, constraints)` + change `ensureInstalled` to take `{source, version, platform}`. **~1.5h**
6. **`tools/base/base-tool.ts`** — implement `resolveAll(req)` per §4.5. Orchestrates steps 1–5, returns `ResolvedManifest`. **~0.5h**
7. **CLI** — add `--tool-version` / `--include-prerelease` / `--mirror` flags; rewire `app.tsx` to call `tool.resolveAll(...)` before running the user's command. **~1h**
8. **Provider mirror** — generate `~/.trunner/.terraformrc` with the `filesystem_mirror` block from §4.5.4; export `TF_CLI_CONFIG_FILE` to spawned terraform. Verify with a real `terraform init`. **~1.5h**
9. **Integration test** — `test/integration/smart-resolve.test.ts`: real terraform project with `required_version = "~> 1.5"`, one provider, no lock file → assert correct manifest, real provider binary downloaded, real `terraform plan` succeeds on a no-op config. **~1h**

**Total estimate**: ~10h. Steps 1–6 are pure SDK work and can ship behind the existing `tool.binary.binaryPath(...)` path; steps 7–8 are the CLI wiring that exposes the new behavior.

- [ ] Step 1: `version-solver.ts` + `constraint-set.ts` (pure logic, unit-tested).
- [ ] Step 2: `hcl-walker.ts` (project + module tree).
- [ ] Step 3: `provider-registry.ts` (Service Discovery + versions API).
- [ ] Step 4: `BaseBinaryManager.resolveVersion` / `listInstalled`; `binaryPath` rejects `'latest'`.
- [ ] Step 5: `BaseProviderManager.resolveVersion`; `ensureInstalled({source, version, platform})`.
- [ ] Step 6: `BaseTool.resolveAll` orchestrator returning `ResolvedManifest`.
- [ ] Step 7: rewire `workspace/runner.ts` to call `tool.resolveAll(...)` per workspace before spawning the tool binary; thread `--tool-version` / `--include-prerelease` / `--mirror` from CLI through.
- [ ] Step 8: provider mirror via generated `~/.trunner/.terraformrc` + `TF_CLI_CONFIG_FILE` (per workspace).
- [ ] Step 9: `test/integration/smart-resolve.test.ts` — end-to-end on a real terraform project inside a 3-workspace fixture, exercising the multi-workspace path.
- [ ] Re-export new types (`PlatformInfo`, `ResolvedManifest`) from `packages/sdk/src/index.ts`.
- [ ] Re-verify `pnpm -r typecheck` and `pnpm -F @trunner/sdk build` are clean.

**Phase 2B acceptance**: With a fresh `~/.trunner` (no terraform installed), running `trunner plan` from a monorepo whose workspaces declare `required_version = "~> 1.5"` and `hashicorp/aws ~> 5.34` discovers every workspace, downloads a compatible terraform binary and the right provider for darwin_arm64 into each workspace's mirror, and runs `plan` to completion — all workspaces report `No changes` in the final summary. With a lock file present in any workspace, the locked version is used verbatim without re-solving. The CLI `--tool-version=1.6.6` flag pins the binary version for every workspace regardless of `required_version`. `--json` emits one structured event per workspace.

---

### Phase 2C — Desktop UI Shell

**Goal**: An Electron + Vite + React + Tailwind + Zustand app with all views in place and IPC plumbing verified end-to-end against a mock event source, mirroring the multi-workspace status-bar model from Phase 2A.5 in React. (Renumbered from the original Phase 2B once Phase 2A.5 and Phase 2B's smart version selection were added in front of it.)

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

**Phase 2C acceptance**: `pnpm -F @trunner/desktop dev` launches the app, all 5 views render, mock run streams to `OutputPanel`, and IPC roundtrips succeed.

---

### Phase 3A — CLI Features

**Goal**: Replace the CLI mocks with real SDK calls; ship a working `trunner` CLI for Terraform workflows. Assumes Phase 2B's smart version selection and Phase 2A.5's single-verb / multi-workspace surface are in place. The only `commands/<tool>/*.tsx` files that survive from Phase 2A are the ones implementing `trunner tools` and `trunner providers` (the management commands); the `trunner <verb>` form goes through `workspace.runner` directly.

- [ ] Wire `commands/tools.tsx` to SDK `ToolRegistry` (`list`, `install`, `use`, `uninstall`) — exposed as `trunner tools`.
- [ ] Wire `commands/providers.tsx` to SDK provider manager (`list`, `install`) — exposed as `trunner providers`.
- [ ] Wire per-verb confirmation hooks: `trunner apply`, `trunner destroy` need a `Confirm` driven by the focused workspace's `prompt` event.
- [ ] Add `trunner tools install <name> [version]` and `trunner providers install <source>` as real SDK calls (currently stubbed in 2A.5).
- [ ] Implement `--json` and `--quiet` output flags end-to-end (already declared in 2A.5; wire to actual stream).
- [ ] Structured error formatting and consistent exit codes (including `ResolveError` from Phase 2B, `WorkspaceNotFoundError`, `NoToolSpecifiedError`).
- [ ] End-to-end CLI tests via `zx` shell harness (subprocess invocation, assert stdout/exit code) — include a 3-workspace fixture test.
- [ ] Verify `pnpm -F @trunner/cli build:sea` produces a working single-file executable on macOS, Linux, and Windows; smoke-test each (`--version`, `tools`, real `plan` on a cold `~/.trunner` with a multi-workspace fixture).
- [ ] Add a GitHub Actions matrix job that runs the SEA build per platform and uploads the executable as a build artifact.
- [ ] README with usage examples for every command, including the multi-workspace flow.

**Phase 3A acceptance**: All Terraform subcommands work end-to-end against a real Terraform binary, the multi-workspace e2e harness passes on macOS, Linux, and Windows, and a cold-cache `trunner plan` against a 3-workspace monorepo fixture downloads and installs the right tool + providers and runs to completion in parallel.

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

## 8. Extensibility Plan for OpenTofu

- **OpenTofu** (peer `Tool`):
  - Reuse `BaseTool`, `BaseBinaryManager`, `BaseProviderManager`, and the Phase 2B smart resolver primitives.
  - New `tools/opentofu/` folder: download from `github.com/opentofu/opentofu` releases.
  - Commands and provider behavior are nearly 1:1 with Terraform; the Registry API uses the same shape, so `installer/provider-registry.ts` is reusable.
  - Add one line: `registry.register('opentofu', () => new OpenTofuTool())`.
- **Any new tool** only needs to satisfy the `Tool` interface (including `resolveAll`) and register itself — CLI/Desktop UI and IPC are unaffected.
- **Terragrunt is explicitly out of scope** (see §1). It would warrant its own design pass: the dependency-graph resolution model, remote state config, and DRY include semantics are not a small extension on top of the Terraform model.

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
| **Provider mirror path layout** (Phase 2B) | `filesystem_mirror` lookup is strict; §4.5.4 pins the layout to `~/.trunner/providers/<ns>/<type>/terraform-provider-<ns>-<type>_<v>_<os>_<arch>` exactly. Layout is covered by a unit test against a known-good fixture from `terraform init`. |
| **Remote Service Discovery Protocol compliance** (Phase 2B) | Always `GET .well-known/terraform.json` first; honor the returned `providers.v1` URL. This is mandatory for protocol compliance and TFE compatibility. Hard-fail at startup if the well-known endpoint is unreachable. |
| **Lock file is ground truth** (Phase 2B) | If `.terraform.lock.hcl` pins a provider, skip the solver for that provider. User updates the lock file (`terraform init -upgrade`) — trunner does not mutate it. |
| **Pre-release versions slipping into stable picks** (Phase 2B) | Solver's default policy is "highest stable only" (per `semver` `prerelease: undefined` filter). `--include-prerelease` is opt-in. |
| **CLI flag clash with `trunner --version`** | Tool version pinning uses `--tool-version`, not `--version`. `--version` always prints the trunner version (no auto-resolve). |
| **Hidden `.trunnerrc` in vendored deps** (Phase 2A.5) | The scan always skips `.git` and `.terraform`; the recursive walk also skips `node_modules`, `vendor`, `dist`, `target`, `.next`, `.venv`, `.idea`, `.vscode` by default (configurable via `.trunnerrc`'s `exclude` field and CLI `--exclude`). Unit tests cover the common patterns. |
| **Resource exhaustion with many workspaces** (Phase 2A.5) | Worker-pool concurrency defaults to `os.cpus().length`; `--concurrency` and `.trunnerrc` `concurrency` cap it. A unit test asserts the cap is respected when 10+ fixtures are queued. |
| **Cross-workspace state contention** (Phase 2A.5) | trunner does not detect or prevent this; documented as user responsibility (§1 non-goal). If two workspaces in the same monorepo share a state backend, the user passes `--concurrency 1` or relies on the backend's lock. |
| **Project-boundary false positives** (Phase 2A.5) | The scan stops descending at the first `.trunnerrc` (a "project boundary"). This is the right call 99% of the time but means a nested sub-`.trunnerrc` won't be discovered. Documented; future escape hatch via `--recurse-into-workspaces` if anyone actually needs it. |
| **`.trunnerrc` schema drift across workspaces** (Phase 2A.5) | A 3-workspace fixture in Phase 2A.5 step 7 covers the basic case. TOML parse errors are per-file fatal (one bad `.trunnerrc` blocks its workspace, not the whole scan). Unknown keys produce a warning, not an error, for forward-compat. |

---

## 11. Milestones Summary

- **M1 — Phase 1 complete**: `@trunner/sdk` publishable, tested, runs real Terraform end-to-end.
- **M2 — Phase 2A complete**: CLI TUI shell renders and consumes mock runners; SEA pipeline produces a working single-file binary. *(Provisional `<tool> <command>` shape ships here; superseded in M2.5.)*
- **M2.5 — Phase 2A.5 complete**: New single-verb surface, `.trunnerrc` discovery, multi-workspace parallel execution with status bar — `trunner plan` in a monorepo discovers and runs against every workspace in parallel.
- **M3 — Phase 2B complete**: Smart version selection works end-to-end per workspace — `trunner plan` against a cold `~/.trunner` downloads and installs the right tool + providers for every discovered workspace in one shot.
- **M4 — Phase 2C complete**: Desktop UI shell renders and consumes mock runners, mirroring the multi-workspace model in React.
- **M5 — Phase 3A complete**: Production-grade CLI for Terraform workflows, wired to the real SDK (including the smart resolver and the management commands `trunner tools` / `trunner providers`).
- **M6 — Phase 3B complete**: Production-grade Desktop app for Terraform workflows on macOS/Linux/Windows.
- **M7 (post-POC)**: OpenTofu implementation, leveraging the same `Tool` abstraction and the Phase 2A.5 / 2B primitives.
