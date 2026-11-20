# Payroll Tax Engine

A US payroll tax research database, calculation engine and web app for running **actual, mock and proposal (eligibility) payrolls** across multiple employer clients. Built for First Gen to model what ADP, Viventium, Empeon, Paychex, Paycor and Paylocity calculate, and eventually to calculate *like* each of them.

TypeScript + PostgreSQL. Tax year 2027 is primary; every rule is effective-dated so 2025, 2026 and 2027 coexist.

## What's in it

| Area | What it does |
|---|---|
| **Tax database** (`packages/tax-data`) | Federal, all 50 states, DC, and 5 territories (PR, GU, VI, AS, MP) plus a starter set of local jurisdictions. Every rule carries an effective date range, a **verification status** and **source citations**. |
| **Engine** (`packages/engine`) | Pub 15-T percentage method (2020+ and pre-2020 W-4s, Step 2, NRA), supplemental flat/aggregate with the $1M rule, FICA/Additional Medicare/FUTA with credit reduction, state formulas, multi-state (reciprocity, resident credit, wage allocation, convenience of employer), locals (PA Act 32 + LST, Philadelphia, Ohio cities + school districts with resident credit, NYC, Yonkers, MD counties, IN counties, MI/KY/MO/AL, CO OPT, OR transit), SUI/SDI/PFL/PFML/WA Cares, territories, pre/post-tax deductions with IRS limits and catch-ups, public pension pick-ups (Texas TRS etc.), garnishments with CCPA limits, and a full audit trail on every line. |
| **Proposal tool** (`/proposals`) | Upload a census, underwriting sheet or payroll sample (.xlsx/.csv), auto-map its columns, set pricing tiers (deduction, benefit payment back, employer and employee fees) and eligibility rules, then compare every employee's taxes and take-home pay for a full plan year before and after the new pre-tax deduction. Results: eligibility breakdown, before/after totals, per-employee detail with the reason in plain words and what would change it (more pay, more hours, missing data), and an Excel export. The export opens on **Employee allotments** (one row per employee: status, plan, deduction per check, savings allotment per month and year, employer savings, the reason and what would change it, with a totals row), followed by the summary and the underwriting sheet with Before Taxes / After Taxes / Monthly Allotment / Eligibility filled in. It can be downloaded from the builder or from each row of the queue. A reviewer can override any row (leave out, force a plan, change the deduction or hours, with a note) and set the share of eligible employees expected to enroll. |
| **Proposal queue** | Every saved proposal with its status (draft, in review, completed, sent, won, lost), owner, headline numbers and client link. Reopen one to change the rules, recalculate it with today's tax data, copy it, or load an earlier version from its history. |
| **Client proposal page** (`/r/<company>-<random>`) | The page a client sees, built from [docs/DESIGN.md](docs/DESIGN.md): savings, valuation, implementation steps, every employee with their status (eligible employees with their amounts; everyone else with the reason and what would change it, filterable by status and name), next steps, Download PDF. The paperwork button goes nowhere until a link is set for it. Its text and sections are edited per proposal with a live preview. Each publish makes a fresh link holding a snapshot of the numbers, so a link already sent never changes; a link can be turned off. No sign-in is needed to open one, so the random part is 64 bits and pages are marked noindex. |
| **Users and access** (`/admin`) | Accounts with a role (admin, manager, analyst, viewer) plus per-person permission changes, "view as" another user, and an audit log of sign-ins, changes and view-as sessions. |
| **Vendor profiles** | ADP, Paychex, Viventium, Empeon, Paycor, Paylocity profiles capture calculation conventions (rounding, supplemental method, FICA true-up, deduction base...). The **learner** searches those conventions against sample paychecks to work out how a provider calculates. |
| **API** (`apps/api`) | Fastify + Postgres. Clients, work locations, tax toggles and SUI rates, employees with federal and state W-4s, recurring deductions, pay runs, YTD, scenario comparisons, vendor learning, rule editing with history. |
| **Web app** (`apps/web`) | Clients, employee setup, pay run screen, tax setup and toggles, tax research database with status/coverage, paycheck calculator with Section 125 savings comparison, vendor profiles. |

## Design

All UI work follows the First Gen design guide in [docs/DESIGN.md](docs/DESIGN.md) (tokens, components, light and dark). [docs/DESIGN-AUDIT.md](docs/DESIGN-AUDIT.md) lists what the redesign changed and what is open.

## Verification status (read this before using numbers for live payroll)

Every tax line in every paycheck shows the status of the rule that produced it:

- **published**: matches a final agency publication we cited.
- **draft**: matches an agency draft (federal 2027 FIT uses the IRS early-release draft Pub 15-T from Nov 9 2026 plus Rev. Proc. 2026-35).
- **projected**: the agency has not published that year yet; values are carried forward or projected from a statutory schedule.
- **unverified**: entered from research; must be checked against the cited agency source.
- **placeholder**: structure only (American Samoa income tax).

Current totals are in [docs/COVERAGE.md](docs/COVERAGE.md). In short: federal figures for 2027 are sourced from IRS/SSA; most state and local values are **unverified** and the next phase is to verify them state by state against each agency's withholding guide. The app warns on every check that uses unverified data.

## Run it

```bash
docker compose up -d db            # or any Postgres 14+; set DATABASE_URL
npm install
npm run db:seed                    # creates schema and loads the tax database
npm run seed:demo -w apps/api      # optional: three fictional demo clients
npm run dev:api                    # http://localhost:4000
npm run dev:web                    # http://localhost:5173
npm test                           # engine audit tests, sign-in and permission tests, client-page tests
```

`npm run build -w apps/web` then `npm start -w apps/api` serves the built UI from the API on one port.

The first visit asks you to create the admin account. Locally that needs nothing else; when `APP_PASSWORD` is set (and always when hosted) it also asks for that value as a setup key. The admin adds everyone else under **Admin**.

## Deploy to Render

`render.yaml` is a Render Blueprint: one web service (API plus the built web app) and a Postgres database. In Render choose **New > Blueprint**, pick this repository and branch, and apply. Each start runs the seed (schema plus tax database; safe to re-run, client data is kept). The first visit asks you to create the admin account and needs the setup key: the `APP_PASSWORD` value Render generated, under the service's Environment tab. After that everyone signs in with their own email and password.

## Users, access and client links

- **Roles** are starting sets of permissions: admin (everything), manager (everyone's proposals and clients, tax rules, the audit log), analyst (their own proposals, mock payroll, client links), viewer (read-only). Tick or untick single permissions for one person on their Edit form.
- Nobody can give out, or change, access above their own, and the app always keeps at least one active person who can manage users.
- **View as** shows the app exactly as another user sees it. It never gives more access than the signed-in person has, a banner stays on screen until it is stopped, and the audit log records both people on every change.
- **Access rules live in one place:** `requiredPermission` in `apps/api/src/auth.ts`, keyed by route. A new route that changes data is refused until it has a rule there (and a row in `apps/api/test/auth.test.ts`).
- Passwords are stored as scrypt hashes, sessions as a hash of a random cookie token (httpOnly, 14 days), and ten wrong passwords lock that account's sign-in for 15 minutes.
- Other sites cannot call the API unless `CORS_ORIGIN` lists them.

## Loading the full local jurisdiction lists

The starter set covers the major local systems. The complete lists come from agency files, loaded with importers that mark rows `published` and cite the file:

```bash
npm run import:pa-psd -w apps/api -- ./PSD_codes.csv 2027-01-01     # PA DCED: ~2,500 PSDs with resident/NR EIT and LST
npm run import:oh-muni -w apps/api -- ./ohio_municipal.csv 2027-01-01 # Ohio municipal rates, credit % and credit limit
```

## Repository layout

```
packages/tax-data   types, sources, federal/state/territory/local data, benefits, reciprocity, vendor profiles
packages/engine     calculation engine, pay runs, scenario comparison, vendor learner, tests
apps/api            Postgres schema (migrations), seed, importers, REST API
apps/web            React UI
docs                coverage report, roadmap, architecture notes
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for the phased plan and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how a paycheck is calculated.
