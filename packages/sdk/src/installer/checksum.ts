import { createHash } from 'node:crypto';

export async function sha256OfFile(path: string): Promise<string> {
  const { promises: fs } = await import('node:fs');
  const data = await fs.readFile(path);
  return sha256OfBuffer(data);
}

export function sha256OfBuffer(data: Buffer | Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

export async function verifySha256(path: string, expected: string): Promise<boolean> {
  const actual = await sha256OfFile(path);
  return timingSafeEqualHex(actual, expected);
}

export function verifySha256Buffer(data: Buffer | Uint8Array, expected: string): boolean {
  return timingSafeEqualHex(sha256OfBuffer(data), expected);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
