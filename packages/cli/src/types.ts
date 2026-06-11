export type CliSubcommand = 'tools' | 'providers' | 'config';

export interface CliFlags {
  tool?: string;
  cwd: string;
  toolVersion?: string;
  includePrerelease: boolean;
  mirror?: string;
  concurrency?: number;
  excludeWorkingDirs?: string;
  json: boolean;
  quiet: boolean;
  autoApprove: boolean;
  color: boolean;
  altScreen: boolean;
}
