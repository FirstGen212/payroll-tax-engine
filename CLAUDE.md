# Working in this repo

- **UI work follows [docs/DESIGN.md](docs/DESIGN.md)** (First Gen design guide). Use its tokens and components from `apps/web/src/styles.css` and `PageHead` / `Tile` from `apps/web/src/components.tsx`. Never hard-code a hex color in a component, check every view in light and dark, keep green to once or twice per page, and pair status colors with a dot and a word.
- Every page opens with a `PageHead`: eyebrow, title, and a takeaway sentence with the key numbers in bold.
- The logo comes only from `apps/web/public/brand/` (`first-gen-wordmark-light.png`, `first-gen-wordmark-dark.png`, `first-gen-mark.png`). Never rebuild or recolor it.
- See [docs/DESIGN-AUDIT.md](docs/DESIGN-AUDIT.md) for what the redesign changed and what is still open.
- Engine and data rules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every tax rule keeps its verification status and sources.
