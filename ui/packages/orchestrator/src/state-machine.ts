export const ITERATION_STATES = ['INGEST','ANALYZE','GENERATE','RENDER','MEASURE','DIAGNOSE','PATCH','REGRESSION'] as const
export type IterationState = typeof ITERATION_STATES[number]
export function nextState(current: IterationState): IterationState | null {
  const index = ITERATION_STATES.indexOf(current)
  return index === ITERATION_STATES.length - 1 ? null : ITERATION_STATES[index + 1]!
}
