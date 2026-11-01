# ADR 001: Identify an entry by release and commit SHA

Status: accepted.

A commit can belong to a patch draft and a later minor-release draft at the same time. Its editorial treatment can differ between those releases. A global unique commit SHA would incorrectly share or overwrite those decisions.

Use a surrogate entry ID for API routes and a database unique constraint on `(release_id, commit_sha)`. Sync conflicts are resolved only within that release. A disappearing commit is retained with `missing=true`; its existing ID and decisions return if it reappears.

This duplicates small amounts of public commit metadata across drafts, in exchange for simple ownership, predictable export, and independent release history. Integration tests create two drafts containing the same SHA and verify that editing one does not affect the other.

Next: [Separate facts and overrides](002-facts-and-overrides.md).
