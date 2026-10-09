import fs from "node:fs/promises";
import path from "node:path";

/** Object storage seam. Local disk in development; swap for an S3/R2 implementation in production. */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string): string;
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

  async delete(key: string): Promise<void> {
    await fs.rm(path.join(this.dir, key), { force: true });
  }

  url(key: string): string {
    return `${this.baseUrl}/media/${key}`;
  }
}
