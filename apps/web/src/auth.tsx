import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

export interface Me { id: string; email: string; name: string; role: string; permissions: string[] }
interface AuthState { user?: Me; actor?: Me; impersonating?: boolean; setupRequired?: boolean; setupNeedsKey?: boolean; loading: boolean; reload: () => Promise<void> }

const Ctx = createContext<AuthState>({ loading: true, reload: async () => {} });
export const useAuth = () => useContext(Ctx);
export const useCan = () => { const { user } = useAuth(); return (p: string) => !!user?.permissions.includes(p); };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, 'reload'>>({ loading: true });
  const reload = useCallback(async () => {
    try {
      const r = await api('/auth/me');
      setState({ loading: false, user: r.user ?? undefined, actor: r.actor, impersonating: r.impersonating, setupRequired: r.setupRequired, setupNeedsKey: r.setupNeedsKey });
    } catch { setState({ loading: false }); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { const h = () => void reload(); window.addEventListener('auth:required', h); return () => window.removeEventListener('auth:required', h); }, [reload]);
  return <Ctx.Provider value={{ ...state, reload }}>{children}</Ctx.Provider>;
}

/** Sign-in card (docs/DESIGN.md §10). Also creates the first admin when the app has no users yet. */
export function Login() {
  const { setupRequired, setupNeedsKey, reload } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', setupKey: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api(setupRequired ? '/auth/setup' : '/auth/login', { json: setupRequired ? f : { email: f.email, password: f.password } });
      await reload();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="fg-login">
      <form className="fg-login-card" onSubmit={submit}>
        <LogoOrName />
        <h1>{setupRequired ? 'Create the first admin' : 'Sign in'}</h1>
        {setupRequired && <p className="muted small" style={{ marginTop: 0 }}>No one has an account yet. The first account is the admin, who then adds everyone else.</p>}
        {setupRequired && <label>Your name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required /></label>}
        <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" required /></label>
        <label>Password<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={setupRequired ? 'new-password' : 'current-password'} minLength={setupRequired ? 10 : undefined} required /></label>
        {setupRequired && setupNeedsKey && <label>Setup key<input type="password" value={f.setupKey} onChange={(e) => setF({ ...f, setupKey: e.target.value })} required /><span className="small">The APP_PASSWORD value from the Render service's Environment tab.</span></label>}
        {err && <div className="fg-login-err">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? 'One moment…' : setupRequired ? 'Create admin and sign in' : 'Sign in'}</button>
      </form>
    </div>
  );
}

/**
 * First Gen wordmark from apps/web/public/brand (never rebuilt); plain text until the files are added.
 * `presenter` is for pages a client sees: the internal app name is left out and, without logo files, the presenter's
 * name stands in for the wordmark.
 */
export function LogoOrName({ small, presenter }: { small?: boolean; presenter?: string }) {
  const [hasLogo, setHasLogo] = useState(true);
  const client = presenter !== undefined;
  return (
    <div className="fg-brand" style={small ? undefined : { padding: 0, marginBottom: 16 }}>
      {hasLogo ? (
        <>
          <img className="fg-logo-light" src="/brand/first-gen-wordmark-light.png" alt="First Gen" width={small ? 156 : 168} height={small ? 26 : 28} onError={() => setHasLogo(false)} />
          <img className="fg-logo-dark" src="/brand/first-gen-wordmark-dark.png" alt="First Gen" width={small ? 156 : 168} height={small ? 26 : 28} onError={() => setHasLogo(false)} />
        </>
      ) : client ? <span className="fg-appname">{presenter || 'First Gen'}</span> : <span className="fg-app">First Gen</span>}
      {!client && <span className="fg-appname">Payroll Tax Engine</span>}
    </div>
  );
}
