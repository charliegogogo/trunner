import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getPaths } from '@trunner/sdk';

export type ProvidersAction =
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'install'; source: string };

export async function renderProvidersCommand(
  positionals: string[],
  rawFlags: Record<string, unknown>,
): Promise<void> {
  const action = parseAction(positionals);
  if (action.kind === 'help') {
    printHelp();
    return;
  }
  if (action.kind === 'install') {
    console.error(`trunner providers install ${action.source}: not yet implemented (Phase 3A)`);
    process.exit(1);
    return;
  }
  if (action.kind === 'list') {
    const json = rawFlags.json === true;
    await listProviders(json);
  }
}

function parseAction(positionals: string[]): ProvidersAction {
  const sub = positionals[1];
  if (!sub || sub === 'list') return { kind: 'list' };
  if (sub === 'install') {
    const source = positionals[2];
    if (!source) return { kind: 'help' };
    return { kind: 'install', source };
  }
  return { kind: 'help' };
}

interface ProviderEntry {
  source: string;
  versions: string[];
}

async function listInstalledProviders(): Promise<ProviderEntry[]> {
  const paths = getPaths();
  const root = join(paths.providers, 'terraform', 'plugins', 'registry.terraform.io');
  const out: ProviderEntry[] = [];
  let namespaces: string[];
  try {
    namespaces = await readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  for (const ns of namespaces) {
    const nsDir = join(root, ns);
    let types: string[];
    try {
      types = await readdir(nsDir);
    } catch {
      continue;
    }
    for (const type of types) {
      const typeDir = join(nsDir, type);
      let versions: string[];
      try {
        versions = (await readdir(typeDir)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      } catch {
        continue;
      }
      out.push({ source: `${ns}/${type}`, versions });
    }
  }
  return out;
}

async function listProviders(json: boolean): Promise<void> {
  const entries = await listInstalledProviders();
  if (json) {
    for (const e of entries) console.log(JSON.stringify(e));
    return;
  }
  if (entries.length === 0) {
    console.log('(no providers installed)');
    return;
  }
  for (const e of entries) {
    console.log(`${e.source}`);
    for (const v of e.versions) console.log(`  ${v}`);
  }
}

function printHelp(): void {
  console.log(`Usage: trunner providers <subcommand> [args]

Subcommands:
  list                    List installed providers (default)
  install <source>        Install a provider (e.g. hashicorp/aws)`);
}
