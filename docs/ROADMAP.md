# Roadmap

Covering every US taxing jurisdiction is a multi-phase effort. This is the plan and where things stand.

## Phase 1 (this PR): working engine, full structure, honest data

- [x] Effective-dated, cited, status-tracked tax database (Postgres + typed source data)
- [x] Federal 2025, 2026, 2027 (2027 from Rev. Proc. 2026-35, draft Pub 15-T, SSA $192,300 wage base)
- [x] All 50 states + DC: income tax withholding formula, SUI (wage base, new-employer rate, rate range, employee SUI, surcharges), SDI / PFL / PFML / WA Cares / transit / workforce programs
- [x] Territories with flags: PR (own income tax, SINOT, chauffeur's insurance, FICA + FUTA), GU/VI/MP (mirror code), AS (placeholder), CNMI wage and salary tax
- [x] Starter locals: OH (40 cities, sample school districts), PA Act 32 + LST + Philadelphia, NYC, Yonkers, MCTMT, MI (24 cities), MD (24 counties + nonresident), IN (20 counties), KY (10 OLTs), MO, AL, DE, NJ Newark, OR transit / Metro SHS / Multnomah PFA, CO OPT, WV city fees
- [x] Earnings (50 types), deductions (50 types), IRS limits 2025-2027, public retirement systems (Texas TRS/ERS/TMRS/TCDRS, CalSTRS, CalPERS, NYSTRS, OH STRS/OPERS, IL TRS, GA TRS, FL FRS, PA PSERS)
- [x] Multi-state: reciprocity (17 states + DC), resident credit, allocation, convenience of employer
- [x] Garnishments: child support (50/60/+5%), federal levy (Pub 1494 approximation), student loan AWG, creditor (CCPA)
- [x] Multi-employer app: clients, locations, tax toggles + SUI rates, employees, W-4s, pay runs (actual / mock / proposal), YTD
- [x] Vendor profiles + learner groundwork

## Phase 2: verification (state by state)

For each state, compare our formula and every parameter against the agency's current withholding guide and its published examples, then flip the rows to `published`.
Priority order (by First Gen client footprint, to be confirmed with the client list): NY, NJ, PA, TX, FL, CA, OH, MD, MA, CT, IL, GA, NC, VA, then the rest.
Known simplifications to replace with exact agency tables: NY (NYS-50-T tables and recapture), NYC, CA (DE 44 2026/2027), CT (TPG-211 phase-outs), NJ (NJ-WT thresholds), HI (Booklet A), WI (sliding standard deduction), OR (federal tax subtraction phase-out), MD (county tiered rates), AL standard deduction phase.

## Phase 3: every local jurisdiction

- PA DCED full PSD file (importer ready)
- Ohio municipal rates (importer ready), Ohio school district list (traditional vs earned income base)
- Kentucky occupational license taxes (city, county, school; wage caps)
- Indiana all 92 counties (DOR Departmental Notice #1)
- Michigan, Maryland tiered county rates, Missouri, Alabama occupational, Colorado OPT, West Virginia fees, Oregon transit district boundaries
- Address/ZIP-to-jurisdiction geocoding so employees are assigned automatically

## Phase 4: provider calculation profiles

- Register importers for ADP, Paychex, Viventium, Empeon, Paycor, Paylocity exports (column aliases already defined)
- Learn each provider's conventions from Evan's sample registers; report residuals that indicate setup or rate differences
- Side-by-side "our calc vs provider" reconciliation report per client

## Phase 5: operations

- 2027 final Pub 15-T tables loaded as `publishedTables` when the IRS issues them
- 2027 FUTA credit reduction states (DOL, Nov 2027) and 2027 SUI wage bases as states announce
- Annual rollover tooling: clone a year as `projected`, then verify
- Authentication and per-user audit of rule edits
