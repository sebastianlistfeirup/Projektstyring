export const AI_PHASES: readonly string[];
export function normalizePhase(value: unknown): string;
export function removePlanJob<T extends { title: string; dependsOn?: number[] }>(jobs: T[], index: number): T[];
