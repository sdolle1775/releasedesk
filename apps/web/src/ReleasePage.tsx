import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  Code,
  Copy,
  FileText,
  FlaskConical,
  GitCommitHorizontal,
  History,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Ship,
  Trash2,
  X,
} from 'lucide-react';
import { CATEGORY_LABELS, type Entry, type ReleaseDetail } from '@releasedesk/contracts';
import { api, queryClient } from './api';
import { useDirty } from './App';
import { Empty, ErrorNotice, Loading, Modal } from './ui';
import s from './App.module.css';

export function ReleasePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { setDirty } = useDirty();
  const release = useQuery({
    queryKey: ['release', id],
    queryFn: () => api<ReleaseDetail>(`/releases/${id}`),
    refetchInterval: (query) =>
      query.state.data?.syncRuns.some((run) => run.status === 'running') ? 2000 : false,
  });
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState('editor');
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<'finalize' | 'delete' | null>(null);
  const [rename, setRename] = useState(false);
  const [title, setTitle] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [history, setHistory] = useState(false);
  const dirty = editing.size > 0 || rename || !!newCheck.trim();
  useEffect(() => {
    setDirty(dirty);
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      setDirty(false);
      window.removeEventListener('beforeunload', handler);
    };
  }, [dirty, setDirty]);
  const updateEditing = (key: string, active: boolean) =>
    setEditing((current) => {
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  const update = async (path: string, method = 'POST', body: unknown = {}) => {
    setBusy(true);
    setError(undefined);
    setNotice('');
    try {
      const result = await api<ReleaseDetail>(`/releases/${id}${path}`, method, body);
      if (result) queryClient.setQueryData(['release', id], result);
      void queryClient.invalidateQueries({ queryKey: ['repositories'] });
      void queryClient.invalidateQueries({ queryKey: ['releases'] });
      return result;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  if (release.isPending) return <Loading />;
  if (!release.data) return <ErrorNotice error={release.error} />;
  const data = release.data;
  const finalized = data.status === 'finalized';
  const completed = data.checklist.filter((c) => c.completed).length;
  const missing = data.entries.filter((e) => e.missing && !e.excluded).length;
  const activeSync = data.syncRuns.some(
    (r) =>
      r.status === 'running' && release.dataUpdatedAt - new Date(r.startedAt).getTime() < 120000,
  );
  const entries = data.entries.filter(
    (e) =>
      filter === 'all' ||
      (filter === 'included' && !e.excluded && !e.missing) ||
      (filter === 'excluded' && e.excluded) ||
      (filter === 'missing' && e.missing),
  );
  const finalizeReady =
    completed === data.checklist.length && !missing && !!data.lastSyncedAt && !activeSync && !dirty;
  return (
    <>
      <Link to={`/repositories/${data.repositoryId}`} className={s.breadcrumb}>
        {data.repository.name}
        <ChevronRight size={13} />
        <span>{finalized ? 'Finalized release' : 'Release draft'}</span>
      </Link>
      <div className={`${s.pageHeader} ${s.releaseHeader}`}>
        <div>
          <div className={s.releaseEyebrow}>
            <span className={finalized ? s.shippedBadge : s.draftBadge}>
              <span />
              {finalized ? 'Shipped' : 'Draft'}
            </span>
            <span className={s.kicker}>RELEASE PREPARATION</span>
          </div>
          {rename ? (
            <form
              className={s.renameForm}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await update('', 'PATCH', { title });
                  setRename(false);
                } catch {
                  /* shown above */
                }
              }}
            >
              <label className={s.srOnly} htmlFor="release-title">
                Release title
              </label>
              <input
                id="release-title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={150}
              />
              <button className={s.primary} disabled={busy}>
                Save
              </button>
              <button
                type="button"
                className={s.iconButton}
                onClick={() => setRename(false)}
                aria-label="Cancel rename"
              >
                <X size={17} />
              </button>
            </form>
          ) : (
            <h1 data-testid="release-title">
              {data.title}
              {!finalized && (
                <button
                  className={s.iconButton}
                  disabled={busy}
                  aria-label="Rename release"
                  onClick={() => {
                    setTitle(data.title);
                    setRename(true);
                  }}
                >
                  <Pencil size={16} />
                </button>
              )}
            </h1>
          )}
          <p className={s.releaseMeta}>
            <GitCommitHorizontal size={16} />
            <code title={data.baseSha ?? data.baseRef}>
              {data.baseRef.length > 18 ? data.baseRef.slice(0, 7) : data.baseRef}
            </code>
            <ArrowRight size={13} />
            <code>{data.headRef}</code>
            <span>·</span>
            <span>{data.includedCount} entries included</span>
          </p>
        </div>
        <div className={s.headerActions}>
          {finalized ? (
            <span className={s.finalizedLabel}>
              <LockKeyhole size={16} />
              Finalized {new Date(data.finalizedAt!).toLocaleDateString()}
            </span>
          ) : (
            <>
              <button
                className={s.secondary}
                disabled={busy || dirty || activeSync}
                onClick={async () => {
                  try {
                    const result = await update('/sync');
                    setNotice(
                      `Sync complete. ${result.syncRuns[0]?.added ?? 0} new commits added. Your edits are preserved.`,
                    );
                  } catch {
                    /* displayed */
                  }
                }}
              >
                <RefreshCw size={16} className={busy ? s.spin : ''} />
                {busy ? 'Working…' : 'Sync commits'}
              </button>
              <button
                className={s.primary}
                disabled={busy || !finalizeReady}
                title={
                  !finalizeReady
                    ? 'Save edits, complete the checklist, and resolve missing commits first.'
                    : undefined
                }
                onClick={() => setConfirm('finalize')}
              >
                <Ship size={16} />
                Finalize release
              </button>
            </>
          )}
        </div>
      </div>
      <ErrorNotice error={release.error || error} />
      {notice && (
        <div className={s.success} role="status">
          <CheckCheck size={17} />
          {notice}
        </div>
      )}
      {dirty && (
        <div className={s.unsaved} role="status">
          <Pencil size={14} />
          You have open edits. Save or cancel them before changing filters, syncing, or finalizing.
        </div>
      )}
      {data.source === 'sample' && (
        <div className={s.sampleNotice}>
          <FlaskConical size={17} />
          <div>
            <strong>Recorded sync demonstration</strong>
            <span>
              This sample uses recorded public commits. Rewrite an entry, save it, then sync to add
              two more commits. No live GitHub request is made.
            </span>
          </div>
        </div>
      )}
      {missing > 0 && (
        <div className={s.warning}>
          <AlertTriangle size={17} />
          {missing} {missing === 1 ? 'commit is' : 'commits are'} no longer in this range. Your
          edits are retained. Review and exclude missing entries before finalizing.
        </div>
      )}
      <div className={s.mobileTabs}>
        <button
          className={tab === 'editor' ? s.segmentActive : ''}
          onClick={() => setTab('editor')}
        >
          Entries & checklist
        </button>
        <button
          className={tab === 'preview' ? s.segmentActive : ''}
          onClick={() => setTab('preview')}
        >
          Markdown preview
        </button>
      </div>
      <div className={s.workspaceColumns}>
        <div className={`${s.editorColumn} ${tab !== 'editor' ? s.mobileHidden : ''}`}>
          <section className={s.panel}>
            <div className={s.panelHeader}>
              <div>
                <FileText size={17} />
                <h2>Changelog entries</h2>
                <span className={s.count}>{data.entries.length}</span>
              </div>
              <button
                className={s.iconButton}
                aria-label="View sync history"
                onClick={() => setHistory(true)}
              >
                <History size={17} />
              </button>
            </div>
            <div className={s.entryFilters}>
              {['all', 'included', 'excluded', 'missing'].map((value) => (
                <button
                  key={value}
                  className={filter === value ? s.filterActive : ''}
                  disabled={busy || dirty}
                  onClick={() => setFilter(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
            <div>
              {entries.map((entry) => (
                <EntryEditor
                  key={entry.id}
                  entry={entry}
                  readOnly={finalized}
                  disabled={busy}
                  onEditing={(active) => updateEditing(entry.id, active)}
                  onSave={(input) => update(`/entries/${entry.id}`, 'PATCH', input)}
                />
              ))}
              {!entries.length && (
                <Empty
                  title={
                    data.entries.length ? 'No entries in this view.' : 'No commits in this range.'
                  }
                >
                  {data.entries.length
                    ? 'Choose another filter to see your entries.'
                    : 'This draft is ready for the next sync.'}
                </Empty>
              )}
            </div>
          </section>
          <section className={s.panel}>
            <div className={s.panelHeader}>
              <div>
                <CheckCheck size={18} />
                <h2>Before you ship</h2>
              </div>
              <span className={s.checkCount}>
                {completed} / {data.checklist.length}
              </span>
            </div>
            <div className={s.progressTrack}>
              <span
                style={{
                  width: `${data.checklist.length ? (completed / data.checklist.length) * 100 : 100}%`,
                }}
              />
            </div>
            <div className={s.checklist}>
              {data.checklist.map((item) => (
                <ChecklistRow
                  key={item.id}
                  item={item}
                  readOnly={finalized}
                  disabled={busy}
                  onEditing={(active) => updateEditing(item.id, active)}
                  onSave={(input) => update(`/checklist/${item.id}`, 'PATCH', input)}
                  onRemove={() => update(`/checklist/${item.id}`, 'DELETE')}
                />
              ))}
            </div>
            {!finalized && (
              <form
                className={s.addChecklist}
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await update('/checklist', 'POST', { text: newCheck });
                    setNewCheck('');
                  } catch {
                    /* shown */
                  }
                }}
              >
                <label className={s.srOnly} htmlFor="new-check">
                  New checklist item
                </label>
                <input
                  id="new-check"
                  placeholder="One more thing before release…"
                  value={newCheck}
                  onChange={(e) => setNewCheck(e.target.value)}
                  maxLength={300}
                  required
                />
                <button
                  className={s.iconButton}
                  disabled={busy || !newCheck.trim()}
                  aria-label="Add checklist item"
                >
                  <Plus size={18} />
                </button>
              </form>
            )}
            <div className={s.panelFootnote}>
              <span className={finalizeReady || finalized ? s.readyDot : s.pendingDot} />
              {finalized
                ? 'A permanent record of what you shipped.'
                : finalizeReady
                  ? 'Everything checked. Ready when you are.'
                  : 'A little care now makes a better release.'}
            </div>
          </section>
          <div className={s.releaseTools}>
            <button className={s.textButton} onClick={() => setHistory(true)}>
              <Clock size={14} />
              Sync history
            </button>
            {!finalized && (
              <button
                className={s.deleteLink}
                disabled={busy || dirty}
                onClick={() => setConfirm('delete')}
              >
                <Trash2 size={14} />
                Delete draft
              </button>
            )}
          </div>
        </div>
        <aside className={`${s.previewColumn} ${tab !== 'preview' ? s.mobileHidden : ''}`}>
          <section className={`${s.panel} ${s.previewPanel}`}>
            <div className={s.panelHeader}>
              <div>
                <span className={s.previewDot} />
                <h2>Release preview</h2>
              </div>
              <button
                className={s.iconButton}
                aria-label={raw ? 'Show rendered preview' : 'Show Markdown source'}
                onClick={() => setRaw(!raw)}
              >
                <Code size={17} />
              </button>
            </div>
            <div className={s.previewSubhead}>
              <span>{raw ? 'THE MARKDOWN, READY TO GO' : 'WHAT YOUR READERS WILL SEE'}</span>
              <span>Markdown</span>
            </div>
            {raw ? (
              <textarea
                className={s.markdownSource}
                readOnly
                aria-label="Exported Markdown"
                value={data.markdown}
              />
            ) : (
              <div className={s.markdown}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
                >
                  {data.markdown}
                </ReactMarkdown>
              </div>
            )}
            <div className={s.copyArea}>
              <button
                className={s.primary}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.markdown);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2200);
                  } catch {
                    setRaw(true);
                    setNotice(
                      'Clipboard unavailable. Select and copy the Markdown source shown in the preview.',
                    );
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                {copied ? 'Copied to clipboard' : 'Copy Markdown'}
              </button>
              <p>Ready for GitHub Releases, or wherever you ship.</p>
            </div>
          </section>
          <div className={s.editorialNote}>
            <span>THE HUMAN PART MATTERS.</span>
            <p>
              GitHub tells you what changed.
              <br />
              You decide what’s worth saying.
            </p>
          </div>
        </aside>
      </div>
      {confirm && (
        <Modal
          title={confirm === 'finalize' ? 'Ready to put a bow on it?' : 'Delete this draft?'}
          onClose={() => setConfirm(null)}
        >
          <p className={s.muted}>
            {confirm === 'finalize'
              ? 'Finalizing saves this exact Markdown and locks the release, entries, and checklist. You can return to it any time in your release history.'
              : 'This removes the draft, its entries, checklist, and sync history. This action cannot be undone.'}
          </p>
          <div className={s.modalActions}>
            <button className={s.secondary} onClick={() => setConfirm(null)}>
              Keep editing
            </button>
            <button
              className={confirm === 'delete' ? s.danger : s.primary}
              disabled={busy}
              onClick={async () => {
                try {
                  if (confirm === 'delete') {
                    await update('', 'DELETE');
                    setConfirm(null);
                    navigate(`/repositories/${data.repositoryId}`);
                  } else {
                    await update('/finalize');
                    setConfirm(null);
                    setNotice('Release finalized. Your notes are preserved in release history.');
                  }
                } catch {
                  setConfirm(null);
                }
              }}
            >
              {confirm === 'delete' ? 'Delete draft' : 'Finalize release'}
            </button>
          </div>
        </Modal>
      )}
      {history && (
        <Modal title="A history of staying in sync" onClose={() => setHistory(false)}>
          <p className={s.muted}>
            Every attempt is recorded. Editorial decisions stay separate from GitHub facts.
          </p>
          <div className={s.syncHistory}>
            {data.syncRuns.map((run) => (
              <div key={run.id}>
                <span className={run.status === 'succeeded' ? s.successIcon : s.failureIcon}>
                  {run.status === 'succeeded' ? <Check size={16} /> : <Clock size={16} />}
                </span>
                <div>
                  <strong>
                    {run.status === 'succeeded'
                      ? `${run.added} added · ${run.total} in range`
                      : run.status === 'failed'
                        ? 'Sync failed'
                        : 'Sync in progress'}
                  </strong>
                  <small>{new Date(run.startedAt).toLocaleString()}</small>
                  {run.errorMessage && <p>{run.errorMessage}</p>}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
function EntryEditor({
  entry,
  readOnly,
  disabled,
  onEditing,
  onSave,
}: {
  entry: Entry;
  readOnly: boolean;
  disabled: boolean;
  onEditing: (active: boolean) => void;
  onSave: (input: unknown) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [excluded, setExcluded] = useState(false);
  const open = () => {
    setTitle(entry.titleOverride ?? entry.message.split('\n')[0]);
    setCategory(entry.categoryOverride ?? '');
    setNotes(entry.notes);
    setExcluded(entry.excluded);
    setEditing(true);
    onEditing(true);
  };
  const close = () => {
    setEditing(false);
    onEditing(false);
  };
  const currentCategory = entry.categoryOverride ?? entry.suggestedCategory;
  return (
    <article
      className={`${s.entry} ${entry.excluded ? s.excludedEntry : ''}`}
      data-testid="changelog-entry"
    >
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await onSave({
                titleOverride: title === entry.message.split('\n')[0] ? null : title,
                categoryOverride: category || null,
                notes,
                excluded,
              });
              close();
            } catch {
              /* parent error */
            }
          }}
        >
          <label>
            Entry title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={500}
            />
          </label>
          <label>
            Category
            <select
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Suggested: {CATEGORY_LABELS[entry.suggestedCategory]}</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add the context a commit message can’t…"
              maxLength={10000}
            />
          </label>
          <label className={s.checkLabel}>
            <input
              type="checkbox"
              checked={excluded}
              onChange={(e) => setExcluded(e.target.checked)}
            />
            Exclude from release notes
          </label>
          <div className={s.entryEditActions}>
            <button
              type="button"
              className={s.textButton}
              onClick={() => {
                setTitle(entry.message.split('\n')[0]);
                setCategory('');
              }}
            >
              Use GitHub title & category
            </button>
            <button type="button" className={s.secondary} onClick={close}>
              Cancel
            </button>
            <button className={s.primary} disabled={disabled} type="submit">
              Save entry
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className={s.entryTop}>
            <span className={`${s.categoryBadge} ${s[`category_${currentCategory}`]}`}>
              {currentCategory === 'breaking'
                ? 'Breaking change'
                : currentCategory === 'feature'
                  ? 'Feature'
                  : currentCategory === 'fix'
                    ? 'Fix'
                    : 'Internal'}
            </span>
            {entry.excluded && <span className={s.excludedBadge}>Excluded</span>}
            {entry.missing && <span className={s.missingBadge}>Missing from range</span>}
            {!readOnly && (
              <button
                className={s.entryEdit}
                disabled={disabled}
                onClick={open}
                aria-label={`Edit entry ${entry.commitSha.slice(0, 7)}`}
              >
                <Pencil size={14} />
                Edit
              </button>
            )}
          </div>
          <h3>{entry.titleOverride ?? entry.message.split('\n')[0]}</h3>
          {entry.notes && <p className={s.entryNotes}>{entry.notes}</p>}
          <div className={s.entryMeta}>
            <a href={entry.htmlUrl} target="_blank" rel="noreferrer">
              <GitCommitHorizontal size={13} />
              {entry.commitSha.slice(0, 7)}
              <ArrowUpRight size={11} />
            </a>
            <span>by {entry.author}</span>
            {(entry.titleOverride || entry.categoryOverride) && (
              <span className={s.editedLabel}>
                <Pencil size={10} />
                Edited by you
              </span>
            )}
          </div>
          {entry.missing && !entry.excluded && !readOnly && (
            <button
              className={s.textButton}
              disabled={disabled}
              onClick={() => void onSave({ excluded: true }).catch(() => {})}
            >
              Exclude missing commit
            </button>
          )}
        </>
      )}
    </article>
  );
}
function ChecklistRow({
  item,
  readOnly,
  disabled,
  onEditing,
  onSave,
  onRemove,
}: {
  item: { id: string; text: string; completed: boolean };
  readOnly: boolean;
  disabled: boolean;
  onEditing: (active: boolean) => void;
  onSave: (input: unknown) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [optimisticCompleted, setOptimisticCompleted] = useState<boolean | null>(null);
  const close = () => {
    setEditing(false);
    onEditing(false);
  };
  return (
    <div className={s.checklistRow}>
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await onSave({ text });
              close();
            } catch {
              /* parent */
            }
          }}
        >
          <input
            aria-label="Checklist item text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            maxLength={300}
          />
          <button className={s.iconButton} disabled={disabled} aria-label="Save checklist item">
            <Check size={16} />
          </button>
          <button
            type="button"
            className={s.iconButton}
            onClick={close}
            aria-label="Cancel checklist edit"
          >
            <X size={16} />
          </button>
        </form>
      ) : (
        <>
          <label className={item.completed ? s.completedCheck : ''}>
            <input
              type="checkbox"
              checked={optimisticCompleted ?? item.completed}
              disabled={readOnly || disabled}
              onChange={async (e) => {
                setOptimisticCompleted(e.target.checked);
                try {
                  await onSave({ completed: e.target.checked });
                } catch {
                  /* Parent shows the failure; revert to the persisted value. */
                } finally {
                  setOptimisticCompleted(null);
                }
              }}
            />
            <span>{item.text}</span>
          </label>
          {!readOnly && (
            <div>
              <button
                className={s.iconButton}
                disabled={disabled}
                aria-label={`Edit check: ${item.text}`}
                onClick={() => {
                  setText(item.text);
                  setEditing(true);
                  onEditing(true);
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                className={s.iconButton}
                disabled={disabled}
                aria-label={`Remove check: ${item.text}`}
                onClick={() => void onRemove().catch(() => {})}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
