import type { FileSystem } from "../../src/ports/index.js";

/**
 * A `FileSystem` backed by in-memory maps. Paths are treated as opaque strings;
 * `readDir` lists immediate children by `<path>/` prefix. Enough to assert what
 * a use case wrote and where, without touching disk.
 */
export class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async mkdirp(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async readFile(path: string): Promise<string> {
    const contents = this.files.get(path);
    if (contents === undefined) {
      throw new Error(`FakeFileSystem: no such file "${path}"`);
    }
    return contents;
  }

  async readDir(path: string): Promise<string[]> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const names = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        const [head] = rest.split("/");
        if (head !== undefined && head.length > 0) {
          names.add(head);
        }
      }
    }
    return [...names];
  }
}
