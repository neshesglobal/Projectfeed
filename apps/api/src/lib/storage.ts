import fs from "node:fs/promises";
import path from "node:path";

/** Object storage seam. Local disk in development; swap for an S3/R2 implementation in production. */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Move a local file (e.g. a transcoder output) into storage. */
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string): string;
  /** Local scratch directory for uploads awaiting processing. */
  tmpDir(): string;
}

export class LocalStorage implements Storage {
  constructor(
    private dir: string,
    private baseUrl: string,
  ) {}

  async put(key: string, data: Buffer): Promise<void> {
    const file = path.join(this.dir, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }

  async putFile(key: string, filePath: string): Promise<void> {
    const file = path.join(this.dir, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.rename(filePath, file);
    } catch {
      await fs.copyFile(filePath, file); // across devices
      await fs.rm(filePath, { force: true });
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(path.join(this.dir, key), { force: true });
  }

  url(key: string): string {
    return `${this.baseUrl}/media/${key}`;
  }

  tmpDir(): string {
    // Kept outside the served /media prefix so unprocessed uploads are never publicly reachable.
    return path.join(this.dir, "..", `${path.basename(this.dir)}-tmp`);
  }
}
