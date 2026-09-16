import {describe, expect, it} from 'vitest';
import {answerStream} from './answer-stream';

function collect(parts: string[]): string {
  let result = '';
  const stream = answerStream((text) => {
    result += text;
  });
  for (const part of parts) stream.push(part);
  stream.finish();
  return result;
}

describe('answer streaming', () => {
  it('removes the empty runtime preamble at every possible token boundary', () => {
    const text = '<think>\n\n</think>\n\nThe boundary changed [S1].';
    for (let split = 0; split <= text.length; split++)
      expect(collect([text.slice(0, split), text.slice(split)])).toBe('The boundary changed [S1].');
  });
  it('preserves ordinary answers and literal tags inside the answer', () => {
    expect(collect(['The ', 'source contains <think>\n\n</think>\n\n.'])).toBe(
      'The source contains <think>\n\n</think>\n\n.',
    );
  });
  it('preserves partial prefixes instead of silently losing model output', () => {
    expect(collect(['<thi'])).toBe('<thi');
    expect(collect(['<think>nonempty</think>'])).toBe('<think>nonempty</think>');
  });
});
