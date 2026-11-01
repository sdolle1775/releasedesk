# ADR 004: Test against recorded GitHub responses

Status: accepted.

Live repositories change, API tokens expire, and upstream rate limits make tests unpredictable. A release workspace also needs unusual cases such as a missing commit or a failed final pagination page, which are difficult to reproduce safely against a real project.

Inject the GitHub source into the service/application. Adapter tests exercise HTTP response bodies, headers, ETags, pagination links, and error statuses through a mock fetch transport. API tests use the source interface with real PostgreSQL. Playwright serves the built frontend against a fixture-backed API and an isolated database. Tests block unexpected network calls.

Demo seeds come from complete recorded public comparisons, refreshed only by an explicit script. A separately labeled sample scenario exposes two snapshots so visitors can reliably see an edit survive a sync. Normal public imports still use live GitHub.

Fixtures cannot prove the current live API contract forever. A manual live-import smoke check remains part of deployment and monthly maintenance; deterministic tests remain independent of that check.
