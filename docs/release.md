# Release verification

Run `npm run check`, then `npm run test:pack`. The latter installs the resulting tarball into a separate temporary consumer directory using an isolated npm cache. Run its installed executable against clean, insecure, malformed, legacy and custom-source-root fixtures, including the official adapter. Confirm help/version, doctor, check JSON and Markdown/JSON report creation.

Inspect `npm pack --dry-run`: only dist, README, LICENSE, docs and package metadata should ship. Fixture projects and test sources must not ship. Verify no project tree changes before/after analysis. Do not publish until the package name/ownership, registry access and release authorization are settled.

The package uses the proprietary terms in `LICENSE`; no open-source license is granted. Public npm publication makes packaged files downloadable even though it does not grant recipients permission to use them. No repository URL or maintainer identity has been invented.

Dependency audits are separate from project analysis. Kaev never runs npm audit on scanned applications. Third-party advisory status and reproducible verification results should be recorded for each release.
