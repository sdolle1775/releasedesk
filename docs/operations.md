# ReleaseDesk operations

## Render and Neon deployment

Sam will activate hosting after the application handoff. No Render or Neon resources were created during implementation.

1. Create a Neon project using PostgreSQL 17. Select a region near the Render service.
2. Save the pooled PostgreSQL URL as `DATABASE_URL` and the direct, non-pooler URL as `DATABASE_DIRECT_URL`. Preserve the provider's TLS parameters. Keep these in Render environment variables, never in Git.
3. In Render, create a Blueprint from `sdolle1775/releasedesk` and the committed `render.yaml`. It creates one free Docker web service. No Render database is needed.
4. Set `APP_ORIGIN` to the exact public HTTPS origin without a trailing slash. Set `OWNER_USERNAME` and a private `OWNER_PASSWORD` of at least 12 characters. The Blueprint generates `SESSION_SECRET`.
5. Set `GITHUB_TOKEN` to a server-only fine-grained GitHub token with the minimum read access needed for public repository contents. The API rejects private repositories even if the credential could read them.
6. Keep `DEMO_ENABLED=true`, `DEMO_USERNAME=demo`, and `DEMO_PASSWORD=releasedesk` to enable the public sandbox. These are intentionally public and confer no owner access.
7. Deploy after CI checks pass. Startup applies pending SQL migrations under node-pg-migrate's database advisory lock, bootstraps missing login users, then listens on Render's injected `PORT`.
8. Check `/api/health`, log in as owner, create a draft, then verify the public demo in an independent browser session. Check secure cookies, logout, clipboard export, and a direct reload of a release URL.
9. Set the repository About URL to the verified HTTPS URL and replace the deployment-pending line in the README with that link.

Render free services sleep when idle. Their filesystem is ephemeral; ReleaseDesk stores durable records and sessions in PostgreSQL. A cold start can take time. Do not add a periodic keep-alive monitor to defeat the free service's sleep behavior. Confirm current provider limits before activation.

## Environment variables

| Variable                           | Purpose                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | `production` on Render; `development` locally                                          |
| `PORT`                             | Injected by Render, defaults to 3000                                                   |
| `HOST`                             | Optional bind override; Compose sets `0.0.0.0`; local development defaults to loopback |
| `APP_ORIGIN`                       | Exact browser origin used for CSRF Origin validation                                   |
| `DATABASE_URL`                     | PostgreSQL application/session connection                                              |
| `DATABASE_DIRECT_URL`              | Direct PostgreSQL migration connection; falls back to `DATABASE_URL` locally           |
| `SESSION_SECRET`                   | At least 32 random characters; rotating it invalidates sessions                        |
| `GITHUB_TOKEN`                     | Optional but recommended for live GitHub imports; never shipped to the browser         |
| `OWNER_USERNAME`, `OWNER_PASSWORD` | Bootstrap the persistent owner login if it does not exist                              |
| `DEMO_ENABLED`                     | `true` or `false`                                                                      |
| `DEMO_USERNAME`, `DEMO_PASSWORD`   | Published demo login credentials                                                       |

Use separate development, test, and production databases. Only the local Compose setup contains default database/session values; do not reuse them on an internet-facing deployment.

## Owner passwords

Bootstrap never overwrites an existing password on restart. The owner workspace survives all demo resets.

To set or rotate the owner password, set the desired `OWNER_USERNAME` and `OWNER_PASSWORD` securely in the execution environment and run:

```sh
npm run owner:password
```

The command hashes with Argon2id and invalidates the owner's existing sessions. Run it from a trusted local checkout pointed at the intended database. It never prints the password or connection string. Do not place a password in a shell command argument. Render's free plan has no interactive shell, so this administrative command can run locally with the Neon connection in an ignored `.env`.

## Migrations and rollback

Migrations live in `apps/api/migrations`. Test new migrations on a disposable database and take a backup before production changes. Production startup runs them through the direct connection under an advisory lock. Application transactions use a single checked-out `pg` client throughout.

Prefer additive migrations compatible with the previous application version. On a failed application deployment, redeploy the previous known-good commit. Do not automatically run destructive down migrations against personal data. If a schema change is incompatible, restore into a separate database, verify it, then switch connection variables deliberately.

## Back up and restore

Use PostgreSQL 17 client tools. Run these from a trusted shell with connection URLs supplied in environment variables, not copied into shared logs. The example commands use a POSIX shell; in PowerShell, pass `$env:DATABASE_DIRECT_URL` instead.

```sh
pg_dump --dbname="$DATABASE_DIRECT_URL" --format=custom --no-owner --file=releasedesk-backup.dump
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl releasedesk-backup.dump
```

Store backup files outside the Git repository in encrypted storage. Restore into a new empty database, apply any pending migrations, then verify an owner's draft, final Markdown snapshot, checklist, and login. Provider snapshots are useful but do not replace a tested restore procedure.

## Health, logs, and maintenance

- `/api/health` returns `200 {status:"ok"}` after a database query, or `503` if PostgreSQL is unavailable.
- Structured request logs include request ID, method, path, response status, and duration. Passwords, cookies, GitHub tokens, and request bodies are not logged.
- Failed API responses include a request ID header. Inspect the corresponding application logs and `sync_runs` record.
- GitHub primary/secondary rate limits return an actionable message and retry time when available. Retry manually after that time; do not repeatedly hammer the API.
- A sync interrupted by a process restart is reclaimable after two minutes. A retry imports a complete fresh snapshot and cannot partially overwrite prior content.
- Startup and demo creation prune expired sandboxes, old quota events, and old cached data. Session middleware periodically prunes expired sessions. Demo quota evidence is retained for at most the cleanup window and contains HMACs rather than raw IP addresses.
- The deployment is intentionally one service instance. PostgreSQL constraints/locks protect sync and quota operations; the broad request/login throttles use process memory and would need a shared limiter before scaling to multiple instances.

## Monthly manual demo check

No recurring automation is created by this project. Once a month, manually:

1. Visit the public URL after an idle period and confirm it wakes and passes health checks.
2. Log into the demo, create the recorded sync scenario, rewrite an entry, save, and sync. Confirm the rewrite remains and two commits arrive.
3. Check Markdown export, complete the checklist, finalize, and reload the result.
4. In another private session, confirm the first sandbox is inaccessible; reset one and confirm the other is unaffected.
5. Check one live public import, GitHub token expiration, database/storage quotas, provider billing settings, and the CI badge.
6. Verify the README and About URL still point to the working deployment, and periodically test a backup restore.
