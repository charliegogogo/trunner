import { describe, expect, it } from 'vitest';
import { ConsoleLogger, NoopLogger } from '../../src/utils/logger.js';

describe('utils/logger', () => {
  it('ConsoleLogger emits to a custom sink', () => {
    const entries: unknown[] = [];
    const log = new ConsoleLogger({ level: 'debug', sink: (e) => entries.push(e) });
    log.debug('hi', { k: 1 });
    log.info('ok');
    log.warn('w');
    log.error('e');
    expect(entries).toHaveLength(4);
    const first = entries[0] as { level: string; message: string; meta: { k: number } };
    expect(first.level).toBe('debug');
    expect(first.message).toBe('hi');
    expect(first.meta.k).toBe(1);
  });

  it('ConsoleLogger respects level threshold', () => {
    const entries: unknown[] = [];
    const log = new ConsoleLogger({ level: 'warn', sink: (e) => entries.push(e) });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(entries).toHaveLength(2);
  });

  it('child() merges bindings', () => {
    const entries: unknown[] = [];
    const log = new ConsoleLogger({ level: 'debug', sink: (e) => entries.push(e), bindings: { app: 'x' } });
    const c = log.child({ tool: 'terraform' });
    c.info('msg', { extra: 1 });
    const e = entries[0] as { meta: Record<string, unknown> };
    expect(e.meta.app).toBe('x');
    expect(e.meta.tool).toBe('terraform');
    expect(e.meta.extra).toBe(1);
  });

  it('NoopLogger does not throw', () => {
    const n = new NoopLogger();
    expect(() => {
      n.debug('d');
      n.info('i');
      n.warn('w');
      n.error('e');
      n.child({}).info('c');
    }).not.toThrow();
  });
});
