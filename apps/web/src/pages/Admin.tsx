import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth, useCan } from '../auth';
import { PageHead } from '../components';

const ROLE_CLASS: Record<string, string> = { admin: 'b-primary', manager: 'b-neutral', analyst: 'b-neutral', viewer: 'b-neutral' };
const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
const blank = { id: '', name: '', email: '', role: 'analyst', extraPermissions: [] as string[], deniedPermissions: [] as string[], active: true, password: '' };

export default function Admin() {
  const can = useCan();
  const { actor, reload } = useAuth();
  const [tab, setTab] = useState<'users' | 'roles' | 'audit'>(can('users.manage') ? 'users' : 'audit');
  const [meta, setMeta] = useState<{ permissions: any[]; roles: any[] }>();
  const [users, setUsers] = useState<any[]>([]);
  const [edit, setEdit] = useState<typeof blank>();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api('/admin/users').then(setUsers).catch((e) => setErr(e.message));
  useEffect(() => {
    if (can('users.manage')) { api('/admin/permissions').then(setMeta); load(); }
  }, []);

  const rolePerms = (role: string) => meta?.roles.find((r) => r.key === role)?.permissions ?? [];
  const effective = (u: typeof blank) => (meta?.permissions ?? []).map((p) => p.key).filter((k) => (rolePerms(u.role).includes(k) && !u.deniedPermissions.includes(k)) || u.extraPermissions.includes(k));
  const toggle = (k: string, on: boolean) => {
    if (!edit) return;
    const inRole = rolePerms(edit.role).includes(k);
    const extra = edit.extraPermissions.filter((x) => x !== k);
    const denied = edit.deniedPermissions.filter((x) => x !== k);
    if (on && !inRole) extra.push(k);
    if (!on && inRole) denied.push(k);
    setEdit({ ...edit, extraPermissions: extra, deniedPermissions: denied });
  };
  const save = async () => {
    if (!edit) return;
    setErr(''); setMsg('');
    try {
      const body = { name: edit.name, email: edit.email, role: edit.role, extraPermissions: edit.extraPermissions, deniedPermissions: edit.deniedPermissions, active: edit.active, password: edit.password || undefined };
      if (edit.id) await api(`/admin/users/${edit.id}`, { method: 'PUT', json: body }); else await api('/admin/users', { json: body });
      setMsg(`${edit.id ? 'Saved' : 'Added'} ${edit.name}.`); setEdit(undefined); load();
    } catch (e: any) { setErr(e.message); }
  };
  const viewAs = async (u: any) => {
    setErr('');
    try { await api(`/admin/impersonate/${u.id}`, { method: 'POST' }); await reload(); window.location.assign('/'); } catch (e: any) { setErr(e.message); }
  };

  const activeCount = users.filter((u) => u.active).length;
  const tabs: [typeof tab, string, boolean][] = [['users', 'Users', can('users.manage')], ['roles', 'Roles and permissions', can('users.manage')], ['audit', 'Audit log', can('audit.view')]];
  return (
    <>
      <PageHead eyebrow="Admin" title="Users and access">
        {can('users.manage') ? <><b>{activeCount}</b> active {activeCount === 1 ? 'user' : 'users'} across <b>{new Set(users.filter((u) => u.active).map((u) => u.role)).size}</b> roles. Every sign-in, change and "view as" session is recorded in the audit log.</> : 'Sign-ins, changes and "view as" sessions, newest first.'}
      </PageHead>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="tabs" style={{ marginBottom: 0 }}>{tabs.filter((t) => t[2]).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'users' && <button className="primary" onClick={() => setEdit({ ...blank })}>Add user</button>}
      </div>
      {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="fg-callout" style={{ marginBottom: 16 }}>{msg}</div>}

      {edit && meta && (
        <div className="panel">
          <h3>{edit.id ? `Edit ${edit.name}` : 'Add a user'}</h3>
          <div className="grid2">
            <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Email<input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
            <label>Role<select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value, extraPermissions: [], deniedPermissions: [] })}>{meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}: {r.description}</option>)}</select></label>
            <label>{edit.id ? 'New password (leave blank to keep)' : 'Starting password'}<input type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder="At least 10 characters" /></label>
          </div>
          <h3>Permissions</h3>
          <p className="fg-note">The role sets the starting permissions. Tick or untick any box to change them for this person only.</p>
          <div className="fg-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
            {[...new Set(meta.permissions.map((p) => p.group))].map((g) => (
              <div key={g}>
                <div className="fg-eyebrow" style={{ marginBottom: 6 }}>{g}</div>
                {meta.permissions.filter((p) => p.group === g).map((p) => {
                  const on = effective(edit).includes(p.key);
                  const changed = on !== rolePerms(edit.role).includes(p.key);
                  return <label key={p.key} className="check"><input type="checkbox" checked={on} onChange={(e) => toggle(p.key, e.target.checked)} />{p.label}{changed && <span className="badge b-warn">changed from role</span>}</label>;
                })}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Account active (unticking signs them out)</label>
            <span style={{ flex: 1 }} />
            <button onClick={() => setEdit(undefined)}>Cancel</button>
            <button className="primary" disabled={!edit.name || !edit.email || (!edit.id && edit.password.length < 10)} onClick={save}>{edit.id ? 'Save changes' : 'Add user'}</button>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="panel">
          <h3>Users</h3>
          <div className="fg-tablebox"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Changes from role</th><th className="num">Proposals</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b>{u.id === actor?.id && <span className="muted small"> (you)</span>}</td>
                <td>{u.email}</td>
                <td><span className={`badge ${ROLE_CLASS[u.role]}`}>{u.role}</span></td>
                <td className="small">{[...u.extra_permissions.map((p: string) => `+ ${p}`), ...u.denied_permissions.map((p: string) => `− ${p}`)].join(', ') || <span className="muted">none</span>}</td>
                <td className="num">{u.proposals}</td>
                <td className="small">{when(u.last_login_at)}</td>
                <td><span className={`badge ${u.active ? 'b-ok' : 'b-bad'}`}>{u.active ? 'Active' : 'Off'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="small" onClick={() => setEdit({ id: u.id, name: u.name, email: u.email, role: u.role, extraPermissions: u.extra_permissions, deniedPermissions: u.denied_permissions, active: u.active, password: '' })}>Edit</button>{' '}
                  {can('users.impersonate') && u.id !== actor?.id && u.active && <button className="small" onClick={() => viewAs(u)}>View as</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {tab === 'roles' && meta && (
        <div className="panel">
          <h3>What each role can do</h3>
          <p className="fg-note">Change a single person's access from their Edit form; roles stay the same for everyone.</p>
          <div className="fg-tablebox"><table>
            <thead><tr><th>Permission</th>{meta.roles.map((r) => <th key={r.key} style={{ textAlign: 'center' }}>{r.label}</th>)}</tr></thead>
            <tbody>{[...new Set(meta.permissions.map((p) => p.group))].map((g) => (
              <Fragment key={g}>
                <tr className="fg-all"><td colSpan={meta.roles.length + 1}>{g}</td></tr>
                {meta.permissions.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key}><td>{p.label}</td>{meta.roles.map((r) => <td key={r.key} style={{ textAlign: 'center' }}>{r.permissions.includes(p.key) ? <span className="badge b-ok">Yes</span> : <span className="muted">—</span>}</td>)}</tr>
                ))}
              </Fragment>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {tab === 'audit' && <AuditLog users={users} />}
    </>
  );
}

function AuditLog({ users }: { users: any[] }) {
  const [rows, setRows] = useState<any[]>();
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  useEffect(() => { api(`/admin/audit?limit=300${user ? `&user=${user}` : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}`).then(setRows).catch(() => setRows([])); }, [user, action]);
  const label = useMemo(() => (a: string) => ({ login: 'Signed in', 'login.failed': 'Failed sign-in', logout: 'Signed out', 'impersonate.start': 'Started viewing as', 'impersonate.stop': 'Stopped viewing as', 'user.create': 'Added user', 'user.update': 'Changed user', 'report.publish': 'Published client link', 'report.revoke': 'Revoked client link', 'proposal.status': 'Changed proposal status', 'proposal.delete': 'Deleted proposal', 'password.changed': 'Changed password', 'setup.first_admin': 'Created first admin', 'POST /api/proposals': 'Created proposal', 'PUT /api/proposals/:id': 'Saved proposal', 'POST /api/proposals/:id/recalculate': 'Recalculated proposal', 'POST /api/proposals/:id/duplicate': 'Copied proposal', 'POST /api/clients': 'Added client', 'PUT /api/clients/:id': 'Changed client', 'POST /api/clients/:id/employees': 'Added employee', 'PUT /api/employees/:id': 'Changed employee', 'POST /api/clients/:id/payruns': 'Saved pay run' } as Record<string, string>)[a] ?? a, []);
  return (
    <div className="panel">
      <h3>Audit log</h3>
      <div className="row" style={{ marginBottom: 12 }}>
        <label>Person<select value={user} onChange={(e) => setUser(e.target.value)}><option value="">Everyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label>Action contains<input value={action} onChange={(e) => setAction(e.target.value)} placeholder="impersonate, login, proposal…" /></label>
      </div>
      <div className="fg-tablebox tall"><table>
        <thead><tr><th>When</th><th>Who</th><th>Viewing as</th><th>What</th><th>On</th><th className="fg-hide-narrow">Details</th></tr></thead>
        <tbody>{(rows ?? []).map((r) => (
          <tr key={r.id}>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
            <td>{r.actor_name ?? <span className="muted">—</span>}</td>
            <td>{r.as_user_name ? <span className="badge b-warn">{r.as_user_name}</span> : <span className="muted">—</span>}</td>
            <td>{label(r.action)}</td>
            <td className="small">{r.target}</td>
            <td className="small muted fg-hide-narrow">{r.detail && !(Object.keys(r.detail).length === 1 && 'status' in r.detail) ? JSON.stringify(r.detail) : ''}{r.ip ? ` · ${r.ip}` : ''}</td>
          </tr>
        ))}
          {rows && !rows.length && <tr><td colSpan={6} className="muted">Nothing logged yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
