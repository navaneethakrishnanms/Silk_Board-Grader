/** WP8: storage drivers (local default, S3/MinIO mirror with fetch-back). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { LocalDriver, S3Driver } from '../src/services/storageDriver.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-st-'));

/** In-memory fake of the S3 client `send` method. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const send = vi.fn(async (cmd: unknown) => {
    const input = (cmd as { input: { Bucket: string; Key: string; Body?: Buffer } }).input;
    const k = `${input.Bucket}/${input.Key}`;
    if (cmd instanceof PutObjectCommand) { objects.set(k, Buffer.from(input.Body as Buffer)); return {}; }
    if (cmd instanceof HeadObjectCommand) { if (!objects.has(k)) throw Object.assign(new Error('NotFound'), { name: 'NotFound' }); return {}; }
    if (cmd instanceof GetObjectCommand) return { Body: Readable.from(objects.get(k)!) };
    throw new Error('unexpected command');
  });
  return { objects, client: { send } as never, send };
}

describe('LocalDriver', () => {
  it('is a no-op mirror and reports local existence', async () => {
    const d = new LocalDriver();
    const dir = tmp();
    const f = path.join(dir, 'a.txt');
    expect(await d.ensureLocal('a.txt', f)).toBe(false);
    fs.writeFileSync(f, 'x');
    await d.mirror();
    expect(await d.ensureLocal('a.txt', f)).toBe(true);
  });
});

describe('S3Driver', () => {
  it('mirrors files under the prefix and restores a missing local copy', async () => {
    const s3 = fakeS3();
    const d = new S3Driver(s3.client, 'bucket', 'sg/');
    const dir = tmp();
    const abs = path.join(dir, 'originals', 't1', 'img.jpg');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'IMAGE-BYTES');
    await d.mirror('originals/t1/img.jpg', abs);
    expect(s3.objects.get('bucket/sg/originals/t1/img.jpg')?.toString()).toBe('IMAGE-BYTES');

    fs.rmSync(abs); // local working copy lost (e.g. new container)
    expect(await d.ensureLocal('originals/t1/img.jpg', abs)).toBe(true);
    expect(fs.readFileSync(abs, 'utf8')).toBe('IMAGE-BYTES');
  });

  it('returns false when the object is in neither place', async () => {
    const s3 = fakeS3();
    const d = new S3Driver(s3.client, 'bucket');
    expect(await d.ensureLocal('nope.jpg', path.join(tmp(), 'nope.jpg'))).toBe(false);
  });

  it('does not touch S3 when the local copy exists', async () => {
    const s3 = fakeS3();
    const d = new S3Driver(s3.client, 'bucket');
    const f = path.join(tmp(), 'here.jpg');
    fs.writeFileSync(f, 'x');
    expect(await d.ensureLocal('here.jpg', f)).toBe(true);
    expect(s3.send).not.toHaveBeenCalled();
  });
});
