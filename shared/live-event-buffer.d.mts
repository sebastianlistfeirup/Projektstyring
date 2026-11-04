export function createLiveEventBuffer(deliver: (events: Record<string, unknown>[]) => void): {
  flush: () => void;
  push: (event: Record<string, unknown>) => void;
};
