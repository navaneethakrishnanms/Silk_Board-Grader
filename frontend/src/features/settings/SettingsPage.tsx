/** S15 — settings: users & roles, presets, decision options, wash methods, guideline, models, engine health. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { GRADES, gradeLabel, ROLES, type Role, type SettingsDTO } from '@silkgrade/shared';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, Select, Spinner, Switch, Table, Tabs, Td, Textarea, Th } from '@/components/ui';
import { api, type CompareDTO } from '@/lib/api';
import { fmtDateTime, toast } from '@/lib/utils';

type Tab = 'general' | 'users' | 'models';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'general', label: 'Lab & grading' }, { value: 'users', label: 'Users & roles' }, { value: 'models', label: 'Models & engine' }]} />
      <div className="mt-4">{tab === 'general' ? <GeneralSettings /> : tab === 'users' ? <Users /> : <Models />}</div>
    </>
  );
}

function GeneralSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'all'], queryFn: api.settings });
  const [s, setS] = useState<SettingsDTO | null>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.saveSettings({
      labName: s!.labName, washMethods: s!.washMethods.filter(Boolean), requiredPresets: s!.requiredPresets, captureGuideline: s!.captureGuideline,
      stainStatistic: s!.stainStatistic, changeRule: s!.changeRule, autoCompleteAuto: s!.autoCompleteAuto, blindDisagreementLimit: s!.blindDisagreementLimit, consensusRule: s!.consensusRule, backgroundMode: s!.backgroundMode,
    }),
    onSuccess: (d) => { setS(d); toast.ok('Settings saved'); void qc.invalidateQueries({ queryKey: ['settings'] }); },
  });
  if (!s) return <Spinner />;
  const grades = [...GRADES].reverse();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Laboratory" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Lab name (UI and PDF)" htmlFor="lab"><Input id="lab" value={s.labName} onChange={(e) => setS({ ...s, labName: e.target.value })} /></Field>
          <Field label="Wash methods (one per line)" htmlFor="wm"><Textarea id="wm" rows={5} value={s.washMethods.join('\n')} onChange={(e) => setS({ ...s, washMethods: e.target.value.split('\n') })} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Required grade presets" subtitle="Per customer or product" actions={<Button size="sm" variant="outline" onClick={() => setS({ ...s, requiredPresets: [...s.requiredPresets, { name: 'New preset', customer: null, change: 4, stain: 3.5 }] })}><Plus className="size-4" /> Add</Button>} />
        <Table>
          <thead><tr><Th>Name</Th><Th>Customer</Th><Th>Change</Th><Th>Staining</Th><Th /></tr></thead>
          <tbody>
            {s.requiredPresets.map((p, i) => {
              const upd = (patch: Partial<typeof p>) => setS({ ...s, requiredPresets: s.requiredPresets.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <tr key={i}>
                  <Td><Input aria-label="Preset name" value={p.name} onChange={(e) => upd({ name: e.target.value })} /></Td>
                  <Td><Input aria-label="Customer" value={p.customer ?? ''} onChange={(e) => upd({ customer: e.target.value || null })} /></Td>
                  <Td><Select aria-label="Change grade" value={p.change ?? ''} onChange={(e) => upd({ change: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{grades.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</Select></Td>
                  <Td><Select aria-label="Staining grade" value={p.stain ?? ''} onChange={(e) => upd({ stain: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{grades.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</Select></Td>
                  <Td><Button size="sm" variant="ghost" aria-label="Delete preset" onClick={() => setS({ ...s, requiredPresets: s.requiredPresets.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Decision rules" subtitle="Thresholds of the formulas live in the engine config (VERIFY values)" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Staining statistic" hint="p90 = most-stained area · median = average" htmlFor="ss">
            <Select id="ss" value={s.stainStatistic} onChange={(e) => setS({ ...s, stainStatistic: e.target.value as 'p90' | 'median' })}><option value="p90">p90 (most stained)</option><option value="median">Median</option></Select>
          </Field>
          <Field label="Printed fabrics — overall change" htmlFor="cr">
            <Select id="cr" value={s.changeRule} onChange={(e) => setS({ ...s, changeRule: e.target.value as 'area_weighted' | 'worst' })}><option value="area_weighted">Area-weighted</option><option value="worst">Worst colour</option></Select>
          </Field>
          <Field label="Blind labelling consensus" hint="Third assessor = any A/B disagreement goes to Expert C (design default)" htmlFor="cr2">
            <Select id="cr2" value={s.consensusRule} onChange={(e) => setS({ ...s, consensusRule: e.target.value as SettingsDTO['consensusRule'] })}>
              <option value="third_assessor">Third assessor decides any disagreement</option>
              <option value="lower">Lower grade if within limit, else third assessor</option>
              <option value="mean_round_down">Mean rounded down if within limit, else third assessor</option>
            </Select>
          </Field>
          <Field label="A/B limit (lower / mean rules)" hint="Ignored by the third-assessor rule" htmlFor="bl">
            <Select id="bl" value={s.blindDisagreementLimit} onChange={(e) => setS({ ...s, blindDisagreementLimit: Number(e.target.value) })}><option value={0}>0 (must match)</option><option value={0.5}>0.5</option><option value={1}>1.0</option></Select>
          </Field>
          <Field label="Scan / photo background" hint="White = fabric on white paper (detects white fabric by texture)" htmlFor="bgm">
            <Select id="bgm" value={s.backgroundMode} onChange={(e) => setS({ ...s, backgroundMode: e.target.value as SettingsDTO['backgroundMode'] })}>
              <option value="auto">Auto-detect</option><option value="white">White paper</option><option value="grey">Grey board</option><option value="black">Black board</option>
            </Select>
          </Field>
          <Field label="Auto-complete" hint="Complete tests automatically when every grade is AUTO">
            <Switch checked={s.autoCompleteAuto} onChange={(v) => setS({ ...s, autoCompleteAuto: v })} label={s.autoCompleteAuto ? 'On' : 'Off'} />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Capture guideline" subtitle="Shown to testers in the upload screens (one rule per line)" />
        <div className="p-4"><Textarea rows={10} value={s.captureGuideline} onChange={(e) => setS({ ...s, captureGuideline: e.target.value })} /></div>
      </Card>
      <ErrorBox error={save.error} />
      <div className="flex justify-end"><Button size="lg" loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button></div>
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [n, setN] = useState({ name: '', email: '', password: '', role: 'TESTER' as Role });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({ mutationFn: () => api.createUser(n), onSuccess: () => { toast.ok('User created'); setN({ name: '', email: '', password: '', role: 'TESTER' }); void refresh(); } });
  const upd = async (id: string, b: unknown) => { try { await api.updateUser(id, b); void refresh(); } catch (e) { toast.error(e); } };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Users" />
        {!q.data ? <div className="p-4"><Spinner /></div> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Created</Th><Th /></tr></thead>
            <tbody>
              {q.data.map((u) => (
                <tr key={u.id}>
                  <Td>{u.name}</Td><Td>{u.email}</Td>
                  <Td><Select aria-label="Role" className="w-32" value={u.role} onChange={(e) => upd(u.id, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Td>
                  <Td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                  <Td className="muted text-xs">{fmtDateTime(u.createdAt)}</Td>
                  <Td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => upd(u.id, { active: !u.active })}>{u.active ? 'Deactivate' : 'Activate'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { const p = prompt(`New password for ${u.email} (min 8 chars)`); if (p) void upd(u.id, { password: p }); }}>Reset password</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Add user" />
        <form className="grid gap-3 p-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Name" htmlFor="un"><Input id="un" required value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <Field label="Email" htmlFor="ue"><Input id="ue" type="email" required value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></Field>
          <Field label="Password" htmlFor="up"><Input id="up" type="password" minLength={8} required value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} /></Field>
          <Field label="Role" htmlFor="ur"><Select id="ur" value={n.role} onChange={(e) => setN({ ...n, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
          <div className="flex items-end"><Button type="submit" loading={create.isPending}>Add user</Button></div>
        </form>
        <div className="px-4 pb-4"><ErrorBox error={create.error} /></div>
      </Card>
    </div>
  );
}

function Models() {
  const qc = useQueryClient();
  const models = useQuery({ queryKey: ['models'], queryFn: api.models });
  const health = useQuery({ queryKey: ['engine-health'], queryFn: api.engineHealth, refetchInterval: 15_000 });
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<CompareDTO | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['models'] });
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
  return (
    <div className="space-y-4">
      {compare && (
        <Card>
          <CardHeader
            title={`Compare ${compare.model} ${compare.candidate.version} with ${compare.active ? `active ${compare.active.version}` : 'formula-only'}`}
            subtitle={`${compare.records} past expert-graded records — agreement of each model's half grade with the expert grade`}
            actions={<Button size="sm" variant="ghost" onClick={() => setCompare(null)}>Close</Button>}
          />
          {compare.records === 0 ? <p className="muted p-4 text-sm">No expert-graded records yet to compare on.</p> : (
            <Table>
              <thead><tr><Th>Model</Th><Th>n</Th><Th>Exact</Th><Th>Within ±0.5</Th><Th>Weighted kappa</Th><Th>MAE</Th></tr></thead>
              <tbody>
                {([['Candidate', compare.candidateAgreement], [compare.active ? 'Active' : 'Formula-only (active)', compare.activeAgreement], ['ISO formula', compare.formulaAgreement]] as const).map(([label, a]) => (
                  <tr key={label}><Td>{label}</Td><Td className="num">{a?.n}</Td><Td className="num">{pct(a?.exact)}</Td><Td className="num">{pct(a?.withinHalf)}</Td><Td className="num">{a?.qwk?.toFixed(3) ?? '—'}</Td><Td className="num">{a?.mae?.toFixed(3) ?? '—'}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      <Card>
        <CardHeader title="Engine health" />
        <div className="p-4 text-sm">
          {!health.data ? <Spinner /> : health.data.ok ? (
            <dl className="num grid grid-cols-2 gap-1 text-xs sm:max-w-md">
              <dt className="muted">Status</dt><dd><Badge tone="green">Online</Badge></dd>
              <dt className="muted">Engine version</dt><dd>{health.data.engine_version}</dd>
              <dt className="muted">ΔE_F verified</dt><dd>{health.data.dE_F_verified ? 'yes' : <Badge tone="violet">no — provisional</Badge>}</dd>
            </dl>
          ) : <ErrorBox error={`Engine offline: ${health.data.error}`} />}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Model versions"
          subtitle="Formula-only until a trained model is activated. Upload the package from training/export_model.py."
          actions={<>
            <Button size="sm" variant="outline" loading={busy} onClick={() => file.current?.click()}><Upload className="size-4" /> Upload model</Button>
            <input ref={file} type="file" accept=".json,.onnx" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (!f) return;
              setBusy(true);
              try { await api.uploadModel(f); toast.ok('Model uploaded'); void refresh(); } catch (err) { toast.error(err); } finally { setBusy(false); }
            }} />
          </>}
        />
        {!models.data ? <div className="p-4"><Spinner /></div> : !models.data.length ? <p className="muted p-4 text-sm">No models uploaded — grading runs in formula-only mode.</p> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Version</Th><Th>Metrics</Th><Th>Uploaded</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {models.data.map((m) => {
                const mv = (m.metrics?.model_val ?? m.metrics?.model_test) as Record<string, number> | undefined;
                return (
                  <tr key={m.id}>
                    <Td className="num">{m.name}</Td><Td className="num">{m.version}{m.metrics?.synthetic ? <Badge tone="violet" className="ml-2">synthetic</Badge> : null}</Td>
                    <Td className="num text-xs">{mv ? `within ±0.5 ${Math.round((mv.within_half ?? 0) * 100)}% · MAE ${mv.mae}` : '—'}</Td>
                    <Td className="muted text-xs">{fmtDateTime(m.createdAt)}</Td>
                    <Td>{m.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                    <Td className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={async () => { try { setCompare(await api.compareModel(m.id)); } catch (e) { toast.error(e); } }}>Compare</Button>
                      <Button size="sm" variant="outline" onClick={async () => { try { await api.activateModel(m.id, !m.active); void refresh(); } catch (e) { toast.error(e); } }}>{m.active ? 'Deactivate' : 'Activate'}</Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
