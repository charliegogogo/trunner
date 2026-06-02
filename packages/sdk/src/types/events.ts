export interface ProgressInfo {
  phase: 'download' | 'extract' | 'verify' | 'init' | 'plan' | 'apply' | 'destroy' | string;
  current: number;
  total: number;
  unit?: 'bytes' | 'files' | 'percent';
  message?: string;
}

export interface PromptRequest {
  promptId: string;
  question: string;
  kind: 'confirm' | 'input' | 'select';
  defaultValue?: string;
  options?: string[];
  timeoutMs?: number;
}

export type PromptAnswer = (value: string) => void;

export interface RunnerEventMap {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  progress: (info: ProgressInfo) => void;
  prompt: (req: PromptRequest, answer: PromptAnswer) => void;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}
