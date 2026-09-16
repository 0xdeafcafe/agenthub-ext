// WebLLM prepends this empty block even when enable_thinking is false.
const EMPTY_THINKING = '<think>\n\n</think>\n\n';

/** Remove only the runtime's leading empty block, including when split across tokens. */
export function answerStream(emit: (text: string) => void): {
  push: (text: string) => void;
  finish: () => void;
} {
  let pending = '';
  let started = false;
  return {
    push(text) {
      if (started) {
        emit(text);
        return;
      }
      pending += text;
      if (EMPTY_THINKING.startsWith(pending)) return;
      started = true;
      emit(pending.startsWith(EMPTY_THINKING) ? pending.slice(EMPTY_THINKING.length) : pending);
      pending = '';
    },
    finish() {
      if (pending && pending !== EMPTY_THINKING) emit(pending);
      pending = '';
      started = true;
    },
  };
}
