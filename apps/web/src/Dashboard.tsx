import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  FlaskConical,
  GitBranch,
  Plus,
  Settings2,
  Ship,
} from 'lucide-react';
import type { Release, ReleaseDetail, Repository } from '@releasedesk/contracts';
import { api, queryClient } from './api';
import { useSession } from './App';
import { Empty, ErrorNotice, Loading, Modal, relativeDate } from './ui';
import s from './App.module.css';

export function Dashboard() {
  const session = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const repos = useQuery({
    queryKey: ['repositories'],
    queryFn: () => api<Repository[]>('/repositories'),
  });
  const releases = useQuery({ queryKey: ['releases'], queryFn: () => api<Release[]>('/releases') });
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  if (repos.isPending || releases.isPending) return <Loading />;
  const drafts = releases.data?.filter((r) => r.status === 'draft') ?? [];
  const finalized = releases.data?.filter((r) => r.status === 'finalized') ?? [];
  const scenario = async () => {
    setPending(true);
    setError(undefined);
    try {
      const release = await api<ReleaseDetail>('/demo/scenario', 'POST', {});
      void queryClient.invalidateQueries({ queryKey: ['repositories'] });
      void queryClient.invalidateQueries({ queryKey: ['releases'] });
      navigate(`/releases/${release.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div className={s.pageHeader}>
        <div>
          <span className={s.kicker}>THE RELEASE WORKSPACE</span>
          <h1>
            A little clarity.
            <br className={s.mobileBreak} /> A better release.
          </h1>
          <p>Your commits are the starting point. Make the rest your own.</p>
        </div>
        <button
          className={s.primary}
          onClick={() => (repos.data?.length ? setCreate(true) : setSearch({ add: 'repository' }))}
        >
          <Plus size={17} />
          New release
        </button>
      </div>
      <ErrorNotice error={repos.error || releases.error || error} />
      <section className={s.stats} aria-label="Workspace statistics">
        <div>
          <span className={s.statIcon}>
            <GitBranch size={20} />
          </span>
          <div>
            <span>CONNECTED REPOSITORIES</span>
            <strong>{repos.data?.length ?? 0}</strong>
          </div>
          <span className={s.statCaption}>A home for every project</span>
        </div>
        <div>
          <span className={s.statIcon}>
            <FileText size={20} />
          </span>
          <div>
            <span>RELEASES IN PROGRESS</span>
            <strong>{drafts.length}</strong>
          </div>
          <span className={s.statCaption}>Good things taking shape</span>
        </div>
        <div>
          <span className={s.statIcon}>
            <Ship size={20} />
          </span>
          <div>
            <span>RELEASES SHIPPED</span>
            <strong>{finalized.length}</strong>
          </div>
          <span className={s.statCaption}>The work, out in the world</span>
        </div>
      </section>
      {session.workspace?.kind === 'demo' && (
        <section className={s.sampleBanner}>
          <div className={s.sampleIllustration}>
            <GitBranch size={27} />
            <span>
              <Check size={12} />
            </span>
          </div>
          <div>
            <span className={s.smallLabel}>A TWO-MINUTE TEST DRIVE</span>
            <h2>Edit a note. Sync again. Watch it stay.</h2>
            <p>Try a labeled, recorded scenario to see what makes this workspace different.</p>
          </div>
          <button className={s.bannerButton} disabled={pending} onClick={() => void scenario()}>
            {pending ? 'Setting the scene…' : 'Try the sync demo'}
            <ArrowRight size={16} />
          </button>
        </section>
      )}
      <section className={s.section}>
        <div className={s.sectionHeading}>
          <div>
            <h2>
              On your desk<span className={s.count}>{releases.data?.length ?? 0}</span>
            </h2>
            <p>Pick up a draft, or look back at what you shipped.</p>
          </div>
          <div className={s.segmented} aria-label="Filter releases">
            {['all', 'draft', 'finalized'].map((value) => (
              <button
                key={value}
                className={filter === value ? s.segmentActive : ''}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All releases' : value === 'draft' ? 'Drafts' : 'Shipped'}
              </button>
            ))}
          </div>
        </div>
        <ReleaseCards
          releases={releases.data?.filter((r) => filter === 'all' || r.status === filter) ?? []}
          repositories={repos.data ?? []}
        />
      </section>
      <section className={s.section}>
        <div className={s.sectionHeading}>
          <div>
            <h2>Your repositories</h2>
            <p>One persistent workspace for the projects you maintain.</p>
          </div>
          <button className={s.textButton} onClick={() => setSearch({ add: 'repository' })}>
            <Plus size={15} />
            Add repository
          </button>
        </div>
        <div className={s.repositoryGrid}>
          {repos.data?.map((repo) => (
            <Link to={`/repositories/${repo.id}`} key={repo.id} className={s.repositoryCard}>
              <div className={s.repositoryCardIcon}>
                <GitBranch size={20} />
              </div>
              <div>
                <strong>{repo.name}</strong>
                <p>
                  {repo.owner}
                  <span> / </span>
                  {repo.defaultBranch}
                </p>
              </div>
              <ChevronRight size={17} />
            </Link>
          ))}
        </div>
        {!repos.data?.length && (
          <Empty title="Make room for your first release.">
            Connect a public GitHub repository to get started.
          </Empty>
        )}
      </section>
      <div className={s.overviewNote}>
        <span>
          <Check size={15} />
          Your edits survive every sync.
        </span>
        <span>
          <Check size={15} />
          Nothing is published to GitHub.
        </span>
        <span>
          <Check size={15} />A checklist for the last little things.
        </span>
      </div>
      {search.get('add') === 'repository' && <AddRepository onClose={() => setSearch({})} />}{' '}
      {create && <CreateRelease repositories={repos.data ?? []} onClose={() => setCreate(false)} />}
    </>
  );
}
export function ReleaseCards({
  releases,
  repositories,
}: {
  releases: Release[];
  repositories: Repository[];
}) {
  if (!releases.length)
    return (
      <Empty title="A fresh page, ready for your next release.">
        Create a draft from two GitHub references. Your release notes start there.
      </Empty>
    );
  return (
    <div className={s.releaseGrid}>
      {releases.map((release) => {
        const repo = repositories.find((r) => r.id === release.repositoryId);
        return (
          <Link
            to={`/releases/${release.id}`}
            key={release.id}
            className={s.releaseCard}
            data-testid="release-card"
          >
            <div className={s.cardTop}>
              <span className={release.status === 'draft' ? s.draftBadge : s.shippedBadge}>
                <span />
                {release.status === 'draft' ? 'Draft' : 'Shipped'}
              </span>
              <ArrowUpRight size={18} />
            </div>
            <h3>{release.title}</h3>
            <p className={s.cardRepo}>
              <GitBranch size={13} />
              {repo?.name ?? 'Repository'}
              {release.source === 'sample' && <FlaskConical size={13} />}
            </p>
            <div className={s.range}>
              <code title={release.baseRef}>
                {release.baseRef.length > 16 ? release.baseRef.slice(0, 7) : release.baseRef}
              </code>
              <ArrowRight size={12} />
              <code>
                {release.headRef.length > 20 ? release.headRef.slice(0, 7) : release.headRef}
              </code>
            </div>
            <div className={s.cardBottom}>
              <span>
                <FileText size={14} />
                {release.includedCount} {release.includedCount === 1 ? 'entry' : 'entries'}
              </span>
              <span>{relativeDate(release.lastSyncedAt ?? release.createdAt)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
export function RepositoryPage() {
  const { id } = useParams();
  const [create, setCreate] = useState(false);
  const [template, setTemplate] = useState(false);
  const repo = useQuery({
    queryKey: ['repository', id],
    queryFn: () => api<Repository>(`/repositories/${id}`),
  });
  const releases = useQuery({
    queryKey: ['releases', id],
    queryFn: () => api<Release[]>(`/repositories/${id}/releases`),
  });
  if (repo.isPending || releases.isPending) return <Loading />;
  if (!repo.data) return <ErrorNotice error={repo.error} />;
  return (
    <>
      <Link to="/" className={s.breadcrumb}>
        Workspace
        <ChevronRight size={13} />
        <span>Repository</span>
      </Link>
      <div className={s.pageHeader}>
        <div>
          <span className={s.kicker}>{repo.data.owner} /</span>
          <h1>{repo.data.name}</h1>
          <p>
            <GitBranch size={15} />
            Default branch: <code>{repo.data.defaultBranch}</code>
            <a href={repo.data.htmlUrl} target="_blank" rel="noreferrer" className={s.inlineLink}>
              View on GitHub
              <ArrowUpRight size={13} />
            </a>
          </p>
        </div>
        <button className={s.primary} onClick={() => setCreate(true)}>
          <Plus size={17} />
          New release
        </button>
      </div>
      <ErrorNotice error={releases.error} />
      <div className={s.repoSettings}>
        <div>
          <Settings2 size={18} />
          <span>
            <strong>Release-readiness template</strong>
            <small>{repo.data.checklistTemplate.length} checks copied into every new draft</small>
          </span>
        </div>
        <button className={s.secondary} onClick={() => setTemplate(true)}>
          Edit template
        </button>
      </div>
      <section className={s.section}>
        <div className={s.sectionHeading}>
          <div>
            <h2>Release history</h2>
            <p>Drafts in progress and the releases you’ve put into the world.</p>
          </div>
        </div>
        <ReleaseCards releases={releases.data ?? []} repositories={[repo.data]} />
      </section>
      {create && <CreateRelease repositories={[repo.data]} onClose={() => setCreate(false)} />}{' '}
      {template && <TemplateEditor repository={repo.data} onClose={() => setTemplate(false)} />}
    </>
  );
}
function AddRepository({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Modal title="Connect a repository" onClose={onClose}>
      <p className={s.muted}>
        Bring a public GitHub project to your desk. ReleaseDesk only reads repository data.
      </p>
      <ErrorNotice error={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(undefined);
          try {
            const repo = await api<Repository>('/repositories', 'POST', { owner, name });
            await queryClient.invalidateQueries({ queryKey: ['repositories'] });
            onClose();
            navigate(`/repositories/${repo.id}`);
          } catch (e) {
            setError(e);
          } finally {
            setPending(false);
          }
        }}
      >
        <div className={s.twoFields}>
          <label>
            Owner
            <input
              placeholder="sdolle1775"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              pattern="[A-Za-z0-9-]+"
              required
              maxLength={39}
            />
          </label>
          <label>
            Repository
            <input
              placeholder="marvel-lcg"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={s.primary} disabled={pending}>
            {pending ? 'Connecting…' : 'Connect repository'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CreateRelease({
  repositories,
  onClose,
}: {
  repositories: Repository[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [base, setBase] = useState('');
  const repo = repositories.find((r) => r.id === repositoryId)!;
  const [head, setHead] = useState(repo?.defaultBranch ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const tags = useInfiniteQuery({
    queryKey: ['tags', repositoryId],
    queryFn: ({ pageParam }) =>
      api<{ tags: { name: string; sha: string }[]; hasMore: boolean }>(
        `/repositories/${repositoryId}/tags?page=${pageParam}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    enabled: !!repositoryId,
  });
  return (
    <Modal title="Start a release draft" onClose={onClose}>
      <p className={s.muted}>
        Choose a starting point and where you’re headed. We’ll bring in the commits between them.
      </p>
      <ErrorNotice error={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(undefined);
          try {
            const release = await api<ReleaseDetail>(
              `/repositories/${repositoryId}/releases`,
              'POST',
              { title, baseRef: base, headRef: head },
            );
            void queryClient.invalidateQueries({ queryKey: ['repositories'] });
            void queryClient.invalidateQueries({ queryKey: ['releases'] });
            onClose();
            navigate(`/releases/${release.id}`);
          } catch (e) {
            setError(e);
          } finally {
            setPending(false);
          }
        }}
      >
        <label>
          Repository
          <select
            aria-label="Repository"
            value={repositoryId}
            onChange={(e) => {
              setRepositoryId(e.target.value);
              setHead(repositories.find((r) => r.id === e.target.value)?.defaultBranch ?? '');
              setBase('');
            }}
          >
            {repositories.map((r) => (
              <option key={r.id} value={r.id}>
                {r.owner}/{r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Release title
          <input
            placeholder="e.g. v1.4.0 — A smoother workspace"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={150}
          />
        </label>
        <div className={s.twoFields}>
          <label>
            Base reference
            <input
              list="github-tags"
              placeholder="Tag, branch, or SHA"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              required
              maxLength={250}
            />
          </label>
          <label>
            Head reference
            <input
              list="github-tags"
              value={head}
              onChange={(e) => setHead(e.target.value)}
              required
              maxLength={250}
            />
          </label>
        </div>
        <datalist id="github-tags">
          {tags.data?.pages
            .flatMap((p) => p.tags)
            .map((t) => (
              <option key={t.name} value={t.name} />
            ))}
          <option value={repo?.defaultBranch} />
        </datalist>
        {tags.hasNextPage && (
          <button
            type="button"
            className={s.textButton}
            onClick={() => void tags.fetchNextPage()}
            disabled={tags.isFetchingNextPage}
          >
            Load more tags
          </button>
        )}
        {tags.error && (
          <p className={s.help}>
            Tag suggestions are unavailable. You can still enter a reference directly.
          </p>
        )}
        <p className={s.help}>
          The base commit stays pinned. Sync follows your selected head reference.
        </p>
        <div className={s.modalActions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            Cancel
          </button>
          <button className={s.primary} type="submit" disabled={pending}>
            {pending ? 'Importing commits…' : 'Create draft'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TemplateEditor({ repository, onClose }: { repository: Repository; onClose: () => void }) {
  const [text, setText] = useState(repository.checklistTemplate.join('\n'));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <Modal title="Your readiness template" onClose={onClose}>
      <p className={s.muted}>
        One check per line. Changes apply to future drafts; existing checklists keep their own copy.
      </p>
      <ErrorNotice error={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            await api(`/repositories/${repository.id}`, 'PATCH', {
              checklistTemplate: text
                .split('\n')
                .map((t) => t.trim())
                .filter(Boolean),
            });
            void queryClient.invalidateQueries({ queryKey: ['repository', repository.id] });
            void queryClient.invalidateQueries({ queryKey: ['repositories'] });
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            setPending(false);
          }
        }}
      >
        <label>
          Checklist items
          <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className={s.modalActions}>
          <button type="button" className={s.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={s.primary} disabled={pending}>
            Save template
          </button>
        </div>
      </form>
    </Modal>
  );
}
