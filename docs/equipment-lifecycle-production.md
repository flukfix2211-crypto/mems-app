# Production installation — 22 October 2026

Production project: `pxmhmgdbuhmubviuxcxp`, PostgreSQL 17.6.

The repository owner explicitly approved production installation after PR #106 was merged and GitHub Pages deployed `abff823`.

## Applied schema

Supabase migration history entry: `20261022042652_registry_equipment_lifecycle_with_rls_lock_fix`.

This entry atomically applies both source migrations:

1. `20261022031655_registry_equipment_lifecycle.sql` from PR #106.
2. `20261022042356_registry_lock_rls.sql`, the follow-up registry-lock permission correction.

The combined application used a 5-second lock timeout and a 60-second statement timeout, followed by a PostgREST schema cache reload. Do not apply either source migration again to this production database: the combined migration is already installed. Migration-history version reconciliation is required before any future blind `supabase db push`; review the installed history rather than relying on filenames alone.

Preflight found no registry identity collisions or active preparation collisions. A snapshot of the previous view/function definitions, grants and RLS policies was retained in the execution workspace. The migration adds schema and does not rewrite existing loan/preparation history.

## Permission correction

The preflight check used an existing account with borrowing permission but no asset-edit permission. PostgreSQL applies UPDATE RLS visibility to `SELECT ... FOR SHARE`; the original registry row lock therefore hid rows from this account. This was detected before installing the original migration.

The follow-up removes registry `FOR SHARE` reads from the two invoker guards. Authorized registry UPDATE/DELETE operations acquire the same type-and-number advisory locks as preparation/borrowing operations, including both old and new identities during renumbering. Ordinary borrowing needs only SELECT access to the registry. Existing table grants, RLS policies and audit triggers remain unchanged; no new SECURITY DEFINER helper or extra asset-write permission was added.

## Verification

- Local regression suite: **21 passed**, including borrower-only permissions and a registry repair racing a borrow.
- Chromium regression: mixed selection, preparation/borrowing, partial return, ward reset, cancellation becoming selectable again, single/mixed QR, delivery double submission, statistics/trends/history, CSV/PDF and phone/tablet layouts passed with production-style asset policies.
- Real PostgreSQL 17.6 rollback verification, under an existing authenticated borrower without asset-edit permission: mixed preparation, duplicate preparation rejection, mixed borrowing, idempotent replay, wrong-ward return rejection, partial return, transfer/return, linked delivery counts and Bangkok date/time consistency passed.
- All production verification transactions were rolled back. A subsequent independent query found **0** test borrow records, **0** test preparation records, **0** test request receipts and **0** test audit records.
- Original grants and RLS policies on assets, borrow_records and prepare_records compare exactly equal before/after.
- New request table has RLS enabled, the status view uses security_invoker, and all new indexes are valid.
- Real Supabase REST: status view with borrow_started_at returned HTTP 200; preparation records with borrow_record_id returned HTTP 200. Anonymous RPC invocation was rejected with HTTP 401 / PostgreSQL 42501. Authenticated execution is granted.
- Existing security advisor notices remained unchanged. No unrelated security configuration was altered.

The real browser login session, physical camera and physical barcode scanner were not automated against production; frontend/QR handlers were exercised with the disposable backend. Refresh existing browser tabs before using the new workflow.

## Existing advisor references

These notices predate this installation and are not new deployment failures:

- [audit_log RLS without a public policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [pg_net extension in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)
- [Existing get_equipment_status security-definer function](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Leaked password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
