# Changelog

All notable changes to YourOpenScale are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- README rewritten for this fork (what it adds, goal projection, screenshots with demo data, license section). Deploy settings now live in the git-ignored `tools/deploy.local.env`.

### Added
- `THIRD-PARTY-NOTICES.md` with the licenses of bundled software.
- `tools/deploy.sh`: one-command deploy with tests, DB backup, healthcheck wait, smoke check, automatic rollback and pruning, plus `rollback` and `status`.
- Container healthcheck in the Dockerfile.

## [1.2.0] - 2026-11-22

### Changed
- Goal projection for weight loss now assumes the pace eases off as you approach a healthy weight, even when the history shows no curve yet. The assumed floor depends on height, age (older: higher floor) and, when measured, body fat (leaner: floor closer to your weight). The straight line is shown as the earliest date. A curve fitted to your own data still takes precedence.

## [1.1.0] - 2026-11-22

### Changed
- Goal projection no longer assumes a straight line. Since the goal start it fits a flattening curve (fast progress first, slower later), so the predicted date is more realistic. Short or straight histories still use the linear rate.

### Added
- New projection status "levels off": when the goal lies beyond the level the curve settles at, the card shows that level instead of a date.

## [1.0.0] - 2026-11-22

First release of YourOpenScale, a fork of YourOwnWeigh by Tom Anthony (MIT).

### Added
- Redesigned web UI: new navigation (primary links plus a grouped "Manage" menu), dashboard, readings and admin pages, light and dark themes.
- Charts and analysis on each person's overview.
- Installable PWA with offline page and service worker.
- Import of Withings data exports.
- Own SemVer versioning, shown in the footer, with this changelog.
- Goal start date and start weight. The goal form has a start date (default: today or the stored one) and an optional start weight; left empty, the start weight is taken from your trend on that day (fallback: nearest weigh-in, then your reference weight). Progress is measured from there and shown as "since <date>" on the dashboard and overview.
- German interface (informal "du") next to English. The language follows the `yos_lang` cookie, then the browser's Accept-Language, then English. An EN | DE switch sits in the footer (also on the sign-in and setup pages) and in Settings. Numbers, dates, chart tooltips, analysis sentences, flash messages and the offline page follow the language; CSV exports stay machine-readable.
- Date and time format preferences in Settings (Display), independent of the language: date as automatic, 22.11.2026, 2026-11-22, 11/22/2026 or 22/11/2026; time as automatic, 24-hour or 12-hour. Stored in the `yos_datefmt` and `yos_timefmt` cookies (also usable logged out via `GET /prefs`). Tables, texts, chart tooltips and day axis labels follow them; CSV, JSON, URLs and `<time datetime>` stay ISO. Automatic keeps 22 Nov 2026 in English and 22.11.2026 in German.
- Dev server forwards the language, theme and date format cookies so the e2e suite can exercise both languages.

### Changed
- Renamed the product to YourOpenScale (short name YOS). Protocol, firmware, bridge, environment-variable and database identifiers keep their original names.

### Known gaps
- Status and error messages that firmware.js builds at runtime, and technical validation errors for scale captures, stay English.
