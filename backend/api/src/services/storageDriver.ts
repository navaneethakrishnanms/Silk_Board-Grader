/**
 * Storage drivers (WP8).
 *
 *  local (default) — files live only under STORAGE_ROOT.
 *  s3              — STORAGE_ROOT stays the working copy (engine-svc reads local paths), and every
 *                    stored file (originals, previews, heat-maps, reports, models) is also written to an
 *                    S3 / MinIO bucket. If a local file is missing (new container, cleaned disk) it is
 *                    fetched back from the bucket before use.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface StorageDriver {
  readonly name: 'local' | 's3';
  /** copy a local file (storage-relative path) to durable storage */
  mirror(rel: string, absFile: string): Promise<void>;
  /** make sure the local working copy exists; returns false if it cannot be found anywhere */
  ensureLocal(rel: string, absFile: string): Promise<boolean>;
}

export class LocalDriver implements StorageDriver {
  readonly name = 'local' as const;
  async mirror(): Promise<void> {}
  async ensureLocal(_rel: string, absFile: string) {
    return fs.existsSync(absFile);
  }
}

type Sender = Pick<S3Client, 'send'>;

export class S3Driver implements StorageDriver {
  readonly name = 's3' as const;
  constructor(private client: Sender, private bucket: string, private prefix = '') {}

  private key(rel: string) {
    return `${this.prefix}${rel.replace(/^\/+/, '')}`;
  }

  async mirror(rel: string, absFile: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(rel), Body: await fsp.readFile(absFile) }));
  }

  async ensureLocal(rel: string, absFile: string) {
    if (fs.existsSync(absFile)) return true;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
    } catch {
      return false;
    }
    const obj = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(rel) }));
    await fsp.mkdir(path.dirname(absFile), { recursive: true });
    await pipeline(obj.Body as Readable, fs.createWriteStream(absFile));
    return true;
  }
}

let driver: StorageDriver | null = null;

export function storageDriver(): StorageDriver {
  if (driver) return driver;
  if (env.STORAGE_DRIVER === 's3') {
    const client = new S3Client({
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } : undefined,
    });
    driver = new S3Driver(client, env.S3_BUCKET, env.S3_PREFIX);
  } else {
    driver = new LocalDriver();
  }
  return driver;
}

/** test hook */
export function setStorageDriver(d: StorageDriver | null) {
  driver = d;
}

/** Mirror without failing the request (the local copy is already safe); errors are logged. */
export async function mirrorQuietly(rel: string | null | undefined, absFile: string) {
  if (!rel) return;
  try {
    await storageDriver().mirror(rel, absFile);
  } catch (err) {
    logger.error({ err, rel }, 'storage mirror failed');
  }
}
