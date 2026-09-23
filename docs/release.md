# Release verification

Run `npm run check`, then `npm run test:pack`. The latter installs the resulting tarball into a separate temporary consumer directory using an isolated npm cache. Run its installed executable against clean, insecure, malformed, legacy and custom-source-root fixtures, including the official adapter. Confirm help/version, doctor, check JSON and Markdown/JSON report creation.

Inspect `npm pack --dry-run`: only dist, README, docs and package metadata should ship. Fixture projects and test sources must not ship. Verify no project tree changes before/after analysis. Do not publish until the package name/ownership, licensing, registry access and release authorization are settled.

The package is intentionally marked UNLICENSED pending the owner's distribution license choice. No repository URL or maintainer identity has been invented. This does not prevent local builds or packed-artifact verification.

Dependency audits are separate from project analysis. Zetvik never runs npm audit on scanned applications. Third-party advisory status and reproducible verification results should be recorded for each release.
