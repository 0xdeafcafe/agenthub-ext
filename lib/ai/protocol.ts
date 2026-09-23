import type {ModelId} from './models';
import type {SourceChunk} from './index';
import type {TaskMode} from './search';

export type WorkerRequest =
  | {id: number; type: 'status'}
  | {id: number; type: 'load' | 'remove'; model: ModelId}
  | {
      id: number;
      type: 'generate';
      question: string;
      sources: SourceChunk[];
      previousQuestion: string;
      mode?: TaskMode;
    }
  | {id: number; type: 'stop' | 'unload'};
export type WorkerResponse =
  | {id: number; type: 'status'; installed: ModelId[]; partial?: ModelId[]; simulated?: boolean}
  | {id: number; type: 'progress'; progress: number; text: string}
  | {id: number; type: 'ready'; model: ModelId; loadMs: number}
  | {id: number; type: 'context'; sources: SourceChunk[]; omitted: number; inputTokens: number}
  | {id: number; type: 'token'; text: string}
  | {
      id: number;
      type: 'done';
      elapsedMs: number;
      firstTokenMs: number;
      outputTokens?: number;
      stopped?: boolean;
      truncated?: boolean;
    }
  | {id: number; type: 'unloaded' | 'removed'}
  | {id: number; type: 'error'; message: string};
