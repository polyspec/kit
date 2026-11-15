// A local workflow cannot claim native job evidence when it cannot supply a required capability.
export class LocalWorkflowRefusal extends Error { override name = 'LocalWorkflowRefusal'; }

/** Restore only typed local capability refusals through the native evaluator's error-cause wrappers. */
export function localWorkflowRefusal(error: unknown): LocalWorkflowRefusal | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof LocalWorkflowRefusal) return current === error ? current
      : new LocalWorkflowRefusal(error instanceof Error ? error.message : current.message, { cause: error });
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}
