# Learning checkpoints

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
