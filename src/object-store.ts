import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Local stand-in for Cloudflare R2 (or S3). It keeps objects as files under one directory.
 * Signed URLs work like R2/S3 presigned URLs: anyone with the URL can read the object until it expires.
 */
export class LocalObjectStore {
  private readonly rootDir: string;
  private readonly publicBaseUrl: string;
  private readonly signingSecret: string;

  constructor(options: { rootDir: string; publicBaseUrl: string; signingSecret: string }) {
    this.rootDir = resolve(options.rootDir);
    this.publicBaseUrl = options.publicBaseUrl;
    this.signingSecret = options.signingSecret;
  }

  async put(key: string, body: Uint8Array | string): Promise<{ sizeBytes: number }> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { sizeBytes: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  /** Returns a URL that allows a GET of `key` until `ttlSeconds` pass. */
  signedUrl(key: string, ttlSeconds: number): string {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const url = new URL(`/files/${key}`, this.publicBaseUrl);
    url.searchParams.set('expires', String(expiresAt));
    url.searchParams.set('signature', this.sign(key, expiresAt));
    return url.toString();
  }

  isValidSignature(key: string, expiresAt: number, signature: string): boolean {
    if (!Number.isInteger(expiresAt) || expiresAt < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(key, expiresAt));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private sign(key: string, expiresAt: number): string {
    return createHmac('sha256', this.signingSecret).update(`${key}\n${expiresAt}`).digest('base64url');
  }

  private pathFor(key: string): string {
    const path = resolve(join(this.rootDir, key));
    if (!path.startsWith(this.rootDir + '/')) throw new Error(`Object key escapes the store: ${key}`);
    return path;
  }
}
