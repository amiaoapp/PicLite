/** Serialise clipboard writes without delaying compression or preview publication. */
export function createAutomaticResultCopier(
  copy: (path: string) => Promise<void>,
  enabled: () => boolean,
  failed: (error: unknown) => void,
) {
  let pending = Promise.resolve();
  return (results: readonly { status: string; output?: string }[]) => {
    if (!enabled()) return pending;
    const output = results.filter(item => item.status === "done" && item.output).at(-1)?.output;
    if (!output) return pending;
    pending = pending.then(async () => {
      if (!enabled()) return;
      try { await copy(output); } catch (error) { failed(error); }
    });
    return pending;
  };
}
