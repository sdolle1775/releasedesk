# ADR 003: Use PostgreSQL-backed cookie sessions

Status: accepted.

ReleaseDesk is a same-origin browser application with one owner account and public demo access. It needs revocable login state and an assigned sandbox, without a separate token distribution system.

Use express-session with PostgreSQL storage. The browser receives a signed session ID cookie; user and workspace IDs remain server-side. Rotate the session and CSRF token at login/reset, destroy it at logout, and check workspace expiry on every request. Use secure, HttpOnly, SameSite cookies in production and require CSRF tokens for mutations. Owner passwords use Argon2id.

The demo account is shared only as a sign-in credential. Each login receives a different workspace assigned in its own server session. Resource authorization uses that assigned workspace, rather than granting access to every workspace owned by the shared demo user.

This adds a small session table and middleware dependency but keeps revocation, expiry, and data isolation easy to test. No JWTs are stored in localStorage.

Next: [Recorded fixtures](004-recorded-fixtures.md).
