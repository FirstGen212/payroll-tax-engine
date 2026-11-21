# Security notes

What protects the app today, and what is still open. Update this when you add a route, a header or a dependency.

## In place

- **Sign-in and roles** (`apps/api/src/auth.ts`): scrypt passwords, random session tokens stored only as sha256, httpOnly SameSite=Lax cookie (Secure over HTTPS). Ten wrong passwords lock an account for 15 minutes. Every API route needs a rule in `requiredPermission`; a route without one is refused. Viewing as someone never gives more than the signed-in person has.
- **First admin**: needs the `APP_PASSWORD` setup key when hosted. Two setup requests at the same moment take turns on a database lock, so only one admin is created.
- **Proposals**: analysts see and change only their own (`load` in `apps/api/src/proposals/routes.ts`); the check runs before any calculation.
- **Client links** (`/r/...`): 64 random bits in the address, revocable, `noindex`, never cached. The page shows only the published snapshot; the button link must be `http(s)`.
- **Headers on every response** (`apps/api/src/security.ts`): a Content Security Policy that allows only the app's own scripts and the Google font, no framing (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), `nosniff`, `Referrer-Policy: same-origin` (a client link never leaks to another site), HSTS over HTTPS, and `no-store` on API answers.
- **Memory on the 512 MB plan**: uploads are streamed (`parse.ts`), files over 15 MB are refused, proposals are capped at 20,000 rows and 12 program prices, and heavy work (reading files, calculating, building workbooks) runs one at a time with up to 20 waiting; past that the server answers "busy" instead of running out of memory. Calculations run in a worker thread (`apps/api/src/proposals/calc-worker.ts`, 300 MB heap cap) so the server keeps answering, including Render's health check, while a large file is calculated; the main heap is capped at 400 MB in `render.yaml`.
- **Database**: a dropped connection is logged and replaced instead of stopping the app; queries stop after 60 seconds.
- **Downloads**: CSV cells that a spreadsheet would run as formulas (`=`, `+`, `-`, `@`) are written as text.

## Still open

- **zod 3** has a memory advisory for very large constrained arrays (GHSA-mrhx-c7xc-m3w5). Request bodies are size-limited, which bounds it; moving to zod 4 is a larger change.
- **react-router 6** has an open-redirect advisory for paths with backslashes. The app only navigates to paths it builds from ids, so it is not reachable; moving to v7 removes it.
- **exceljs** pulls an old `uuid` (moderate advisory, not reachable: exceljs does not pass buffers to it).
- **Dev tools** (vite 5, vitest 2) have advisories that matter only on a developer machine running their dev servers.
- **Password spraying**: sign-in limits count per account, not per address, because behind Render's proxy every caller looks alike. A per-address limit needs the proxy hop count set (`trustProxy`).
