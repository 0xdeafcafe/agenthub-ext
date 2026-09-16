/** One model runtime per extension origin, including separate PR tabs. */
export function modelLease(): {acquire: () => Promise<void>; release: () => void} {
  let release: (() => void) | null = null;
  return {
    async acquire() {
      if (release) return;
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request('prix-ai-model', {ifAvailable: true}, async (lock) => {
            if (!lock) {
              reject(
                new Error(
                  'Another PR tab is using a model. Close its assistant or unload its model, then try again.',
                ),
              );
              return;
            }
            await new Promise<void>((done) => {
              release = done;
              resolve();
            });
          })
          .catch(reject);
      });
    },
    release() {
      release?.();
      release = null;
    },
  };
}
