import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { BaseProviderManager, TerraformProviderManager, OpenTofuProviderManager, getPlatformInfo, type ProgressInfo } from '@trunner/sdk';
import { Modal } from './Modal.js';
import { DownloadProgress } from './DownloadProgress.js';
import { TabBar } from './TabBar.js';
import { ScrollableList } from './ScrollableList.js';

export interface ProviderManagementViewProps {
  tool: 'terraform' | 'opentofu';
  width: number;
  height: number;
  onExit: () => void;
}

type Tab = 'installed' | 'install';
type ViewPhase = 'loading' | 'list' | 'input' | 'searching' | 'versions' | 'modal' | 'installing' | 'uninstalling';

export function ProviderManagementView({ tool, width, height, onExit }: ProviderManagementViewProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>('installed');
  const [phase, setPhase] = useState<ViewPhase>('loading');
  const [installedProviders, setInstalledProviders] = useState<Array<{ source: string; version: string; path: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [inputSource, setInputSource] = useState('');
  const [availableVersions, setAvailableVersions] = useState<Array<{ version: string; installed: boolean }>>([]);
  const [versionSelectedIndex, setVersionSelectedIndex] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<ProgressInfo | null>(null);

  const manager: BaseProviderManager = useMemo(
    () => tool === 'terraform' ? new TerraformProviderManager() : new OpenTofuProviderManager(),
    [tool],
  );

  useEffect(() => {
    loadInstalled();
  }, []);

  const loadInstalled = async () => {
    setPhase('loading');
    setStatusMessage(null);
    try {
      const installed = await manager.listInstalled();
      setInstalledProviders(installed);
      setSelectedIndex(0);
      setPhase('list');
    } catch (err) {
      setStatusMessage(`Error loading providers: ${(err as Error).message}`);
      setPhase('list');
    }
  };

  const handleSearch = async () => {
    if (!inputSource.includes('/')) {
      setStatusMessage('Invalid source format. Use namespace/type (e.g., grafana/grafana)');
      return;
    }
    setPhase('searching');
    setStatusMessage(null);
    try {
      const versions = await manager.listAvailable({ source: inputSource });
      setAvailableVersions(versions);
      setVersionSelectedIndex(0);
      setPhase('versions');
    } catch (err) {
      setStatusMessage(`Error searching: ${(err as Error).message}`);
      setPhase('input');
    }
  };

  const handleInstall = async (source: string, version: string) => {
    setPhase('installing');
    setStatusMessage(null);
    setDownloadProgress(null);
    try {
      await manager.install({
        source,
        version,
        onProgress: (info: ProgressInfo) => setDownloadProgress(info),
      });
      setDownloadProgress(null);
      setStatusMessage(`Installed ${source} ${version}`);
      setInputSource('');
      await loadInstalled();
    } catch (err) {
      setDownloadProgress(null);
      setStatusMessage(`Error installing: ${(err as Error).message}`);
      setPhase('versions');
    }
  };

  const handleUninstall = async (source: string, version: string) => {
    setPhase('uninstalling');
    setStatusMessage(`Uninstalling ${source} ${version}...`);
    try {
      const pluginDir = manager.pluginDir(source, version);
      const { removeIfExists } = await import('@trunner/sdk');
      await removeIfExists(pluginDir);
      setStatusMessage(`Uninstalled ${source} ${version}`);
      await loadInstalled();
    } catch (err) {
      setStatusMessage(`Error uninstalling: ${(err as Error).message}`);
      setPhase('list');
    }
  };

  const handleInput = useCallback(
    (input: string, key: { return: boolean; upArrow: boolean; downArrow: boolean; escape: boolean; leftArrow: boolean; rightArrow: boolean; backspace: boolean; delete: boolean }) => {
      if (phase === 'loading' || phase === 'installing' || phase === 'uninstalling' || phase === 'searching') return;

      // Tab switching - always allow unless in modal
      if (phase !== 'modal') {
        if (key.leftArrow) {
          setTab('installed');
          setPhase('list');
          return;
        }
        if (key.rightArrow) {
          setTab('install');
          setPhase('input');
          return;
        }
      }

      if (key.escape) {
        if (phase === 'modal') {
          setPhase(tab === 'installed' ? 'list' : 'versions');
        } else if (phase === 'input') {
          if (inputSource.length > 0) {
            setInputSource((prev) => prev.slice(0, -1));
          } else {
            setTab('installed');
            setPhase('list');
          }
        } else if (phase === 'versions') {
          setPhase('input');
        } else {
          onExit();
        }
        return;
      }

      if (tab === 'installed' && phase === 'list') {
        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(installedProviders.length - 1, prev + 1));
        } else if (key.return && installedProviders.length > 0) {
          setPhase('modal');
        }
        return;
      }

      if (tab === 'install' && phase === 'input') {
        if (key.return) {
          handleSearch();
        } else if (key.backspace || key.delete) {
          setInputSource((prev) => prev.slice(0, -1));
        } else if (input.length > 0) {
          setInputSource((prev) => prev + input);
        }
        return;
      }

      if (tab === 'install' && phase === 'versions') {
        if (key.upArrow) {
          setVersionSelectedIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setVersionSelectedIndex((prev) => Math.min(availableVersions.length - 1, prev + 1));
        } else if (key.return && availableVersions.length > 0) {
          const selected = availableVersions[versionSelectedIndex];
          if (selected) {
            handleInstall(inputSource, selected.version);
          }
        }
        return;
      }
    },
    [phase, tab, installedProviders, selectedIndex, availableVersions, versionSelectedIndex, inputSource, onExit],
  );

  useInput(handleInput, { isActive: true });

  const selectedProvider = installedProviders[selectedIndex];
  const selectedVersionItem = availableVersions[versionSelectedIndex];

  const uninstallModalOptions = [
    { label: 'Uninstall', variant: 'danger' as const },
    { label: 'Cancel', variant: 'default' as const },
  ];

  // Calculate how many versions to show based on terminal height
  const maxVisibleVersions = Math.max(5, height - 12);

  const tabs = [
    { label: 'Installed Providers' },
    { label: 'Install Provider' },
  ];

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Tab bar with purple border */}
      <TabBar
        tabs={tabs}
        activeIndex={tab === 'installed' ? 0 : 1}
        suffix={<Text dimColor>{tool}</Text>}
        width={width}
      />

      {/* Content with purple border */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="magenta"
        paddingX={1}
        width={width}
        flexGrow={1}
      >
        {phase === 'loading' && (
          <Box marginTop={1}>
            <Text color="yellow">Loading installed providers...</Text>
          </Box>
        )}

        {/* Installed Providers tab */}
        {tab === 'installed' && (phase === 'list' || phase === 'modal') && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Installed providers ({installedProviders.length}):</Text>
            </Box>
            {installedProviders.length === 0 ? (
              <Text dimColor>No providers installed</Text>
            ) : (
              <ScrollableList
                items={installedProviders}
                selectedIndex={selectedIndex}
                maxVisible={maxVisibleVersions}
                renderItem={(p, _index, isActive) => (
                  <Text key={`${p.source}-${p.version}`}>
                    {isActive ? <Text color="green">▶ </Text> : <Text>  </Text>}
                    <Text color="cyan">{p.source}</Text>
                    <Text dimColor> @ {p.version}</Text>
                  </Text>
                )}
              />
            )}
          </Box>
        )}

        {/* Install Provider tab - Input */}
        {tab === 'install' && (phase === 'input' || phase === 'searching') && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Enter provider source (e.g., grafana/grafana):</Text>
            </Box>
            <Text>
              <Text color="green">{'>'} </Text>
              <Text>{inputSource}</Text>
              <Text color="green">_</Text>
            </Text>
            <Box marginTop={1}>
              <Text dimColor>Press <Text bold>Enter</Text> to search, <Text bold>Esc</Text> to delete/go back</Text>
            </Box>
          </Box>
        )}

        {/* Install Provider tab - Versions */}
        {tab === 'install' && phase === 'versions' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Available versions for {inputSource} ({availableVersions.length}):</Text>
            </Box>
            {availableVersions.length === 0 ? (
              <Text dimColor>No versions found</Text>
            ) : (
              <ScrollableList
                items={availableVersions}
                selectedIndex={versionSelectedIndex}
                maxVisible={maxVisibleVersions}
                renderItem={(v, _index, isActive) => (
                  <Text key={v.version}>
                    {isActive ? <Text color="green">▶ </Text> : <Text>  </Text>}
                    {isActive ? (
                      <Text bold>{v.version}</Text>
                    ) : (
                      <Text dimColor>{v.version}</Text>
                    )}
                    {v.installed && (
                      <Text color="green"> Installed</Text>
                    )}
                  </Text>
                )}
              />
            )}
            <Box marginTop={1}>
              <Text dimColor>Press <Text bold>Enter</Text> to install, <Text bold>Esc</Text> to go back</Text>
            </Box>
          </Box>
        )}

        {/* Status message */}
        {statusMessage && (
          <Box marginTop={1}>
            <Text color={statusMessage.startsWith('Error') ? 'red' : 'green'}>{statusMessage}</Text>
          </Box>
        )}

        {/* Modal overlay - Uninstall */}
        {phase === 'modal' && selectedProvider && (
          <Box position="absolute" top={0} left={0} right={0} bottom={0} alignItems="center" justifyContent="center">
            <Modal
              title={`Uninstall ${selectedProvider.source} ${selectedProvider.version}?`}
              options={uninstallModalOptions}
              onSelect={(index) => {
                const option = uninstallModalOptions[index];
                if (option?.label === 'Uninstall') {
                  handleUninstall(selectedProvider.source, selectedProvider.version);
                } else {
                  setPhase('list');
                }
              }}
              onCancel={() => setPhase('list')}
            />
          </Box>
        )}
      </Box>

      {/* Progress bar - fixed at bottom */}
      {(phase === 'installing' || phase === 'uninstalling') && (
        <Box paddingX={1} width={width}>
          {phase === 'installing' ? (
            <DownloadProgress
              current={downloadProgress?.current ?? 0}
              total={downloadProgress?.total ?? 0}
              label="Downloading provider..."
              width={width - 2}
            />
          ) : (
            <Text color="yellow">Uninstalling...</Text>
          )}
        </Box>
      )}

      {/* Status bar without border */}
      <Box
        flexDirection="row"
        paddingX={1}
        width={width}
      >
        <Text dimColor>
          ←/→ switch tabs │ ↑/↓ navigate │ Enter select │ Esc {phase === 'modal' ? 'cancel' : 'exit'}
          {(phase === 'installing' || phase === 'uninstalling') ? ' │ Processing...' : ''}
        </Text>
      </Box>
    </Box>
  );
}
