/** JSON helpers (BigInt-safe; typed accessors for Prisma Json columns). */
export function toJSONSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as T;
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function asObject<T extends object = Record<string, unknown>>(v: unknown): T {
  return (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as T;
}
