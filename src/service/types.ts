export type PubPoolResult = {
  ok: string[];
  failed: string[];
};

export type PubPool = {
  on: (type: 'ok' | 'failed' | 'complete', cb: any) => void;
  off: (type: 'ok' | 'failed' | 'complete', cb: any) => void;
  completePromise: () => Promise<PubPoolResult>;
  onFirstOkOrCompleteFailure: () => Promise<void>;
};

