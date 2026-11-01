# ADR 002: Store GitHub facts separately from editorial overrides

Status: accepted.

GitHub facts are refreshable inputs. A rewritten title, category, note, or exclusion is user-owned work. Treating both as a single generated entry makes sync a destructive replacement operation.

Store nullable title/category overrides beside source fields, plus separate notes and exclusion columns. Resolve the effective title/category at render time. Null clears an override. The SQL upsert enumerates only source columns in its conflict update; the entry-edit API enumerates only editorial columns.

Fetch and validate a complete immutable comparison before applying any content writes. Apply all facts, missing flags, release SHAs, and successful-run status in one transaction. Keep failure auditing outside that transaction. Finalization stores the exact Markdown snapshot and prevents further mutations.

Tests cover a later-page failure and an actual database error after an earlier upsert, proving that content remains unchanged.

Next: [PostgreSQL-backed sessions](003-session-authentication.md).
