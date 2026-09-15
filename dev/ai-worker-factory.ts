/** Bundled only by the local playground. */
export function createModelWorker(): Worker {
  return new Worker('/ai-worker.js', {type: 'module'});
}
