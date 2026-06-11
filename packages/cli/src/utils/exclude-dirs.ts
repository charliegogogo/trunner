import { resolve as resolvePath, relative as relativePath, normalize } from 'node:path';
import type { WorkingDir } from '@trunner/sdk';

/**
 * Parse the --exclude-working-dirs flag value into an array of relative paths.
 * Handles comma-separated values and normalizes path separators for cross-platform support.
 *
 * @param excludeWorkingDirs - Comma-separated string of relative paths (e.g. "dir1,dir2/subdir")
 * @returns Array of normalized relative paths
 */
export function parseExcludeWorkingDirs(excludeWorkingDirs: string | undefined): string[] {
  if (!excludeWorkingDirs || excludeWorkingDirs.trim() === '') {
    return [];
  }

  return excludeWorkingDirs
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => normalize(p));
}

/**
 * Filter working directories based on excluded relative paths.
 * Compares the absolute path of each working directory against the resolved excluded paths.
 *
 * @param workingDirs - Array of discovered working directories
 * @param cwd - The current working directory (absolute path)
 * @param excludedPaths - Array of relative paths to exclude (from --exclude-working-dirs)
 * @returns Filtered array of working directories
 */
export function filterExcludedWorkingDirs(
  workingDirs: WorkingDir[],
  cwd: string,
  excludedPaths: string[],
): WorkingDir[] {
  if (excludedPaths.length === 0) {
    return workingDirs;
  }

  const cwdAbs = resolvePath(cwd);

  // Resolve all excluded paths to absolute paths
  const excludedAbsPaths = new Set(
    excludedPaths.map((p) => normalize(resolvePath(cwdAbs, p))),
  );

  return workingDirs.filter((wd) => {
    const wdAbs = normalize(wd.dir);
    // Check if the working directory matches any excluded path
    // Also check if the working directory is a subdirectory of an excluded path
    for (const excludedPath of excludedAbsPaths) {
      if (wdAbs === excludedPath || wdAbs.startsWith(excludedPath + '/')) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Get a human-readable relative path for display purposes.
 * Shows the path relative to the current working directory.
 *
 * @param absolutePath - The absolute path to format
 * @param cwd - The current working directory
 * @returns Relative path string for display
 */
export function getRelativePath(absolutePath: string, cwd: string): string {
  const cwdAbs = resolvePath(cwd);
  const rel = relativePath(cwdAbs, absolutePath);
  return rel || '.';
}
