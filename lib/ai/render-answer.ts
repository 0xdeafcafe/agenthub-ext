import type {SourceChunk} from './index';

/** A small text-only Markdown renderer. Model output never becomes HTML or external links. */
export function renderAnswer(
  text: string,
  sources: SourceChunk[],
  open: (id: string) => void,
): DocumentFragment {
  const result = document.createDocumentFragment();
  const known = new Set(sources.map((source) => source.id));
  const inline = (parent: HTMLElement, value: string): void => {
    const parts =
      /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[(S\d+)(?:[,:]\s*(?:[LR]\d+(?:[-–][LR]?\d+)?|old|new))?\]/g;
    let offset = 0;
    for (const match of value.matchAll(parts)) {
      parent.append(value.slice(offset, match.index));
      if (match[1] || match[2]) {
        const element = document.createElement(match[1] ? 'code' : 'strong');
        element.textContent = match[1] ?? match[2];
        parent.append(element);
      } else if (known.has(match[3])) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'citation';
        button.textContent = match[0];
        button.title = sources.find((source) => source.id === match[3])!.path;
        button.addEventListener('click', () => open(match[3]));
        parent.append(button);
      } else parent.append(match[0]);
      offset = match.index + match[0].length;
    }
    parent.append(value.slice(offset));
  };
  let code: HTMLElement | null = null;
  let paragraph: HTMLElement | null = null;
  let list: HTMLOListElement | HTMLUListElement | null = null;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      paragraph = list = null;
      if (code) code = null;
      else {
        const pre = document.createElement('pre');
        code = document.createElement('code');
        pre.append(code);
        result.append(pre);
      }
    } else if (code) code.append(line + '\n');
    else if (!line.trim()) paragraph = list = null;
    else {
      const heading = /^#{1,4}\s+(.+)$/.exec(line);
      const bullet = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
      if (heading) {
        paragraph = list = null;
        const element = document.createElement('h3');
        inline(element, heading[1]);
        result.append(element);
      } else if (bullet) {
        paragraph = null;
        const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if ((list as HTMLElement | null)?.localName !== tag) {
          list = document.createElement(tag);
          result.append(list);
        }
        const item = document.createElement('li');
        inline(item, bullet[1]);
        list!.append(item);
      } else {
        list = null;
        if (!paragraph) {
          paragraph = document.createElement('p');
          result.append(paragraph);
        } else paragraph.append('\n');
        inline(paragraph, line);
      }
    }
  }
  return result;
}
