import type {CategoryCount} from './impact-bar';
import type {ChangedLines} from './views';
import type {DiffFile} from './diff';

export interface FileRecord {
  category: string;
  lines: ChangedLines | null;
  viewed: boolean;
  inventory?: DiffFile;
}

/** Keep lightweight file identities, never detached GitHub DOM trees. */
export class FileIndex {
  readonly counts = new Map<string, CategoryCount>();
  readonly files = new Map<string, FileRecord>();

  update(
    path: string,
    category: string,
    lines: ChangedLines | null,
    viewed: boolean | null,
  ): FileRecord {
    const previous = this.files.get(path);
    const next = {
      category,
      lines: previous?.inventory ?? lines ?? previous?.lines ?? null,
      viewed: viewed ?? previous?.viewed ?? false,
      ...(previous?.inventory ? {inventory: previous.inventory} : {}),
    };
    if (previous) this.#adjust(previous, -1);
    this.files.set(path, next);
    this.#adjust(next, 1);
    return next;
  }

  seed(files: DiffFile[], classify: (path: string) => string): void {
    for (const file of files) {
      const previous = this.files.get(file.path);
      if (previous) this.#adjust(previous, -1);
      const next = {
        category: classify(file.path),
        lines: file,
        viewed: previous?.viewed ?? false,
        inventory: file,
      };
      this.files.set(file.path, next);
      this.#adjust(next, 1);
    }
  }

  countsFor(
    excludeComments: boolean,
    include: (path: string, file: FileRecord) => boolean = () => true,
  ): Map<string, CategoryCount> {
    const counts = new Map<string, CategoryCount>();
    for (const [path, file] of this.files) {
      if (!include(path, file)) continue;
      const lines = adjustedLines(file, excludeComments);
      const count = counts.get(file.category) ?? {files: 0, added: 0, removed: 0, reviewed: 0};
      count.files++;
      count.added += lines.added;
      count.removed += lines.removed;
      count.reviewed += Number(file.viewed);
      counts.set(file.category, count);
    }
    return counts;
  }

  #adjust(file: FileRecord, direction: number): void {
    const count = this.counts.get(file.category) ?? {files: 0, added: 0, removed: 0, reviewed: 0};
    count.files += direction;
    count.added += direction * (file.lines?.added ?? 0);
    count.removed += direction * (file.lines?.removed ?? 0);
    count.reviewed += direction * Number(file.viewed);
    this.counts.set(file.category, count);
  }
}

export function adjustedLines(file: FileRecord, excludeComments: boolean): ChangedLines {
  return {
    added: Math.max(
      0,
      (file.lines?.added ?? 0) - (excludeComments ? (file.inventory?.commentAdded ?? 0) : 0),
    ),
    removed: Math.max(
      0,
      (file.lines?.removed ?? 0) - (excludeComments ? (file.inventory?.commentRemoved ?? 0) : 0),
    ),
  };
}
