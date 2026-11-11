/**
 * In-memory implementation of the subset of the Prisma Client API that SilkGrade uses.
 * Used when DATA_MODE=memory (demo mode, no MySQL). The rest of the code keeps calling
 * `prisma.<model>.<method>(...)` exactly as with MySQL, so switching back needs no code change.
 *
 * Supported: findUnique(OrThrow) / findFirst / findMany (where, include, select, orderBy, skip, take),
 * create (nested `create` for has-many relations), update / updateMany / upsert, delete / deleteMany,
 * count, $transaction (callback with rollback, or array), $connect / $disconnect.
 * Unique violations raise Prisma P2002, missing records P2025 — same as the real client.
 */
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

type Row = Record<string, unknown>;
type Rel = { model: string; kind: 'one'; fk: string } | { model: string; kind: 'many'; refFk: string };
interface ModelDef {
  pk: string;
  defaults: () => Row;
  unique: string[][];
  relations: Record<string, Rel>;
  cascade?: { model: string; refFk: string }[];
  autoincrement?: boolean;
}

const uuid = () => crypto.randomUUID();
const now = () => new Date();

export const MODELS: Record<string, ModelDef> = {
  user: {
    pk: 'id', unique: [['email']],
    defaults: () => ({ id: uuid(), active: true, createdAt: now() }),
    relations: { tests: { model: 'test', kind: 'many', refFk: 'createdById' }, expertGrades: { model: 'expertGrade', kind: 'many', refFk: 'userId' } },
  },
  sample: {
    pk: 'id', unique: [],
    defaults: () => ({ batchId: null, customer: null, fibre: 'silk', construction: null, baseShade: null, dominantHue: null, dyeClass: null, notes: null }),
    relations: { tests: { model: 'test', kind: 'many', refFk: 'sampleId' } },
  },
  test: {
    pk: 'id', unique: [['reportNo']],
    defaults: () => ({
      id: uuid(), washTempC: null, washTimeMin: null, adjCount: 2, adj1Fibre: 'silk', adj2Fibre: 'cotton', reqGradeChange: null,
      reqGradeStain: null, status: 'DRAFT', datasetMode: false, captureDevice: null, uploadMode: 'separate', createdAt: now(),
      completedAt: null, gradingError: null, engineResult: null, manualPoints: null, voidReason: null, reportPath: null,
    }),
    relations: {
      sample: { model: 'sample', kind: 'one', fk: 'sampleId' },
      createdBy: { model: 'user', kind: 'one', fk: 'createdById' },
      images: { model: 'image', kind: 'many', refFk: 'testId' },
      grades: { model: 'grade', kind: 'many', refFk: 'testId' },
    },
  },
  image: {
    pk: 'id', unique: [],
    defaults: () => ({ id: uuid(), side: null, previewPath: null, fileName: null, sizeBytes: null, device: null, uploadedAt: now() }),
    relations: { test: { model: 'test', kind: 'one', fk: 'testId' }, regions: { model: 'region', kind: 'many', refFk: 'imageId' } },
    cascade: [{ model: 'region', refFk: 'imageId' }],
  },
  region: {
    pk: 'id', unique: [],
    defaults: () => ({ id: uuid(), maskPath: null, autoDetected: true, editedBy: null, stats: null, createdAt: now() }),
    relations: { image: { model: 'image', kind: 'one', fk: 'imageId' } },
  },
  grade: {
    pk: 'id', unique: [],
    defaults: () => ({ id: uuid(), label: null, modelRating: null, pass: null, heatmapPath: null, createdAt: now() }),
    relations: { test: { model: 'test', kind: 'one', fk: 'testId' }, expertGrades: { model: 'expertGrade', kind: 'many', refFk: 'gradeId' } },
  },
  expertGrade: {
    pk: 'id', unique: [],
    defaults: () => ({ id: uuid(), reason: null, blind: false, createdAt: now() }),
    relations: { grade: { model: 'grade', kind: 'one', fk: 'gradeId' }, user: { model: 'user', kind: 'one', fk: 'userId' } },
  },
  modelVersion: {
    pk: 'id', unique: [['name', 'version']],
    defaults: () => ({ id: uuid(), active: false, createdAt: now() }),
    relations: {},
  },
  setting: { pk: 'key', unique: [], defaults: () => ({}), relations: {} },
  auditLog: {
    pk: 'id', unique: [], autoincrement: true,
    defaults: () => ({ userId: null, details: null, createdAt: now() }),
    relations: {},
  },
  refreshToken: {
    pk: 'id', unique: [['tokenHash']],
    defaults: () => ({ id: uuid(), revokedAt: null, createdAt: now() }),
    relations: { user: { model: 'user', kind: 'one', fk: 'userId' } },
  },
};

const clone = <T>(v: T): T => structuredClone(v);

function knownError(code: string, message: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'memory', meta });
}

// ---------------------------------------------------------------------------
// filtering
// ---------------------------------------------------------------------------

const cmp = (a: unknown) => (a instanceof Date ? a.getTime() : typeof a === 'bigint' ? Number(a) : a);

function eq(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return cmp(a) === cmp(b);
}

function scalarMatch(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return eq(value, cond);
  const c = cond as Record<string, unknown>;
  for (const [op, arg] of Object.entries(c)) {
    if (arg === undefined) continue;
    switch (op) {
      case 'equals': if (!eq(value, arg)) return false; break;
      case 'in': if (!(arg as unknown[]).some((x) => eq(value, x))) return false; break;
      case 'notIn': if ((arg as unknown[]).some((x) => eq(value, x))) return false; break;
      case 'not': if (scalarMatch(value, arg)) return false; break;
      case 'contains': if (typeof value !== 'string' || !value.toLowerCase().includes(String(arg).toLowerCase())) return false; break;
      case 'startsWith': if (typeof value !== 'string' || !value.startsWith(String(arg))) return false; break;
      case 'endsWith': if (typeof value !== 'string' || !value.endsWith(String(arg))) return false; break;
      case 'gt': if (value == null || !((cmp(value) as number) > (cmp(arg) as number))) return false; break;
      case 'gte': if (value == null || !((cmp(value) as number) >= (cmp(arg) as number))) return false; break;
      case 'lt': if (value == null || !((cmp(value) as number) < (cmp(arg) as number))) return false; break;
      case 'lte': if (value == null || !((cmp(value) as number) <= (cmp(arg) as number))) return false; break;
      case 'mode': break;
      default: throw new Error(`memoryDb: unsupported filter operator "${op}"`);
    }
  }
  return true;
}

export class MemoryDb {
  store: Record<string, Row[]> = Object.fromEntries(Object.keys(MODELS).map((m) => [m, []]));
  private seq = 0n;

  related(model: string, row: Row, field: string): Row | Row[] | null {
    const rel = MODELS[model].relations[field];
    if (rel.kind === 'one') return this.store[rel.model].find((r) => eq(r[MODELS[rel.model].pk], row[rel.fk])) ?? null;
    return this.store[rel.model].filter((r) => eq(r[rel.refFk], row[MODELS[model].pk]));
  }

  matches(model: string, row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'AND') { if (![cond].flat().every((w) => this.matches(model, row, w as Row))) return false; continue; }
      if (key === 'OR') { if (!(cond as Row[]).some((w) => this.matches(model, row, w))) return false; continue; }
      if (key === 'NOT') { if ([cond].flat().some((w) => this.matches(model, row, w as Row))) return false; continue; }
      const rel = MODELS[model].relations[key];
      if (rel) {
        const c = (cond ?? {}) as Row;
        if (rel.kind === 'one') {
          const target = this.related(model, row, key) as Row | null;
          const inner = ('is' in c ? c.is : c) as Row | null;
          if (inner === null) { if (target) return false; continue; }
          if (!target || !this.matches(rel.model, target, inner)) return false;
        } else {
          const items = this.related(model, row, key) as Row[];
          if (c.some !== undefined && !items.some((r) => this.matches(rel.model, r, c.some as Row))) return false;
          if (c.every !== undefined && !items.every((r) => this.matches(rel.model, r, c.every as Row))) return false;
          if (c.none !== undefined && items.some((r) => this.matches(rel.model, r, c.none as Row))) return false;
        }
        continue;
      }
      // compound unique key, e.g. name_version: { name, version }
      if (key.includes('_') && cond && typeof cond === 'object' && !(cond instanceof Date) && !(key in row)) {
        if (!this.matches(model, row, cond as Row)) return false;
        continue;
      }
      if (!scalarMatch(row[key], cond)) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // shaping (include / select / orderBy)
  // -------------------------------------------------------------------------

  sort(rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows;
    const keys = [orderBy].flat() as Record<string, 'asc' | 'desc'>[];
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const [f, dir] = Object.entries(k)[0];
        const x = cmp(a[f]) as number | string | null;
        const y = cmp(b[f]) as number | string | null;
        if (x === y) continue;
        if (x === null || x === undefined) return dir === 'asc' ? -1 : 1;
        if (y === null || y === undefined) return dir === 'asc' ? 1 : -1;
        const r = x < y ? -1 : 1;
        return dir === 'desc' ? -r : r;
      }
      return 0;
    });
  }

  shape(model: string, row: Row, args: { include?: Row; select?: Row } = {}): Row {
    const def = MODELS[model];
    if (args.select) {
      const out: Row = {};
      for (const [k, v] of Object.entries(args.select)) {
        if (!v) continue;
        if (def.relations[k]) out[k] = this.relationValue(model, row, k, v);
        else out[k] = clone(row[k]);
      }
      return out;
    }
    const out: Row = clone(row);
    for (const [k, v] of Object.entries(args.include ?? {})) {
      if (v) out[k] = this.relationValue(model, row, k, v);
    }
    return out;
  }

  private relationValue(model: string, row: Row, field: string, spec: unknown): unknown {
    const rel = MODELS[model].relations[field];
    const a = (spec === true ? {} : spec) as Row;
    if (rel.kind === 'one') {
      const t = this.related(model, row, field) as Row | null;
      return t ? this.shape(rel.model, t, a as { include?: Row; select?: Row }) : null;
    }
    let items = (this.related(model, row, field) as Row[]).filter((r) => this.matches(rel.model, r, a.where as Row));
    items = this.sort(items, a.orderBy);
    if (a.skip) items = items.slice(a.skip as number);
    if (a.take !== undefined) items = items.slice(0, a.take as number);
    return items.map((r) => this.shape(rel.model, r, a as { include?: Row; select?: Row }));
  }

  // -------------------------------------------------------------------------
  // writes
  // -------------------------------------------------------------------------

  private checkUnique(model: string, row: Row) {
    for (const fields of MODELS[model].unique) {
      const dup = this.store[model].find((r) => r !== row && fields.every((f) => eq(r[f], row[f])));
      if (dup) throw knownError('P2002', `Unique constraint failed on ${model}(${fields.join(',')})`, { target: fields });
    }
    const pk = MODELS[model].pk;
    if (this.store[model].some((r) => r !== row && eq(r[pk], row[pk]))) {
      throw knownError('P2002', `Unique constraint failed on ${model}.${pk}`, { target: [pk] });
    }
  }

  private applyData(model: string, row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined || MODELS[model].relations[k]) continue;
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && ('set' in v || 'increment' in v || 'decrement' in v)) {
        const o = v as { set?: unknown; increment?: number; decrement?: number };
        if ('set' in o) row[k] = clone(o.set);
        if (o.increment !== undefined) row[k] = Number(row[k] ?? 0) + o.increment;
        if (o.decrement !== undefined) row[k] = Number(row[k] ?? 0) - o.decrement;
      } else {
        row[k] = clone(v);
      }
    }
  }

  createRow(model: string, data: Row): Row {
    const def = MODELS[model];
    const row: Row = def.defaults();
    if (def.autoincrement) row[def.pk] = ++this.seq;
    this.applyData(model, row, data);
    this.checkUnique(model, row);
    this.store[model].push(row);
    for (const [k, v] of Object.entries(data)) {
      const rel = def.relations[k];
      if (!rel || !v || rel.kind !== 'many') continue;
      const nested = (v as Row).create;
      for (const child of [nested ?? []].flat() as Row[]) this.createRow(rel.model, { ...child, [rel.refFk]: row[def.pk] });
    }
    return row;
  }

  deleteRow(model: string, row: Row) {
    for (const c of MODELS[model].cascade ?? []) {
      this.store[c.model] = this.store[c.model].filter((r) => !eq(r[c.refFk], row[MODELS[model].pk]));
    }
    this.store[model] = this.store[model].filter((r) => r !== row);
  }

  // -------------------------------------------------------------------------
  // delegate (prisma.<model>)
  // -------------------------------------------------------------------------

  delegate(model: string) {
    const find = (where?: Row) => this.store[model].filter((r) => this.matches(model, r, where));
    const one = (where: Row) => find(where)[0] ?? null;
    return {
      findUnique: async (a: Row) => { const r = one(a.where as Row); return r ? this.shape(model, r, a) : null; },
      findUniqueOrThrow: async (a: Row) => {
        const r = one(a.where as Row);
        if (!r) throw knownError('P2025', `No ${model} found`);
        return this.shape(model, r, a);
      },
      findFirst: async (a: Row = {}) => {
        const r = this.sort(find(a.where as Row), a.orderBy)[0];
        return r ? this.shape(model, r, a) : null;
      },
      findFirstOrThrow: async (a: Row = {}) => {
        const r = this.sort(find(a.where as Row), a.orderBy)[0];
        if (!r) throw knownError('P2025', `No ${model} found`);
        return this.shape(model, r, a);
      },
      findMany: async (a: Row = {}) => {
        let rows = this.sort(find(a.where as Row), a.orderBy);
        if (a.skip) rows = rows.slice(a.skip as number);
        if (a.take !== undefined) rows = rows.slice(0, a.take as number);
        return rows.map((r) => this.shape(model, r, a));
      },
      count: async (a: Row = {}) => find(a.where as Row).length,
      create: async (a: Row) => this.shape(model, this.createRow(model, a.data as Row), a),
      createMany: async (a: Row) => { for (const d of a.data as Row[]) this.createRow(model, d); return { count: (a.data as Row[]).length }; },
      update: async (a: Row) => {
        const r = one(a.where as Row);
        if (!r) throw knownError('P2025', `Record to update not found (${model})`);
        const backup = clone(r);
        this.applyData(model, r, a.data as Row);
        try { this.checkUnique(model, r); } catch (e) { Object.assign(r, backup); throw e; }
        return this.shape(model, r, a);
      },
      updateMany: async (a: Row) => {
        const rows = find(a.where as Row);
        for (const r of rows) this.applyData(model, r, a.data as Row);
        return { count: rows.length };
      },
      upsert: async (a: Row) => {
        const r = one(a.where as Row);
        if (r) {
          this.applyData(model, r, a.update as Row);
          this.checkUnique(model, r);
          return this.shape(model, r, a);
        }
        return this.shape(model, this.createRow(model, a.create as Row), a);
      },
      delete: async (a: Row) => {
        const r = one(a.where as Row);
        if (!r) throw knownError('P2025', `Record to delete not found (${model})`);
        const out = this.shape(model, r, a);
        this.deleteRow(model, r);
        return out;
      },
      deleteMany: async (a: Row = {}) => {
        const rows = find(a.where as Row);
        for (const r of rows) this.deleteRow(model, r);
        return { count: rows.length };
      },
    };
  }
}

/** Builds a Prisma-shaped client backed by MemoryDb. */
export function createMemoryPrisma(db = new MemoryDb()) {
  const client: Record<string, unknown> = {
    _memory: db,
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const snapshot = clone(db.store);
      try {
        return await (arg as (tx: unknown) => Promise<unknown>)(client);
      } catch (e) {
        db.store = snapshot; // rollback
        throw e;
      }
    },
  };
  for (const m of Object.keys(MODELS)) client[m] = db.delegate(m);
  return client;
}
