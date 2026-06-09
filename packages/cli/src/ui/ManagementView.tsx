import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TerraformBinaryManager, TerraformProviderManager } from '@trunner/sdk';

export interface ManagementViewProps {
  tool: string;
  target: 'tools' | 'providers';
  width: number;
  height: number;
  onExit: () => void;
}

type ManagementAction = 'list' | 'install' | 'uninstall';

export function ManagementView({ tool, target, width, height, onExit }: ManagementViewProps): React.ReactElement {
  const [action, setAction] = useState<ManagementAction>('list');
  const [actionIndex, setActionIndex] = useState(0);
  const [items, setItems] = useState<Array<{ name: string; version?: string; path?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [inputVersion, setInputVersion] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);

  const actions: ManagementAction[] = target === 'tools'
    ? ['list', 'install', 'uninstall']
    : ['list', 'install'];

  useEffect(() => {
    loadItems();
  }, [tool, target]);

  const loadItems = async () => {
    setLoading(true);
    try {
      if (target === 'tools') {
        const manager = new TerraformBinaryManager();
        const installed = await manager.listInstalled();
        setItems(installed.map(v => ({ name: v, version: v })));
      } else {
        const manager = new TerraformProviderManager();
        const installed = await manager.listInstalled();
        setItems(installed.map(p => ({ name: p.source, version: p.version, path: p.path })));
      }
    } catch (err) {
      setStatusMessage(`Error loading items: ${(err as Error).message}`);
    }
    setLoading(false);
  };

  const handleInput = useCallback(
    (input: string, key: { return: boolean; upArrow: boolean; downArrow: boolean; escape: boolean }) => {
      if (key.escape) {
        onExit();
        return;
      }

      if (key.return) {
        if (action === 'list') {
          loadItems();
        } else if (action === 'install' && inputVersion && !isInstalling) {
          handleInstall();
        }
        return;
      }

      if (key.upArrow) {
        setActionIndex(Math.max(0, actionIndex - 1));
        setAction(actions[Math.max(0, actionIndex - 1)]!);
      } else if (key.downArrow) {
        setActionIndex(Math.min(actions.length - 1, actionIndex + 1));
        setAction(actions[Math.min(actions.length - 1, actionIndex + 1)]!);
      } else if (action === 'install') {
        setInputVersion(prev => prev + input);
      }
    },
    [action, actionIndex, inputVersion, isInstalling, actions],
  );

  const handleInstall = async () => {
    if (!inputVersion) return;
    setIsInstalling(true);
    setStatusMessage(`Installing ${target === 'tools' ? 'tool' : 'provider'} ${inputVersion}...`);
    try {
      if (target === 'tools') {
        const manager = new TerraformBinaryManager();
        await manager.ensureInstalled({ version: inputVersion });
      } else {
        const manager = new TerraformProviderManager();
        await manager.install({ source: inputVersion, version: 'latest' });
      }
      setStatusMessage(`Successfully installed ${inputVersion}`);
      setInputVersion('');
      await loadItems();
    } catch (err) {
      setStatusMessage(`Error: ${(err as Error).message}`);
    }
    setIsInstalling(false);
  };

  useInput(handleInput, { isActive: true });

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        width={width}
      >
        <Text bold color="magenta">trunner</Text>
        <Text dimColor> │ </Text>
        <Text bold>{target === 'tools' ? 'Tool Management' : 'Provider Management'}</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{tool}</Text>
      </Box>

      {/* Actions menu */}
      <Box
        borderStyle="single"
        borderColor="magenta"
        paddingX={1}
        marginTop={1}
        width={40}
      >
        <Box flexDirection="column">
          <Text bold>Actions:</Text>
          {actions.map((act, i) => (
            <Text key={act}>
              {i === actionIndex ? <Text color="green">▶ </Text> : <Text>  </Text>}
              {i === actionIndex ? <Text bold>{act}</Text> : <Text dimColor>{act}</Text>}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Install input */}
      {action === 'install' && (
        <Box
          borderStyle="single"
          borderColor="magenta"
          paddingX={1}
          marginTop={1}
          width={width}
        >
          <Box flexDirection="column">
            <Text bold>
              {target === 'tools' ? 'Enter version to install:' : 'Enter provider source (e.g., hashicorp/aws):'}
            </Text>
            <Text>
              <Text color="green">{'>'} </Text>
              <Text>{inputVersion}</Text>
              <Text color="green">_</Text>
            </Text>
            {isInstalling && <Text color="yellow">Installing...</Text>}
          </Box>
        </Box>
      )}

      {/* Items list */}
      <Box
        borderStyle="single"
        borderColor="magenta"
        paddingX={1}
        marginTop={1}
        flexGrow={1}
        width={width}
      >
        <Box flexDirection="column">
          <Text bold>
            Installed {target === 'tools' ? 'tools' : 'providers'} ({items.length}):
          </Text>
          {loading ? (
            <Text dimColor>Loading...</Text>
          ) : items.length === 0 ? (
            <Text dimColor>No {target} installed</Text>
          ) : (
            items.map((item, i) => (
              <Text key={`${item.name}-${item.version}`}>
                <Text color="cyan">{item.name}</Text>
                {item.version && <Text dimColor> @ {item.version}</Text>}
              </Text>
            ))
          )}
        </Box>
      </Box>

      {/* Status message */}
      {statusMessage && (
        <Box
          borderStyle="round"
          borderColor="magenta"
          paddingX={1}
          marginTop={1}
          width={width}
        >
          <Text color={statusMessage.startsWith('Error') ? 'red' : 'green'}>{statusMessage}</Text>
        </Box>
      )}

      {/* Status bar */}
      <Box paddingX={1} width={width}>
        <Text dimColor>↑/↓ navigate │ Enter select/confirm │ Esc exit │ {isInstalling ? 'Installing...' : 'Ready'}</Text>
      </Box>
    </Box>
  );
}
