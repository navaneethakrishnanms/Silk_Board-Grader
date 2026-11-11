/** Key/value settings stored in the DB `Setting` table, with defaults. */
import type { Prisma } from '@prisma/client';
import { CAPTURE_GUIDELINE, type PublicSettingsDTO, type SettingsDTO, type SettingsInput } from '@silkgrade/shared';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

export const DEFAULT_SETTINGS: SettingsDTO = {
  labName: env.LAB_NAME,
  washMethods: [
    'ISO 105-C10 A (40 °C, 30 min)',
    'ISO 105-C10 B (50 °C, 45 min)',
    'ISO 105-C10 C (60 °C, 30 min)',
    'ISO 105-C06 A1S',
    'IS 764 (soap test)',
  ], // TODO VERIFY with the client (Section 16, Q2)
  requiredPresets: [
    { name: 'Default', customer: null, change: 4.0, stain: 3.5 },
    { name: 'Export grade', customer: null, change: 4.5, stain: 4.0 },
  ], // TODO VERIFY (Section 16, Q6)
  captureGuideline: CAPTURE_GUIDELINE.map((c) => `${c.code}. ${c.rule} — ${c.why}`).join('\n'),
  stainStatistic: 'p90',
  changeRule: 'area_weighted',
  dE_F_verified: false,
  autoCompleteAuto: false,
  blindDisagreementLimit: 0.5,
};

type Key = keyof SettingsDTO;

export async function getSettings(): Promise<SettingsDTO> {
  const rows = await prisma.setting.findMany();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as unknown as SettingsDTO;
}

export async function getPublicSettings(): Promise<PublicSettingsDTO> {
  const s = await getSettings();
  return {
    labName: s.labName,
    washMethods: s.washMethods,
    requiredPresets: s.requiredPresets,
    captureGuideline: s.captureGuideline,
    stainStatistic: s.stainStatistic,
    changeRule: s.changeRule,
    dE_F_verified: s.dE_F_verified,
  };
}

export async function updateSettings(input: SettingsInput): Promise<SettingsDTO> {
  const entries = Object.entries(input).filter(([k, v]) => v !== undefined && k in DEFAULT_SETTINGS) as [Key, unknown][];
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      }),
    ),
  );
  return getSettings();
}
