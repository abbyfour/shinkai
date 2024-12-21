import path from "node:path";

export class RemoteItem {
  constructor(
    public readonly filename: string,
    public readonly parent?: string
  ) {}

  public pathInFolder(dir: string) {
    return path.join(dir, this.path());
  }

  public path(): string {
    return this.parent ? path.join(this.parent, this.filename) : this.filename;
  }

  public in(parent: string): RemoteItem {
    return new RemoteItem(this.filename, parent);
  }

  public hasFileExtension(): boolean {
    return /.*\\.\\w{2, 4}/.test(this.filename);
  }

  public static fromFullPath(fullPath: string): RemoteItem {
    return new RemoteItem(path.basename(fullPath));
  }

  public asArchive(): RemoteItem {
    return new RemoteItem(`${this.filename}.zip`, this.parent);
  }

  public quoted(): RemoteItem {
    return new RemoteItem(
      RemoteItem.quote(this.filename),
      this.parent ? RemoteItem.quote(this.parent) : undefined
    );
  }

  private static quote(str: string): string {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
}
