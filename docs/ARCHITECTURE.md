# How a paycheck is calculated

`calculatePay(input, db)` in `packages/engine/src/calculate.ts` is a pure function: the same input and tax database always give the same result, and every step is written to `result.audit` and to each tax line's `explanation`.

1. **Conventions.** Start from IRS by-the-book conventions, overlay the selected vendor profile (rounding, supplemental method, FICA true-up, percent-deduction base, extra-withholding timing).
2. **Earnings.** Each earning code has taxability per wage basis (`FIT, FICA, MEDICARE, FUTA, SIT, SUI, SDI, LOCAL`), a supplemental flag and a cash flag (imputed income is taxable but not paid).
3. **Deductions.** Pre-tax amounts are computed (flat, percent, or retirement-system rate) and capped by IRS limits with age 50+ and 60-63 catch-ups. Each deduction reduces specific wage bases, with state overrides (PA taxes deferrals, NJ taxes 403(b)/457/414(h), CA/NJ tax HSA, NY adds back 414(h)).
4. **Taxable wages** are computed per basis, and per state for state/local bases.
5. **Federal.** FIT via Pub 15-T Worksheet 1A (tables derived from the year's brackets and standard deduction unless published tables are loaded), supplemental flat 22% / 37% over $1M; SS (wage base), Medicare, Additional Medicare over $200k; FUTA with credit reduction. Territory residents working in a territory skip FIT and get territory income tax.
6. **States.** Work-state tax for each nonresident work state unless reciprocity applies; resident-state tax with credit for work-state tax. Allocations use the proportional method. Convenience-of-employer moves remote-for-convenience work to the employer's state. State programs (SUI, SDI, PFML...) apply to the unemployment (localized) state.
7. **Locals.** PA Act 32 (higher of resident and work nonresident EIT), LST with low-income exemption, Indiana residence-county rule, resident-only taxes (NYC, Yonkers surcharge, MD counties, OH school districts), nonresident-only taxes, Ohio resident credit for work-city tax, employer-paid local taxes.
8. **Garnishments** use disposable earnings (gross less employee taxes and mandatory retirement) and CCPA / AWG / levy limits, in priority order.
9. **Net pay and employer cost**, YTD after the check (feed into the next one), warnings (including every line that used unverified/projected data).

## Data flow

`packages/tax-data` (typed, cited source data) → `npm run db:seed` → Postgres (`tax_rule`, `jurisdiction`, ...). The API loads the TaxDatabase **from Postgres**, so rule edits made in the database (with `tax_rule_history`) and agency-file imports take effect without code changes.

## Sign-in and permissions

`apps/api/src/auth.ts` holds all of it. One `onRequest` hook resolves the session cookie to two users, `req.actor` (who is really signed in) and `req.user` (the same person, or the one they are viewing as), then asks `requiredPermission(method, route)` what the route needs.

- The check uses the **matched route pattern** (`/api/proposals/:id`), never the raw URL. The router decodes percent-escapes before matching, so `/%61pi/admin/users` reaches the admin handler; a prefix test on the raw text would wave it through.
- Rules fail closed: a route that changes data and has no rule returns 403 for everyone. Reads of reference data and the two calculate-only routes are open to any signed-in user.
- Proposals add an ownership check inside the route (`load`): people see their own, or everyone's with `proposals.view_all`.
- While viewing as someone, `req.user` carries that person's permissions limited to the ones the actor also holds.
- An `onResponse` hook writes one `audit_log` row per successful change (`actor_id`, `as_user_id`, action, target). Routes that log a named event (sign-in, status change, publish) are not logged twice.

## Proposals: queue, versions, client pages

A saved `proposal` keeps the uploaded rows, the column mapping, the settings (including per-row reviewer overrides and the participation rate) and the results. Every save or recalculation adds a `proposal_revision` with the settings and headline numbers.

Publishing writes a `proposal_report` row: a slug (`<company>-<16 hex>`) and a **snapshot** built by `buildSnapshot` in `apps/api/src/proposals/report.ts` from the saved numbers and the proposal's page settings. `GET /api/public/reports/:slug` returns only that snapshot, so later edits never change a link that was sent, and nothing but what the page shows leaves the app. Revoking sets `revoked_at`; the link then answers 404.

## Vendor learning

`learnVendorProfile(vendor, samples)` runs each sample paycheck through every combination of conventions in `CONVENTION_SEARCH_SPACE` and keeps the combination with the smallest total difference from the provider's actual tax amounts. It reports per-dimension evidence and the residual lines no convention explains, which point to setup differences (wrong SUI rate, missing local, W-4 data).
