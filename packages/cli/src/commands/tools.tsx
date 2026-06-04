import { getDefaultRegistry } from '@trunner/sdk';

export type ToolsAction =
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'install'; name: string; version?: string }
  | { kind: 'use'; name: string }
  | { kind: 'uninstall'; name: string; version: string };

export async function renderToolsCommand(
  positionals: string[],
  rawFlags: Record<string, unknown>,
): Promise<void> {
  const action = parseAction(positionals);
  if (action.kind === 'help') {
    printHelp();
    return;
  }
  if (action.kind === 'install') {
    console.error(`trunner tools install ${action.name}${action.version ? ` ${action.version}` : ''}: not yet implemented (Phase 3A)`);
    process.exit(1);
    return;
  }
  if (action.kind === 'use') {
    console.error(`trunner tools use ${action.name}: not yet implemented (Phase 3A)`);
    process.exit(1);
    return;
  }
  if (action.kind === 'uninstall') {
    console.error(`trunner tools uninstall ${action.name} ${action.version}: not yet implemented (Phase 3A)`);
    process.exit(1);
    return;
  }
  if (action.kind === 'list') {
    const json = rawFlags.json === true;
    await listTools(json);
  }
}

function parseAction(positionals: string[]): ToolsAction {
  const sub = positionals[1];
  if (!sub || sub === 'list') return { kind: 'list' };
  if (sub === 'install') {
    const name = positionals[2];
    if (!name) return { kind: 'help' };
    const version = positionals[3];
    return version ? { kind: 'install', name, version } : { kind: 'install', name };
  }
  if (sub === 'use') {
    const name = positionals[2];
    if (!name) return { kind: 'help' };
    return { kind: 'use', name };
  }
  if (sub === 'uninstall') {
    const name = positionals[2];
    const version = positionals[3];
    if (!name || !version) return { kind: 'help' };
    return { kind: 'uninstall', name, version };
  }
  return { kind: 'help' };
}

async function listTools(json: boolean): Promise<void> {
  const reg = getDefaultRegistry();
  const tools = reg.list();
  if (json) {
    const data = await Promise.all(
      tools.map(async (id) => {
        const tool = reg.get(id);
        const installed = await tool.binary.listInstalled();
        return { id, displayName: tool.displayName, installed };
      }),
    );
    for (const row of data) {
      console.log(JSON.stringify(row));
    }
    return;
  }
  if (tools.length === 0) {
    console.log('(no tools registered)');
    return;
  }
  for (const id of tools) {
    const tool = reg.get(id);
    const installed = await tool.binary.listInstalled();
    console.log(`${id} (${tool.displayName})`);
    if (installed.length === 0) {
      console.log('  (no versions installed)');
    } else {
      for (const v of installed) console.log(`  ${v}`);
    }
  }
}

function printHelp(): void {
  console.log(`Usage: trunner tools <subcommand> [args]

Subcommands:
  list                      List installed tools and their versions (default)
  install <name> [version]  Install a tool binary
  use <name>                Set the active tool
  uninstall <name> <ver>    Remove an installed binary`);
}
