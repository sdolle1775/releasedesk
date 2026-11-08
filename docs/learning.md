# Learning checkpoints

## Checkpoint 1 — verified local MVP

Reviewed November 8, 2026, starting from merged commit `6534c86`.

The first checkpoint covers a complete local release preparation workflow. Public repository imports, persistent drafts, editorial changes, edit-preserving sync, Markdown export, readiness checks, and immutable finalized history are implemented. Demo sessions have isolated, expiring workspaces. Setup instructions, architecture decisions, Docker packaging, CI, and the hosting runbook are committed.

The checkpoint review found that switching entry filters could unmount an open editor, lose its unsaved text, and leave sync and finalization blocked. Filters now require edits to be saved or canceled and wait for pending writes. A desktop/mobile regression covers saving an exclusion from the Included view, finding the saved edit in Excluded, canceling a subsequent edit, and returning to an enabled sync action.

| Verification | Result |
| --- | --- |
| ESLint and TypeScript | Passed |
| Unit, GitHub adapter, migration, and API tests | 36 passed against real PostgreSQL 17 |
| Production build | Passed |
| Desktop/mobile browser workflows | 7 passed, with the duplicate mobile isolation case intentionally skipped |
| Production dependency audit | `npm audit --omit=dev` reported zero vulnerabilities |
| Docker image and Compose health check | Passed in the merged PR's [CI run](https://github.com/sdolle1775/releasedesk/actions/runs/41347050928). Docker was unavailable locally during this review |

Automated browser checks use recorded comparisons. The merged PR records an earlier live GitHub import check. This review did not repeat that live check. Playwright's required Chromium version was installed locally before running the browser suite.

The next checkpoint is a verified hosted demo. Activate Render and Neon, configure the owner login and server-side GitHub credential, then verify a live import, secure login, export, finalization, and independent demo sessions at the public URL. Record that URL in the README after verification. Follow the [operations runbook](operations.md).

## Study and explain the implementation

Use these checkpoints to study and explain the implementation. Each has a runnable verification and a question worth answering in your own words.

| Checkpoint              | Read and run                                           | Explain                                                                                                          |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Relational foundation   | SQL migrations; `npm run db:migrate`                   | Why do workspace/release foreign keys and a compound unique key belong in the database?                          |
| Write API               | Routes, Zod contracts, service transactions; API tests | Where are validation, authorization, and state transitions enforced?                                             |
| First full-stack flow   | `npm run dev:local`; create/edit/export/finalize       | What happens from a Save click through SQL and back into the query cache?                                        |
| Edit-preserving sync    | Sync SQL and regression tests                          | Which columns may GitHub update, and what happens when a later page or database write fails?                     |
| Authentication and demo | Session middleware and sandbox tests                   | Why is a shared demo credential safe only when each session receives an isolated workspace?                      |
| Testing and CI          | `npm run test:all`; Actions workflow                   | What do unit, adapter, integration, browser, and container tests each prove?                                     |
| Delivery                | Dockerfile, Render Blueprint, operations runbook       | Why do migrations use a direct connection, and why must all durable state live outside the container filesystem? |

The implementation history begins with a database/API foundation, then adds the complete responsive workspace and deployment packaging. Pull-request descriptions record the checks and self-review. Hosting activation is a separate owner-operated step.

For a two-minute demonstration: log into the demo, create the recorded scenario, rewrite an entry and add context, save, sync, and show the unchanged editorial text alongside two new commits. Then complete the checklist, finalize, and reload the immutable release. Explain that GitHub already generates notes; ReleaseDesk preserves the release preparation workflow around them.
