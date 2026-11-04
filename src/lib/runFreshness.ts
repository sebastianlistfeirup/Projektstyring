import type { SwarmRun } from './swarm';

export function runFreshness(run: Pick<SwarmRun, 'status' | 'heartbeatAt' | 'recoveredAt'> | null, connected = true, now = Date.now()): 'current' | 'disconnected' | 'stale' {
  if (!run || !['running', 'awaiting_approval'].includes(run.status) || run.recoveredAt) return 'current';
  if (!connected) return 'disconnected';
  return run.heartbeatAt && now - run.heartbeatAt > 45000 ? 'stale' : 'current';
}
