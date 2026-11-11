// compileAsync can poll forever on a program that never reports ready, so its promise goes through this.

/** Resolves when p does, or after ms, calling onTimeout. A rejection of p passes through. The timer never outlives the call. */
export function withTimeout(p: Promise<unknown>, ms: number, onTimeout: () => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      resolve();
    }, ms);
    p.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
