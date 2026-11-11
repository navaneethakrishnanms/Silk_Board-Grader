import { useState, type FormEvent } from 'react';
import { FlaskConical } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { accessToken, setSession } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (accessToken) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api.login(email, password));
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-fg)]">
            <FlaskConical className="size-6" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold">SilkGrade</h1>
          <p className="muted text-sm">Bangalore Silk Board — colour fastness grading</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
        </form>
      </Card>
    </div>
  );
}
