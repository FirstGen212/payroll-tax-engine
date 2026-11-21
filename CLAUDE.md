# Working in this repo

- **UI work follows [docs/DESIGN.md](docs/DESIGN.md)** (First Gen design guide). Use its tokens and components from `apps/web/src/styles.css` and `PageHead` / `Tile` from `apps/web/src/components.tsx`. Never hard-code a hex color in a component, check every view in light and dark, keep green to once or twice per page, and pair status colors with a dot and a word.
- Every page opens with a `PageHead`: eyebrow, title, and a takeaway sentence with the key numbers in bold.
- The logo comes only from `apps/web/public/brand/` (`first-gen-wordmark-light.png`, `first-gen-wordmark-dark.png`, `first-gen-mark.png`). Never rebuild or recolor it.
- See [docs/DESIGN-AUDIT.md](docs/DESIGN-AUDIT.md) for what the redesign changed and what is still open.
- Engine and data rules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every tax rule keeps its verification status and sources.
- **Every API route needs an access rule** in `requiredPermission` (`apps/api/src/auth.ts`) and a row in the route table in `apps/api/test/auth.test.ts`. Rules match the route pattern, not the URL; a route that changes data without a rule is refused. Hide or disable controls a person has no permission for (`useCan`).
- **Client-facing pages** (`/r/...`) render through `ReportView` from a published snapshot. They never show the internal app name or anything that is not in the snapshot.
- **Security**: see [docs/SECURITY.md](docs/SECURITY.md). Response headers live in `apps/api/src/security.ts`; heavy proposal work goes through `heavy.run` so the 512 MB server never runs several large files at once.
