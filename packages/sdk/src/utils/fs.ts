import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isExecutable(path: string): Promise<boolean> {
  try {
    const st = await fs.stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

export async function removeIfExists(path: string): Promise<void> {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path);
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n');
}
