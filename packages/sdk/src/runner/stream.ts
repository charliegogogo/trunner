import { EventEmitter } from 'node:events';
import type { ProgressInfo, PromptRequest, PromptAnswer, RunnerEventMap } from '../types/events.js';

type EventName = keyof RunnerEventMap;

export class RunnerStream extends EventEmitter {
  emitStdout(chunk: string): void {
    this.emit('stdout', chunk);
  }
  emitStderr(chunk: string): void {
    this.emit('stderr', chunk);
  }
  emitProgress(info: ProgressInfo): void {
    this.emit('progress', info);
  }
  emitPrompt(req: PromptRequest, answer: PromptAnswer): void {
    this.emit('prompt', req, answer);
  }
  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('exit', code, signal);
  }

  override on<K extends EventName>(event: K, listener: RunnerEventMap[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
  override off<K extends EventName>(event: K, listener: RunnerEventMap[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
  override once<K extends EventName>(event: K, listener: RunnerEventMap[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
  override removeListener<K extends EventName>(event: K, listener: RunnerEventMap[K]): this {
    return super.removeListener(event, listener as (...args: unknown[]) => void);
  }
  override addListener<K extends EventName>(event: K, listener: RunnerEventMap[K]): this {
    return super.addListener(event, listener as (...args: unknown[]) => void);
  }
}

export interface Runner {
  on<K extends EventName>(event: K, listener: RunnerEventMap[K]): this;
  off<K extends EventName>(event: K, listener: RunnerEventMap[K]): this;
  cancel(signal?: AbortSignal): Promise<void>;
}
