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
- An `onResponse` hook writes one `audit_log` row per successful change (`actor_id`, `as_user_id`, action, target). Routes that log a named event (sign-in, user changes, every proposal and client-link action) are not logged twice. Named events store the name of the thing they changed, so the log still reads in plain words after that thing is deleted; for catch-all rows the audit list looks up the client, employee or proposal name from the request path.
- A tax rule's history records the signed-in person who changed it, not a name sent by the browser.

## Proposals: queue, versions, client pages

A saved `proposal` keeps the uploaded rows, the column mapping, the settings (including per-row reviewer overrides and the participation rate) and the results. Every save or recalculation adds a `proposal_revision` with the settings and headline numbers.

Each employee result carries a `cause` (the first rule that failed, in the order the rules run) and an `explanation`: the client wording for it, built by `explainEmployee` in `packages/engine/src/proposal.ts`. The explanation has a status (Eligible, Eligible (part-time plan), Under review, Not eligible), a headline, a reason and suggestions.

- "Savings too low" says how many cents of tax each dollar set aside saves against what the plan needs, then names what keeps the federal income tax low. It finds that by re-running the same check with one thing changed: no W-4 credits or allowances, the Single rate, no other pre-tax deductions.
- Suggestions come from a search for the smallest pay per check at which the pay and savings rules pass, turned into hours at the current hourly rate when that is realistic. They only ever name pay, hours or missing data. **A W-4 is given as a reason, never as something to change**: changing it moves withholding, not the tax owed, and it is the employee's own choice.
- What-ifs use the first check of the year (`approxAllotment`), which matches the full-year figure below the wage bases. If one cannot be calculated, the reason is kept without a suggestion and the row is flagged.
- Reviewer notes and internal flags never go into an explanation. Results saved before explanations existed fall back to the status and the rule's own sentence (`explanationOf` in `apps/api/src/proposals/report.ts`) until the proposal is recalculated.

Publishing writes a `proposal_report` row: a slug (`<company>-<16 hex>`) and a **snapshot** built by `buildSnapshot` in `apps/api/src/proposals/report.ts` from the saved numbers and the proposal's page settings. `GET /api/public/reports/:slug` returns only that snapshot, so later edits never change a link that was sent, and nothing but what the page shows leaves the app. Revoking sets `revoked_at`; the link then answers 404. Links do not expire on their own. The snapshot lists every employee except rows the reviewer left out, which are also taken out of its headcount; amounts are included only for people on a plan.

## Valuation multiples

The valuation increase on a proposal is employer savings times an EBITDA multiple. The multiple comes from the `valuation_multiple` table (migration 005), seeded at start from `apps/api/src/proposals/multiples-data.ts`.

- **Private companies:** GF Data (ACG) averages of enterprise value to adjusted EBITDA on private-equity deals. The industry average ("any size") is the published figure for the closest of GF Data's eight groups. GF Data does not publish industry by size, so each size cell is calculated: the all-industry average for that size, times the industry group average, divided by the all-deal average. Those cells have basis `derived` and keep the sum in `method`. The two bands under $10M use first half 2025 figures reported second hand.
- **Public companies:** NYU Stern (Damodaran) EV/EBITDA by US industry, firms with positive EBITDA, January 2026. Not split by size.
- **Company size** is enterprise value, because that is how the deal data is grouped.
- Every row keeps its source, date and basis (`published`, `derived`, `custom`). Nothing is invented. An edit (`PUT /api/multiples/:id`, permission `rules.edit`) marks the cell `custom` and keeps the sourced figure so it can be reset. Re-seeding never overwrites an edited cell.
- At calculation the server fills the multiple in from the proposal's industry, ownership and size (`withTableMultiple`) and records where it came from in `settings.multipleInfo`. A multiple the reviewer typed (`multipleAuto: false`) or an industry that is not in the table (older proposals) is left alone. The client page and the export show one line on the source.

## Public employers: the Texas TRS payroll model

A proposal (and a client) can use a public retirement system as its payroll model: `settings.retirementSystem = 'TX_TRS'` with `settings.publicEmployer`. Only systems whose rates were read from the agency (status `published`) are offered in the app; the others in `RETIREMENT_SYSTEMS` are still unverified.

What the TRS model changes, and why (sources are on the `TX_TRS` row in `packages/tax-data/src/benefits.ts`):

- **Member contribution 8.25%** is added to every row as a `401A_PICKUP` deduction (414(h)(2) pick-up: out of federal income tax wages, still in Medicare and Social Security wages). It is taken on pay before any Section 125 deduction, entered as an amount so a vendor's percent base cannot net out Section 125. A mapped TRS column (`retirementSystemContribution`, per check) is used when it has an amount.
- **Social Security**: off unless the district has a Section 218 agreement (`publicEmployer.socialSecurityCovered`, stored per client as `client.social_security_covered`). A row whose file shows Social Security withheld (`socialSecurityPaid`) is treated as covered when `detectSocialSecurity` is on. Medicare is always on (mandatory for hires after March 31, 1986). So for most districts employer savings are 1.45% Medicare on each dollar deducted, and employee savings are income tax plus 1.45%.
- **TRS stays whole**: TRS counts qualifying Section 125 salary reductions as compensation (34 TAC 25.21(c)(5), 25.22), so the First Gen deduction does not lower member or employer TRS contributions or the pension. `cafeteriaReductionsCovered: false` models a plan TRS would not count (contributions fall with the deduction); each result then shows the lower TRS amounts.
- **FUTA**: governments are exempt, so switching to the model turns FUTA off.
- **Valuation**: a public employer has no EBITDA, so results, the printable summary and the client page leave the valuation out.

Rates are FY2027 (Sept 1, 2026 to Aug 31, 2027): member 8.25%, state 8.25%, public education employer 2%, employer TRS-Care 0.75%, member TRS-Care 0.65%. The return-to-work surcharges (16.5% pension, $535 TRS-Care) are employer costs for rehired retirees and are not modeled.

## Vendor learning

`learnVendorProfile(vendor, samples)` runs each sample paycheck through every combination of conventions in `CONVENTION_SEARCH_SPACE` and keeps the combination with the smallest total difference from the provider's actual tax amounts. It reports per-dimension evidence and the residual lines no convention explains, which point to setup differences (wrong SUI rate, missing local, W-4 data).

## Verification status and the seed

Every rule carries one of six statuses:

- `published`: matches a final agency document that was read directly (IRS, EDD, Colorado DR 1098, NY DFS).
- `confirmed`: matches a recognized compilation that cites the agency, but the agency document itself was not read. The compilations used so far are the USDA National Finance Center state and local tax bulletins, EY's unemployment wage base tables, and the Mercer and Symetra paid leave summaries. Each confirmed rule names its compilation as a source.
- `draft`: matches an agency draft (the 2027 Pub 15-T).
- `projected`: carried forward or estimated because the year has not been published. A program whose rate resets every year (`annual: true` in `states.ts`) is projected for every year after the last one checked (`verifiedThrough`).
- `unverified`: entered from research and not yet matched to any source.
- `placeholder`: structure only.

A rule can only be `confirmed` if it names a source outside our own research; a test enforces this, along with unique ids, no overlapping date ranges for the same tax, and a sweep of every state, filing status and wage level for negative, falling or implausible income tax.

The seed (`apps/api/src/seed.ts`) runs on every start. It writes all rules in one statement, leaves alone any rule a person has edited in the app (`updated_by` is not `seed`), and deletes rules it wrote earlier but no longer produces, so a renamed or replaced row cannot apply alongside its successor. Program rule ids are built from the kind and starting year, never from the row's position.

A check dated in a year with no federal tables gets a warning, and a proposal for such a year is refused. `npm run bench` times the engine.

