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

/** WebLLM releases its generation lock only after its iterator is fully drained. */
export async function consumeAnswer(
  chunks: AsyncIterable<{
    choices: {delta?: {content?: string | null}; finish_reason?: string | null}[];
  }>,
  emit: (text: string) => void,
  stopped: () => boolean,
  interrupt: () => Promise<void>,
): Promise<boolean> {
  const answer = answerStream(emit);
  let truncated = false;
  for await (const chunk of chunks) {
    if (stopped()) {
      await interrupt();
      continue;
    }
    if (chunk.choices[0]?.finish_reason === 'length') truncated = true;
    answer.push(chunk.choices[0]?.delta?.content ?? '');
  }
  answer.finish();
  return truncated;
}
