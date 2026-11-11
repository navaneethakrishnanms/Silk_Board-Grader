/** Local-disk storage under STORAGE_ROOT (shared volume with engine-svc).
 *  Layout: originals/<testId>/..., derived/<testId>/..., reports/<testId>/..., models/...
 *  Originals are written once and never modified. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { badRequest } from '../utils/httpError.js';
import { mirrorQuietly, storageDriver } from './storageDriver.js';

export const storageRoot = () => env.storageRoot;

export function absPath(rel: string): string {
  const p = path.resolve(env.storageRoot, rel);
  const root = path.resolve(env.storageRoot);
  if (p !== root && !p.startsWith(root + path.sep)) throw badRequest('Path outside storage');
  return p;
}

export function relPath(abs: string): string {
  return path.relative(env.storageRoot, abs).split(path.sep).join('/');
}

export async function ensureDir(rel: string): Promise<string> {
  const p = absPath(rel);
  await fsp.mkdir(p, { recursive: true });
  return p;
}

/** Move an uploaded temp file into storage without overwriting anything. */
export async function storeOriginal(tmpFile: string, testId: string, role: string, originalName: string): Promise<{ rel: string; sha256: string; size: number }> {
  const ext = (path.extname(originalName || '').toLowerCase() || '.bin').replace(/[^.a-z0-9]/g, '');
  const dir = await ensureDir(`originals/${testId}`);
  const name = `${role.toLowerCase()}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const dest = path.join(dir, name);
  await fsp.copyFile(tmpFile, dest, fs.constants.COPYFILE_EXCL);
  await fsp.rm(tmpFile, { force: true });
  const sha256 = await sha256File(dest);
  const { size } = await fsp.stat(dest);
  await mirrorQuietly(relPath(dest), dest);
  return { rel: relPath(dest), sha256, size };
}

export function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

export const exists = (rel: string | null | undefined) => !!rel && fs.existsSync(absPath(rel));

/** Mirror a storage-relative file to the durable driver (no-op for local). */
export async function mirror(rel: string | null | undefined) {
  if (rel) await mirrorQuietly(rel, absPath(rel));
}

/** Ensure a working copy exists locally (fetches from S3 when using that driver). */
export async function ensureLocal(rel: string): Promise<boolean> {
  return storageDriver().ensureLocal(rel, absPath(rel));
}
