# First Gen Dashboard: Design Guide

How the First Gen Metrics Dashboard looks and why. Everything here is taken from the live code (`public/index.html`, `public/login.css`), so it matches what's on the site today. When you build a new card, tab or page, use these tokens and components rather than new colors or one-off styles.

Brand source: the current First Gen Brand Kit (FG-BRAND-1026 v2.0). **Any brand file with orange in it is out of date.**

> In this repo the tokens and components live in `apps/web/src/styles.css`, and the page header, tile and status pill components in `apps/web/src/components.tsx`. All UI work follows this guide.

---

## 1. Principles

1. **Navy carries the brand; blue is the accent; green is rare.** Green (#84FC29) appears once or twice per page at most, and never as small text on white.
2. **Calm surfaces, strong numbers.** Pale tint background, white cards and big bold figures. The data is the decoration.
3. **Every view works in light and dark.** Each color is a token with a light and a dark value. Never hard-code a hex in a component.
4. **Color never carries meaning alone.** Status uses a dot plus a word, and charts with more than one series have a legend.
5. **Plain words.** Card titles say what the card shows. Takeaways are full sentences with the key numbers in bold.

---

## 2. Color tokens

Defined on `:root`. Dark values apply under `prefers-color-scheme: dark` (unless `data-theme="light"`) and under `data-theme="dark"`.

### Core

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#EEF3F8` | `#0A1628` | Page background |
| `--color-panel` | `#FFFFFF` | `#0E2650` | Cards, tiles, inputs |
| `--color-fg` | `#0B2043` | `#FFFFFF` | Main text |
| `--color-fg-muted` | `#566C8F` | `#B4C1D6` | Labels, captions, axis text |
| `--color-border-line` | `#D9DFE8` | `#2A4166` | Borders, table rules, bar tracks |

### Brand and accents

| Token | Light | Dark | Use |
|---|---|---|---|
| `--fg-primary` | `#0B2043` | `#38B6FF` | Primary buttons, "Right now" badge |
| `--fg-primary-hover` | `#16356B` | `#49A9F7` | Primary hover |
| `--fg-on-primary` | `#FFFFFF` | `#0B2043` | Text on primary |
| `--fg-accent` | `#38B6FF` | `#38B6FF` | Bright blue accent |
| `--fg-accent-hover` | `#49A9F7` | `#49A9F7` | Sky blue |
| `--fg-green` | `#84FC29` | `#84FC29` | Rare highlight (see rule above) |
| `--fg-tint` | `#EEF3F8` | `rgba(255,255,255,.05)` | Row hover, totals row, button hover |
| `--fg-emphasis` | `#F3FDE9` | `rgba(132,252,41,.09)` | Soft green highlight |
| `--fg-caution` | `#EEF1F6` | `rgba(255,255,255,.08)` | Soft neutral callout |
| `--fg-focus` | `#0B2043` | `#38B6FF` | Focus outline |
| `--fg-nav-on` | `#1E7FC2` | `#38B6FF` | Icon on the selected tab |
| `--fg-glow` | `rgba(56,182,255,.22)` | `rgba(56,182,255,.16)` | Blue glow at the top right of the page |

### Status

Use only for state, never as a chart series color.

| Token | Light | Dark | Class |
|---|---|---|---|
| `--color-bad` | `#B3261E` | `#FF9C8F` | `.fg-bad` |
| `--color-warn` | `#7A5B00` | `#E8C15A` | `.fg-warn` |
| `--color-ok` | `#1E7A45` | `#7BD89B` | `.fg-ok` |

### Charts

| Token | Light | Dark | Use |
|---|---|---|---|
| `--cds-chart-series-1` | `#0B2043` | `#38B6FF` | The main series (bars, lines, sparklines) |
| `--cds-chart-muted` | `#9AA9BF` | `#7E90AD` | Secondary or "other" series |
| `--cds-chart-grid` | `#EEF3F8` | `#1B3560` | Gridlines |
| `--cds-chart-status-critical` | `#B3261E` | `#FF9C8F` | "Overdue" or "past due" segments |

### Segmented control and sidebar

| Token | Light | Dark |
|---|---|---|
| `--fg-seg-track` | `#E4E9F1` | `rgba(255,255,255,.08)` |
| `--fg-seg-on` | `#FFFFFF` | `#1B3560` |
| `--fg-seg-text` | `#43597C` | `#B4C1D6` |
| `--fg-side` | `rgba(255,255,255,.72)` | `rgba(14,38,80,.72)` |
| `--fg-side-on` | `#FFFFFF` | `#1B3560` |

---

## 3. Typography

**Typeface:** Inter, falling back to Liberation Sans, then system-ui. One family for everything.

| Role | Class | Size | Weight | Notes |
|---|---|---|---|---|
| Page title | `.fg-title` | 2.25rem (36px) | 700 | Letter-spacing −.03em, line-height 1.1, `text-wrap: balance` |
| Eyebrow | `.fg-eyebrow` | .75rem (12px) | 700 | UPPERCASE, letter-spacing .12em, muted. Always sits above a title |
| Takeaway | `.fg-takeaway` | 1.0625rem (17px) | 400 | Muted text; key numbers in `<b>` (600, full color). Max 70ch |
| Card heading | `.fg-card h3` | 1.0625rem (17px) | 700 | Letter-spacing −.015em |
| Big number | `.fg-num` | 2rem (32px) | 700 | Tabular numbers, letter-spacing −.025em |
| Body | — | .9375rem (15px) | 400 | Line-height 1.45 |
| Caption, label, table | `.fg-label`, `.fg-sub`, `.fg-note` | .875rem (14px) | 400 | Muted |
| Badge or pill | — | .75rem (12px) | 600 | — |

- Use **tabular numbers** (`font-variant-numeric: tabular-nums`) wherever figures line up: tiles, tables, tooltips and the status line.
- Medium emphasis is weight **600**. Headings and figures are **700**.

---

## 4. Spacing, radius, shadow

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--cds-gap-xs` | .25rem (4px) | | `--cds-pad-xs` | .25rem |
| `--cds-gap-sm` | .5rem (8px) | | `--cds-pad-sm` | .5rem |
| `--cds-gap-md` | 1rem (16px) | | `--cds-pad-md` | .75rem |
| `--cds-gap-lg` | 1.5rem (24px) | | `--cds-pad-lg` | 1rem |
| `--cds-gap-xl` | 2rem (32px) | | | |

- **Card radius** `--fg-card-radius`: 16px (cards, tiles, sidebar, login form)
- **Small radius** `--cds-radius`: 8px (tooltips, skeletons)
- **Nav items**: 10px. **Sticky bar**: 12px
- **Pills, buttons, inputs, selects**: 999px (fully round)
- **Card shadow** `--fg-card-shadow`: `0 1px 2px rgba(11,32,67,.04), 0 8px 24px rgba(11,32,67,.06)`. In dark mode the same shape at `rgba(0,0,0,.25)`
- **Popover shadow**: `0 4px 16px rgba(11,32,67,.14)` (dark: `rgba(0,0,0,.5)`)
- Cards have **no borders**; the shadow separates them from the page.

---

## 5. Page layout

```
┌──────────── 4px four-color rule (sticky, full width) ────────────┐
│ ┌─────────┐  ┌──────────── main (max 1240px) ─────────────────┐ │
│ │ Logo    │  │ EYEBROW                                         │ │
│ │         │  │ Page title                                      │ │
│ │ ▸ Sales │  │ Takeaway sentence with **bold** numbers.        │ │
│ │ ▸ Go-live│ │ [filters row]                                   │ │
│ │ ▸ Tasks │  │ [hero tile][tile][tile][tile]                   │ │
│ │ ...     │  │ [card            ][card            ]            │ │
│ │         │  │ [card (full width table)            ]           │ │
│ │ status  │  └─────────────────────────────────────────────────┘ │
│ │ account │                                                      │
│ └─────────┘                                                      │
└──────────────────────────────────────────────────────────────────┘
```

- **Accent rule** (`.fg-rule`): 4px tall and sticky at the top, made of four equal segments: navy `#0B2043`, bright blue `#38B6FF`, sky `#49A9F7`, green `#84FC29`. It's the brand signature and appears on every page.
- **Background:** `--color-bg` with a soft radial blue glow (`--fg-glow`) at the top right, fixed in place.
- **Sidebar** (`.fg-side`): 15rem wide, floating, sticky, translucent (`--fg-side` with a 16px backdrop blur), 16px radius, card shadow. It holds the logo (156×26), the tab list, and at the bottom the status line, account and buttons.
- **Main column** (`.fg-shell`): max 1240px, centered, 32px padding.
- **Sticky bar** (`.fg-stick`): a small white bar that fades in on scroll with the page name and quick actions.
- **Grids:**
  - Tiles: `repeat(auto-fit, minmax(10rem, 1fr))`, 16px gap. The Sales tiles are a fixed 4 columns, with a 2-column-wide hero tile.
  - Cards: `repeat(auto-fit, minmax(24rem, 1fr))`, 16px gap.
- **Below 60rem (960px):** the sidebar becomes a static block at the top, tabs wrap in a row, and the side gutters become 16px.
- **Below 40rem:** `.fg-hide-narrow` columns are hidden, and segmented buttons get less padding.
- No horizontal page scroll at any width. Wide tables scroll inside `.fg-tablebox` instead.

---

## 6. Components

### Header block
```html
<div class="fg-head">
  <p class="fg-eyebrow">Sales</p>
  <h1 class="fg-title">Pipeline and wins</h1>
  <p class="fg-takeaway">Deals won in the selected dates: <b>12</b>, adding <b>340</b> W2 employees.</p>
</div>
```
Every tab opens with this. The takeaway is one or two sentences that state the headline numbers.

### Sidebar tab
`.fg-tab`: at least 44px tall, 10px radius, an 18px masked line icon before the label (muted, or `--fg-nav-on` when selected).
- Hover: `--fg-seg-track` background.
- Selected (`aria-selected="true"`): white (`--fg-side-on`) background, weight 600, card shadow.

### Stat tile
`.fg-tile`: a white card holding a `.fg-label`, then a `.fg-num`, then an optional `.fg-sub` and `.fg-spark`.
- **Hero tile:** the first tile in a row is the hero. It has a navy gradient (`linear-gradient(135deg, #0B2043, #123A78)` with a radial `#1C86B4` glow at the bottom right) and white text, and its spark line turns white. Use one hero per tile row.
- Under the number, a sub line gives context ("Prior period: **9**").

### Card
`.fg-card`: white, 16px radius, shadow, 24px padding. It contains an `h3`, an optional `.fg-note`, `.fg-legend`, then the chart or table.
- **Basis badge:** `<h3 data-basis="In selected dates">` adds a grey pill after the title saying which time frame the card uses. `data-basis="Right now"` makes it a navy (primary) pill.

### Buttons
- `.fg-btn`: a fully round pill, at least 44px tall, weight 600, white with a line border. Hover gives a tint background and a muted border.
- `.fg-btn-primary`: navy fill with white text (bright blue with navy text in dark mode).
- `.fg-link`: inline text button, underlined with a line-colored underline that turns full color on hover.

### Filters row
`.fg-filters` is one row above the content: caption-size muted text, round 36px `select` and `input[type=date]` controls. The hover border is muted. A second filters row tucks up close under the first.

### Segmented control
`.fg-seg`: a grey track (`--fg-seg-track`, 20px radius, 3px padding) with round buttons.
- The pressed button (`aria-pressed="true"`) is white with weight 600 and a small shadow.
- Use it for presets like Week / Month / Quarter.

### Table
- `.fg-table` sits inside `.fg-tablebox` (max 26rem tall, scrolls inside).
- Text is caption size with tabular numbers. The header is sticky, muted, weight 600, with a bottom rule.
- The first column is weight 600. Rows show a tint on hover.
- `.fg-r` right-aligns numbers. `.fg-all` is a totals row (tint and bold).

### Status pill
`.fg-pill.fg-bad | .fg-warn | .fg-ok`: a round pill with a 6px dot, a background of the status color at 10%, and a text label. Always use a word with it ("Overdue", "On track"), never the color alone.

### Progress bar
`.fg-bar`: a 4px line-colored track with a `--cds-chart-series-1` fill.

### Tooltip
`.fg-tip`: popover surface, 1px border, 8px radius, popover shadow, caption size. The header line (`.fg-tip-h`) is secondary text.

### Loading, error, empty
- **Loading:** `.dash-skeleton` shows a shimmer over the text, which stays transparent until data lands.
- **Refreshing:** the area drops to 50% opacity.
- **Failed:** `.fg-fail` shows a red dot and a muted caption, centered in the card.
- Never show `NaN` or a blank card. Show "—" until there's a value.

---

## 7. Charts

- **Drawn with d3 into SVG** inside `.fg-chart` (min 12rem tall).
- **Axis and label text:** caption size, muted color, Inter. Value labels (`.fg-val`) are full color with tabular numbers.
- **Gridlines:** 1px in `--cds-chart-grid`, horizontal only. They should be recessive.
- **Bars:** thin, with 2px rounded corners (`rx=2`).
- **Lines:** 2px stroke, round joins, `non-scaling-stroke`.
- **Colors by job:**
  - Main measure: `--cds-chart-series-1` (navy in light mode, bright blue in dark)
  - Secondary or "other": `--cds-chart-muted`
  - Overdue, past due or stale: `--cds-chart-status-critical`
- **One axis per chart.** Two measures on different scales get two charts.
- **Legend** (`.fg-legend`): 10px rounded swatch plus label, caption size, above the chart. Required when there are two or more series.
- **Hover:** every bar, dot and line gets a tooltip. Tooltips only update the tooltip; they don't redraw the page.
- **Sparklines** (`.fg-spark`): 36px tall, current color. They appear in tiles only.

---

## 8. Logo and assets

Files are in `public/brand/` (in this repo: `apps/web/public/brand/`):
- `first-gen-wordmark-light.png` for light backgrounds
- `first-gen-wordmark-dark.png` for dark backgrounds
- `first-gen-mark.png`, the mark on its own

Rules:
- Swap the two wordmarks with the theme (`.fg-logo-light` / `.fg-logo-dark`).
- Sizes: 156×26 in the sidebar, 168×28 on the login page.
- **Never rebuild, recolor or stretch the logo.** Use the supplied files.

---

## 9. Accessibility and motion

- **Focus:** a 2px `--fg-focus` outline on every interactive element, 1–2px offset.
- **Touch targets:** at least 36px tall, 44px for buttons and tabs.
- **Text color:** use `--color-fg` or `--color-fg-muted` only. Text never takes a series color.
- **Motion:** `prefers-reduced-motion: reduce` turns off all transitions. Standard transitions are .12s for hover and .15s for the sticky bar.
- **Dark mode:** follows the system setting unless the user picks light or dark (`data-theme`).

---

## 10. Login page

The login page uses the same system in a smaller form (`login.css`):
- A centered 22rem white card (16px radius, card shadow) on the glowing tint background.
- Logo, then a 22px bold heading.
- Round 44px inputs on the bg color, a navy full-width primary button, and an outlined "Sign in with Google" button.
- Errors appear in `--bad` at 13px.

---

## 11. Do / don't

| Do | Don't |
|---|---|
| Use tokens (`var(--color-fg)`) | Hard-code hex values in components |
| One hero tile per row | Make every tile navy |
| Green once or twice per page | Use green for text or for a chart series |
| Status color plus dot plus word | Use red or green as the only signal |
| Bold the key numbers in takeaways | Put numbers on every chart point |
| Keep Finance and Executive figures off shared images | Post Finance or Executive cards to Slack |
| Check light and dark | Ship a view only tested in light mode |
