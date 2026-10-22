# Unify registry equipment preparation, borrowing, returns and usage statistics

Equipment outside C2/High Flow previously used manual number entry and per-item writes, allowing incomplete batches and inconsistent current status. Use the asset registry for every type, present only preparations/open loans belonging to the selected ward, and commit each selection atomically with database locking and idempotent request receipts.

The migration retains existing account RLS, audit and backdate guards, links preparation to borrowing, keeps transfers within the same loan and prevents Round/Circuit from releasing equipment. Delivery records one preparation and one borrowing transaction. Reports retain the existing statistics URL, theme and PDF/CSV flows while adding all registry types, period-end outstanding loans, ward transfer segments, clipped usage hours and explicit incomplete legacy data.

## Validation

- 19 regression tests passed against disposable native PostgreSQL, including two authenticated concurrent sessions.
- Default PostgreSQL WASM run: 18 passed; the native two-connection test is explicitly skipped.
- Chromium with a local API adapter and disposable database: mixed-type preparation/borrowing, partial returns, ward changes, repair filtering, single/mixed QR, delivery with repeated submission, daily/fiscal trends, machine history and CSV/PDF preview.
- Phone/tablet widths: 390 and 768 pixels; no page overflow or uncaught browser errors.
- Production access was read-only for catalog/preflight inspection; no production migration or test transaction was performed.

## Deployment

Apply `20261022031655_registry_equipment_lifecycle.sql` to a staging clone first, then deploy the frontend and migration in a short maintenance window. Keep existing RLS/audit policies. Review legacy anomalies instead of backfilling guessed sessions or preparations. See `docs/equipment-lifecycle-delivery.md` for the file list, calculation definitions, limitations and rollout/rollback procedure.

## Scope

Based on main `2ef8998`; excludes the separate unfinished admin time correction. Native database tests used PostgreSQL 18; staging should match production 17.6. Browser authentication and API transport are test doubles; physical camera/scanner and live Supabase Auth need staging smoke tests.
