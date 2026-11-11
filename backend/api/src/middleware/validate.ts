import type { ZodTypeAny, z } from 'zod';
import { badRequest } from '../utils/httpError.js';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Validation failed', r.error.flatten());
  return r.data;
}
