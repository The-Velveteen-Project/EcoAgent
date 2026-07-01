# Changelog

## 2026-07-01 — Stage: EcoAgent -> ALLO visible rename

- Renamed the visible product identity from EcoAgent to **ALLO** across README, public docs, bot copy, web metadata, and user-facing i18n strings.
- Added local copies of `docs/MODEL_CARD.md` and `docs/DATA_SOURCES.md` from the repository's GitHub state so the workspace matches the current scientific framing.
- Renamed `docs/ecoagent-pruning-audit.md` to `docs/allo-brand-audit.md` and updated references.
- Renamed the visible logo asset from `web/public/logo-ecoagent.jpeg` to `web/public/logo-allo.jpeg`.
- Updated package metadata names to `allo` and `allo-web`.
- Rewrote the README around ALLO as an adaptive observatory and decision-support tool, explicitly avoiding deterministic or single-event prediction claims.
- Preserved internal contracts and prohibited identifiers, including simulation interfaces, engine names, schemas, endpoints, environment variables, `CIR_` prefixes, and SQL table names.

### Validation

- `npm install`
- `npm test`
- `npm run build`
- `cd web && npm install`
- `cd web && npm run build`

### Result

- Backend tests: passed
- Root TypeScript build: passed
- Web Next.js production build: passed
