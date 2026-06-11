import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { BaseBinaryManager, TerraformBinaryManager, OpenTofuBinaryManager, type ProgressInfo } from '@trunner/sdk';
import { Modal } from './Modal.js';
import { DownloadProgress } from './DownloadProgress.js';

export interface BinaryManagementViewProps {
  tool: 'terraform' | 'opentofu';
  width: number;
  height: number;
  onExit: () => void;
}

type ViewPhase = 'loading' | 'list' | 'modal' | 'installing' | 'uninstalling';

export function BinaryManagementView({ tool, width, height, onExit }: BinaryManagementViewProps): React.ReactElement {
  const [phase, setPhase] = useState<ViewPhase>('loading');
  const [versions, setVersions] = useState<Array<{ version: string; installed: boolean }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<ProgressInfo | null>(null);

  const manager: BaseBinaryManager = useMemo(
    () => tool === 'terraform' ? new TerraformBinaryManager() : new OpenTofuBinaryManager(),
    [tool],
  );

  useEffect(() => {
    loadVersions();
  }, []);

  const loadVersions = async () => {
    setPhase('loading');
    setStatusMessage(null);
    try {
      const available = await manager.listAvailable();
      setVersions(available);
      setSelectedIndex(0);
      setPhase('list');
    } catch (err) {
      setStatusMessage(`Error: ${(err as Error).message}`);
      setPhase('list');
    }
  };

  const handleInstall = async (version: string) => {
    setPhase('installing');
    setStatusMessage(null);
    setDownloadProgress(null);
    try {
      await manager.ensureInstalled({
        version,
        force: true,
        onProgress: (info: ProgressInfo) => setDownloadProgress(info),
      });
      setDownloadProgress(null);
      setStatusMessage(`Installed ${tool} ${version}`);
      await loadVersions();
    } catch (err) {
      setDownloadProgress(null);
      setStatusMessage(`Error installing: ${(err as Error).message}`);
      setPhase('list');
    }
  };

  const handleUninstall = async (version: string) => {
    setPhase('uninstalling');
    setStatusMessage(`Uninstalling ${tool} ${version}...`);
    try {
      await manager.uninstall(version);
      setStatusMessage(`Uninstalled ${tool} ${version}`);
      await loadVersions();
    } catch (err) {
      setStatusMessage(`Error uninstalling: ${(err as Error).message}`);
      setPhase('list');
    }
  };

  const handleInput = useCallback(
    (_input: string, key: { return: boolean; upArrow: boolean; downArrow: boolean; escape: boolean }) => {
      if (phase === 'loading' || phase === 'installing' || phase === 'uninstalling') return;

      if (key.escape) {
        if (phase === 'modal') {
          setPhase('list');
        } else {
          onExit();
        }
        return;
      }

      if (phase === 'modal') return;

      if (phase === 'list') {
        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(versions.length - 1, prev + 1));
        } else if (key.return && versions.length > 0) {
          setPhase('modal');
        }
      }
    },
    [phase, versions.length, onExit],
  );

  useInput(handleInput, { isActive: true });

  const selectedVersion = versions[selectedIndex]?.version;

  const modalOptions = useMemo(() => {
    if (!selectedVersion) return [];
    const selected = versions.find((v) => v.version === selectedVersion);
    const options: Array<{ label: string; variant: 'default' | 'danger' | 'success' }> = [];
    if (selected?.installed) {
      options.push({ label: 'Uninstall', variant: 'danger' });
    } else {
      options.push({ label: 'Install', variant: 'success' });
    }
    options.push({ label: 'Cancel', variant: 'default' });
    return options;
  }, [selectedVersion, versions]);

  // Calculate how many versions to show based on terminal height
  const maxVisibleVersions = Math.max(5, height - 10);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="magenta">trunner</Text>
        <Text dimColor> │ </Text>
        <Text bold>Tool Binary Management</Text>
        <Text dimColor> │ </Text>
        <Text dimColor>{tool}</Text>
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column">
        {phase === 'loading' && (
          <Box marginTop={1}>
            <Text color="yellow">Fetching version information...</Text>
          </Box>
        )}

        {phase !== 'loading' && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold>Available versions ({versions.length}):</Text>
            </Box>
            <Box flexDirection="column">
              {versions.slice(0, maxVisibleVersions).map((v, i) => {
                const isActive = i === selectedIndex;
                return (
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
                );
              })}
              {versions.length > maxVisibleVersions && (
                <Text dimColor>  ... and {versions.length - maxVisibleVersions} more versions</Text>
              )}
            </Box>
          </Box>
        )}

        {/* Status message */}
        {statusMessage && (
          <Box marginTop={1}>
            <Text color={statusMessage.startsWith('Error') ? 'red' : 'green'}>{statusMessage}</Text>
          </Box>
        )}

        {/* Modal overlay */}
        {phase === 'modal' && selectedVersion && (
          <Box position="absolute" top={0} left={0} right={0} bottom={0} alignItems="center" justifyContent="center">
            <Modal
              title={`Action for ${tool} ${selectedVersion}:`}
              options={modalOptions}
              onSelect={(index) => {
                const option = modalOptions[index];
                if (option?.label === 'Install') {
                  handleInstall(selectedVersion);
                } else if (option?.label === 'Uninstall') {
                  handleUninstall(selectedVersion);
                } else {
                  setPhase('list');
                }
              }}
              onCancel={() => setPhase('list')}
            />
          </Box>
        )}

        {/* Installing / Uninstalling overlay */}
        {(phase === 'installing' || phase === 'uninstalling') && (
          <Box marginTop={1} flexDirection="column">
            {phase === 'installing' ? (
              <DownloadProgress
                current={downloadProgress?.current ?? 0}
                total={downloadProgress?.total ?? 0}
                label={`Downloading ${tool}...`}
                width={width - 2}
              />
            ) : (
              <Text color="yellow">Uninstalling...</Text>
            )}
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box marginTop={1} paddingTop={1}>
        <Text dimColor>
          ↑/↓ navigate │ Enter select │ Esc {phase === 'modal' ? 'cancel' : 'exit'}
          {(phase === 'installing' || phase === 'uninstalling') ? ' │ Processing...' : ''}
        </Text>
      </Box>
    </Box>
  );
}
