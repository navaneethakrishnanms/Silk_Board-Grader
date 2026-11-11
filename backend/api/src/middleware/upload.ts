import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/httpError.js';

/** JPEG, PNG, TIFF (8/16-bit), HEIC/HEIF; max MAX_UPLOAD_MB per file. */
export const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif']);
export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/heic',
  'image/heif',
  'application/octet-stream',
]);

export function isAllowedImage(originalName: string, mime: string): boolean {
  return ALLOWED_EXT.has(path.extname(originalName).toLowerCase()) && ALLOWED_MIME.has(mime);
}

export const imageUpload = multer({
  dest: path.join(os.tmpdir(), 'silkgrade-uploads'),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedImage(file.originalname, file.mimetype)) {
      return cb(badRequest('Unsupported file type. Use JPEG, PNG, TIFF or HEIC.'));
    }
    cb(null, true);
  },
});

export const modelUpload = multer({
  dest: path.join(os.tmpdir(), 'silkgrade-models'),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.json' && ext !== '.onnx') return cb(badRequest('Model must be .json or .onnx'));
    cb(null, true);
  },
});
