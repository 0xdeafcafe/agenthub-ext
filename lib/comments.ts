/** Conservative comment-only detection. Inline code, strings, and blank lines
 * still count. Old/new sides of a diff get independent lexer state. */
export class CommentScanner {
  #block: string | null = null;
  #quote: string | null = null;
  readonly #line: string[];
  readonly #blocks: Array<[string, string]>;
  readonly #multiline: boolean;
  readonly #regex: boolean;

  constructor(path: string) {
    const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
    const cLike =
      /^(?:[cm]?[jt]sx?|c|cc|cpp|h|hpp|cs|java|go|rs|swift|kt|kts|scala|dart|php|css|scss|less|jsonc|vue|svelte)$/.test(
        extension,
      );
    const hash =
      /^(?:py|rb|sh|bash|zsh|yml|yaml|toml|r|pl|ps1|dockerfile)$/.test(extension) ||
      /(?:^|\/)Dockerfile(?:\.|$)/i.test(path);
    const sql = extension === 'sql';
    this.#line =
      cLike && !/^(css)$/.test(extension)
        ? ['//']
        : hash
          ? ['#']
          : sql
            ? ['--']
            : extension === 'lua'
              ? ['--']
              : [];
    this.#blocks =
      cLike || sql
        ? [['/*', '*/']]
        : /^(html?|xml|svg|vue|svelte|md|mdx)$/.test(extension)
          ? [['<!--', '-->']]
          : [];
    if (/^(vue|svelte)$/.test(extension)) this.#blocks.push(['<!--', '-->']);
    // Triple-quoted Python/Ruby strings and JS templates are code, not comments.
    this.#multiline = /^(py|rb|[cm]?[jt]sx?|go|rs)$/.test(extension);
    this.#regex = /^[cm]?[jt]sx?$/.test(extension);
  }

  scan(line: string): boolean {
    if (line.startsWith('#!') && !this.#block && !this.#quote) return false;
    let hasComment = false;
    let hasCode = this.#quote !== null;
    for (let i = 0; i < line.length;) {
      if (this.#block) {
        hasComment = true;
        const end = line.indexOf(this.#block, i);
        if (end < 0) return !hasCode;
        i = end + this.#block.length;
        this.#block = null;
        continue;
      }
      if (this.#quote) {
        hasCode = true;
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line.startsWith(this.#quote, i)) {
          i += this.#quote.length;
          this.#quote = null;
        } else i++;
        continue;
      }
      if (/\s/.test(line[i])) {
        i++;
        continue;
      }
      if (this.#line.some((marker) => line.startsWith(marker, i))) {
        hasComment = true;
        break;
      }
      const block = this.#blocks.find(([start]) => line.startsWith(start, i));
      if (block) {
        hasComment = true;
        this.#block = block[1];
        i += block[0].length;
        continue;
      }
      hasCode = true;
      // Keep JS regular-expression character classes from opening a comment.
      if (this.#regex && line[i] === '/') {
        let bracket = false;
        let end = i + 1;
        for (; end < line.length; end++) {
          if (line[end] === '\\') {
            end++;
            continue;
          }
          if (line[end] === '[') bracket = true;
          if (line[end] === ']') bracket = false;
          if (line[end] === '/' && !bracket) break;
        }
        if (end < line.length) {
          i = end + 1;
          continue;
        }
      }
      if (this.#multiline && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
        this.#quote = line.slice(i, i + 3);
        i += 3;
      } else if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
        this.#quote = line[i++];
      } else i++;
    }
    if (this.#quote?.length === 1 && this.#quote !== '`' && !line.endsWith('\\'))
      this.#quote = null;
    return hasComment && !hasCode;
  }
}
