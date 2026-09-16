// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';
import {renderAnswer} from './render-answer';
import type {SourceChunk} from './index';

const source = {id: 'S1', path: 'src/session.ts'} as SourceChunk;
describe('answer rendering', () => {
  it('formats code and lists, and opens only supplied source IDs', () => {
    const open = vi.fn<(id: string) => void>();
    const host = document.createElement('div');
    host.append(
      renderAnswer(
        '### Boundary\n\n**Changed** `expiry` [S1, R2].\n- Check equality\n- Check expiry\n\nUnknown [S999].',
        [source],
        open,
      ),
    );
    expect(host.querySelector('h3')?.textContent).toBe('Boundary');
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelector('strong')?.textContent).toBe('Changed');
    expect(host.querySelector('code')?.textContent).toBe('expiry');
    expect(host.querySelectorAll('button')).toHaveLength(1);
    host.querySelector('button')!.click();
    expect(open).toHaveBeenCalledWith('S1');
    expect(host.textContent).toContain('[S999]');
  });
  it('keeps HTML, external links, and fenced-code citations inert', () => {
    const host = document.createElement('div');
    const text =
      '<img src=x onerror=alert(1)> [click](https://example.com)\n\n```html\n<script>alert(1)</script> [S1]\n```';
    host.append(renderAnswer(text, [source], vi.fn()));
    expect(host.querySelector('img, script, a, button')).toBeNull();
    expect(host.querySelector('pre code')?.textContent).toContain('<script>alert(1)</script> [S1]');
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
