import { createContext, useContext, useState, lazy, Suspense, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useBlocker,
  useLocation,
} from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpen,
  Box,
  ChevronRight,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Plus,
  RotateCcw,
  Terminal,
  Check,
  ShieldCheck,
} from 'lucide-react';
import type { Repository, SessionInfo } from '@releasedesk/contracts';
import { api, getSession, refreshSession } from './api';
import { Loading, ErrorNotice, Modal } from './ui';
import { Dashboard, RepositoryPage } from './Dashboard';
const ReleasePage = lazy(() =>
  import('./ReleasePage').then((module) => ({ default: module.ReleasePage })),
);
import s from './App.module.css';

const SessionContext = createContext<SessionInfo>(null!);
export const useSession = () => useContext(SessionContext);
const DirtyContext = createContext({ dirty: false, setDirty: (_value: boolean) => {} });
export const useDirty = () => useContext(DirtyContext);
export function Logo() {
  return (
    <div className={s.logo}>
      <span className={s.logoMark}>
        R<span>↗</span>
      </span>
      <span>
        ReleaseDesk<span className={s.logoDot}>.</span>
      </span>
    </div>
  );
}
export function App() {
  const routeLocation = useLocation();
  const session = useQuery({ queryKey: ['session'], queryFn: getSession, staleTime: Infinity });
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(dirty);
  if (session.isPending) return <Loading />;
  if (session.error)
    return (
      <main className={s.connection}>
        <Logo />
        <h1>Your workspace is taking a moment.</h1>
        <ErrorNotice error={session.error} />
        <button className={s.primary} onClick={() => void session.refetch()}>
          Try again
        </button>
      </main>
    );
  return (
    <SessionContext.Provider value={session.data}>
      <DirtyContext.Provider value={{ dirty, setDirty }}>
        {session.data.authenticated ? (
          <Shell>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/repositories/:id" element={<RepositoryPage />} />
                <Route
                  path="/releases/:id"
                  element={<ReleasePage key={routeLocation.pathname} />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </Shell>
        ) : (
          <Login />
        )}
        {blocker.state === 'blocked' && (
          <Modal title="Leave unsaved edits?" onClose={() => blocker.reset()}>
            <p className={s.muted}>
              Your open edits have not been saved. Stay to finish them, or leave and discard them.
            </p>
            <div className={s.modalActions}>
              <button className={s.secondary} onClick={() => blocker.reset()}>
                Keep editing
              </button>
              <button
                className={s.danger}
                onClick={() => {
                  setDirty(false);
                  blocker.proceed();
                }}
              >
                Discard and leave
              </button>
            </div>
          </Modal>
        )}
      </DirtyContext.Provider>
    </SessionContext.Provider>
  );
}
function Login() {
  const session = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const signIn = async (demo = false) => {
    setPending(true);
    setError(undefined);
    try {
      await api(
        '/auth/login',
        'POST',
        demo
          ? { username: session.demo.username, password: session.demo.password }
          : { username, password },
      );
      await refreshSession();
      navigate('/');
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className={s.login}>
      <section className={s.loginStory}>
        <Logo />
        <div className={s.storyContent}>
          <span className={s.eyebrow}>FOR THE PEOPLE WHO SHIP</span>
          <h1>
            Good releases
            <br />
            need a little
            <br />
            <em>room to grow.</em>
          </h1>
          <p>
            Turn a stream of commits into a release worth sharing. A thoughtful workspace for the
            notes, decisions, and last little checks.
          </p>
          <div className={s.storyCard}>
            <div>
              <GitBranch size={16} />
              <span>next-release</span>
              <span className={s.liveDot} /> Draft saved
            </div>
            <strong>Keep the human part.</strong>
            <p>
              Rewrite it. Categorize it. Sync again.
              <br />
              Your editorial decisions stay yours.
            </p>
            <div className={s.storyChecks}>
              <span>
                <Check size={14} /> Notes considered
              </span>
              <span>
                <Check size={14} /> Ready to ship
              </span>
            </div>
          </div>
        </div>
        <span className={s.storyFooter}>
          Built for open-source maintainers. Made for your workflow.
        </span>
      </section>
      <section className={s.loginForm}>
        <div className={s.loginInner}>
          <span className={s.kicker}>YOUR RELEASE WORKSPACE</span>
          <h2>Welcome to your desk.</h2>
          <p className={s.muted}>Pick up where your next release left off.</p>
          <ErrorNotice error={error} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <label>
              Username
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className={s.primary} disabled={pending} type="submit">
              {pending ? 'Opening workspace…' : 'Sign in'}
              <ArrowUpRight size={17} />
            </button>
          </form>
          {session.demo.enabled && (
            <div className={s.demoLogin}>
              <span className={s.smallLabel}>
                <FlaskConical size={15} /> JUST LOOKING AROUND?
              </span>
              <h3>Take a seat. Try the demo.</h3>
              <p>
                A fresh sandbox with real public repository data. Your edits are yours for 24 hours.
              </p>
              <button className={s.secondary} disabled={pending} onClick={() => void signIn(true)}>
                Open demo workspace <ChevronRight size={16} />
              </button>
              <div className={s.credentials}>
                Demo sign-in <code>{session.demo.username}</code>
                <span>/</span>
                <code>{session.demo.password}</code>
              </div>
            </div>
          )}
          <p className={s.loginFootnote}>
            <ShieldCheck size={14} /> GitHub access is public and read-only.
          </p>
        </div>
      </section>
    </div>
  );
}
function Shell({ children }: { children: ReactNode }) {
  const session = useSession();
  const { dirty } = useDirty();
  const navigate = useNavigate();
  const repos = useQuery({
    queryKey: ['repositories'],
    queryFn: () => api<Repository[]>('/repositories'),
  });
  const [reset, setReset] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const resetSandbox = async () => {
    setPending(true);
    setError(undefined);
    try {
      await api('/demo/reset', 'POST', {});
      await refreshSession();
      setReset(false);
      navigate('/');
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const signOut = async () => {
    setError(undefined);
    try {
      await api('/auth/logout', 'POST', {});
      await refreshSession();
      navigate('/');
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className={s.app}>
      <aside className={s.sidebar}>
        <Link to="/" className={s.logoLink}>
          <Logo />
        </Link>
        <div className={s.workspaceLabel}>
          <span className={s.avatar}>{session.workspace?.kind === 'demo' ? 'D' : 'S'}</span>
          <div>
            <strong>
              {session.workspace?.kind === 'demo' ? 'Demo workspace' : 'Personal workspace'}
            </strong>
            <span>Open-source, thoughtfully shipped</span>
          </div>
        </div>
        <nav>
          <span className={s.navLabel}>WORKSPACE</span>
          <NavLink
            end
            to="/"
            className={({ isActive }) => `${s.navItem} ${isActive ? s.navActive : ''}`}
          >
            <LayoutDashboard size={18} />
            Overview
          </NavLink>
          <div className={s.navHeading}>
            <span className={s.navLabel}>REPOSITORIES</span>
            <Link to="/?add=repository" aria-label="Add repository">
              <Plus size={16} />
            </Link>
          </div>
          {repos.data?.map((repo) => (
            <NavLink
              key={repo.id}
              aria-label={`${repo.owner}/${repo.name}`}
              to={`/repositories/${repo.id}`}
              className={({ isActive }) => `${s.navItem} ${isActive ? s.navActive : ''}`}
            >
              <GitBranch size={17} />
              <span className={s.repoNavName}>{repo.name}</span>
              <small>{repo.draftCount}</small>
            </NavLink>
          ))}
        </nav>
        <button
          className={`${s.iconButton} ${s.mobileSignOut}`}
          aria-label="Sign out"
          disabled={dirty}
          onClick={() => void signOut()}
        >
          <LogOut size={17} />
        </button>
        <div className={s.sidebarBottom}>
          <div className={s.sidebarNote}>
            <Box size={18} />
            <strong>A little space to ship.</strong>
            <p>
              Your notes, your decisions,
              <br />
              every release in one place.
            </p>
          </div>
          <a
            href="https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases"
            target="_blank"
            rel="noreferrer"
            className={s.navItem}
          >
            <BookOpen size={16} />
            Release documentation
            <ArrowUpRight size={14} />
          </a>
          <div className={s.userRow}>
            <span className={s.userAvatar}>{session.username?.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{session.username}</strong>
              <span>{session.workspace?.kind === 'demo' ? '24-hour sandbox' : 'Maintainer'}</span>
            </div>
            <button
              className={s.iconButton}
              aria-label="Sign out"
              disabled={dirty}
              onClick={() => void signOut()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className={s.mainColumn}>
        <header className={s.topbar}>
          <span>
            <Terminal size={15} />
            Workspace <ChevronRight size={13} />
            <strong>Release preparation</strong>
          </span>
          <span className={s.readOnly}>
            <span className={s.liveDot} /> GitHub · read-only
          </span>
        </header>
        {session.workspace?.kind === 'demo' && (
          <div className={s.demoBar}>
            <span>
              <FlaskConical size={15} />
              Your personal demo sandbox{' '}
              <span className={s.demoExpiry}>
                · expires{' '}
                {new Date(session.workspace.expiresAt!).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </span>
            <button disabled={dirty} onClick={() => setReset(true)}>
              <RotateCcw size={13} />
              Reset sandbox
            </button>
          </div>
        )}
        <main className={s.main}>
          {!reset && <ErrorNotice error={error} />} {children}
        </main>
        <footer className={s.footer}>
          <span>
            ReleaseDesk <span> / </span> From commits to a considered release.
          </span>
          <span>Public repositories. Human decisions.</span>
        </footer>
      </div>
      {reset && (
        <Modal title="Start with a fresh desk?" onClose={() => setReset(false)}>
          <p className={s.muted}>
            This deletes your current demo drafts and creates fresh sample data. Other visitors and
            the owner workspace are unaffected.
          </p>
          <ErrorNotice error={error} />
          <div className={s.modalActions}>
            <button className={s.secondary} onClick={() => setReset(false)}>
              Keep my workspace
            </button>
            <button className={s.danger} disabled={pending} onClick={() => void resetSandbox()}>
              {pending ? 'Resetting…' : 'Reset sandbox'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
