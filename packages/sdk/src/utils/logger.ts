export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: number;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export type LogSink = (entry: LogEntry) => void;

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class ConsoleLogger implements Logger {
  private readonly minLevel: number;
  private readonly bindings: Record<string, unknown>;
  private readonly sink: LogSink;

  constructor(opts: { level?: LogLevel; bindings?: Record<string, unknown>; sink?: LogSink } = {}) {
    this.minLevel = LEVELS[opts.level ?? 'info'];
    this.bindings = opts.bindings ?? {};
    this.sink = opts.sink ?? defaultSink;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.emit('debug', message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.emit('info', message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.emit('error', message, meta);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({
      level: levelForMin(this.minLevel),
      bindings: { ...this.bindings, ...bindings },
      sink: this.sink,
    });
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVELS[level] < this.minLevel) return;
    this.sink({
      level,
      message,
      meta: meta ? { ...this.bindings, ...meta } : { ...this.bindings },
      timestamp: Date.now(),
    });
  }
}

const defaultSink: LogSink = (entry) => {
  const prefix = `[${entry.level.toUpperCase()}]`;
  const meta = entry.meta && Object.keys(entry.meta).length > 0 ? ` ${JSON.stringify(entry.meta)}` : '';
  // eslint-disable-next-line no-console
  const out = entry.level === 'error' || entry.level === 'warn' ? console.error : console.log;
  out(`${prefix} ${entry.message}${meta}`);
};

function levelForMin(min: number): LogLevel {
  if (min <= LEVELS.debug) return 'debug';
  if (min <= LEVELS.info) return 'info';
  if (min <= LEVELS.warn) return 'warn';
  return 'error';
}

export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}
