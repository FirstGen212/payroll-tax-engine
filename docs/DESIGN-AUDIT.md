# Design audit and redesign (November 2026)

The web app was audited screen by screen against [DESIGN.md](DESIGN.md) and restyled to it. This file records what was wrong, what changed and what is still open.

## Findings before the redesign

| Area | Problem | Guide section |
|---|---|---|
| Colors | Generic grey/blue palette with its own token names; bright greens and reds used for text and numbers (monthly savings in green, allotments in blue, savings deltas in red/green). | §1, §2, §9 |
| Brand | No accent rule, no First Gen identity, no glow background. | §5, §8 |
| Layout | Flat full-height sidebar with a border; main column 1400px; no page header blocks, just an `h2`. | §5, §6 |
| Cards and tiles | 1px borders, 8px radius, small 20px numbers; no hero tile. | §4, §6 |
| Controls | Square-ish 6px buttons and inputs under 44px; no focus outline; segmented controls were bordered button groups. | §6, §9 |
| Status | Eligibility and verification badges relied on color alone; "Best" price shown as green text; warning icon "⚠" with color only. | §1.4, §6 |
| Charts and bars | Stacked bars used status colors as series colors, with no legend. | §7 |
| Tables | Wide tables could scroll the page sideways; no row hover or totals row style. | §5, §6 |
| Dark mode | Existed, but with off-brand values. | §2 |
| Motion | No reduced-motion handling. | §9 |

## What changed

- `apps/web/src/styles.css` rebuilt on the guide's tokens (core, brand, status, chart, segmented control, sidebar, spacing, radius, shadow) with light and dark values, following the system setting unless Light or Dark is picked in the sidebar.
- 4px four-color rule on every page, glowing tint background, floating translucent 15rem sidebar with line icons, status line and theme switch.
- Every page opens with a header block (eyebrow, title, takeaway sentence with bold numbers): Clients, Client, Employee, Pay run, Pay run results, Proposals, Proposal builder, Paycheck calculator, Tax database, Vendor profiles.
- Cards: no borders, 16px radius, card shadow, 24px padding. Tiles: 32px tabular numbers, first tile in each row is the navy hero.
- Buttons, inputs and selects are round pills, 44px buttons, primary is navy (bright blue in dark mode). Focus outline on everything.
- Status pills have a dot plus a word (`b-ok`, `b-warn`, `b-bad`, `b-neutral`, `b-primary`). Green is used once: the "Best margin" pill in the margin analyzer.
- Proposal tool: eligibility and allotment-distribution bars use chart tokens with a legend; selected price row and expanded employee row use the tint with a navy edge; totals row uses `fg-all`; text no longer takes status colors.
- Wide tables scroll inside their card (`fg-tablebox`), so no page scrolls sideways (checked at 1440px and 390px wide).
- `prefers-reduced-motion` turns off transitions. Print view stays plain black on white.

## Still open

- **Logo files.** The guide's wordmark PNGs are not in the repo yet. Add `first-gen-wordmark-light.png`, `first-gen-wordmark-dark.png` and `first-gen-mark.png` to `apps/web/public/brand/` and the sidebar shows them automatically (156×26); until then it shows the words "First Gen" in plain text.
- **Login page.** The app uses the browser's sign-in prompt (`APP_PASSWORD`). A styled login page per §10 needs real accounts (or Google sign-in) first.
- **Sticky bar** (§5) and **sparklines/d3 charts** (§7) are not used yet; there are no time-series views.
