# Third-party dependency review

Reviewed 2026-09-28. `@ui5/linter` 1.23.7 is pinned and ships its own npm-shrinkwrap. npm audit reports 7 affected production dependency entries (4 high, 3 moderate; no critical entries), including transitive effects on UI5 Linter itself. The current upstream release has no newer published patch and npm reports no complete fix.

The currently reported underlying advisory concerns sigstore DSSE payload-type binding. The installed chain is `@ui5/linter` → `@ui5/project` → `pacote` → `sigstore` → `@sigstore/core` 2.0.0; npm expands the advisory through dependent packages. Upstream's shrinkwrap retains these versions. A root-level override is not used because bypassing the official shrinkwrap would be an unsupported and potentially incompatible mitigation.

Kaev's adapter constructs a single root project with framework/dependency resolution disabled by the official Node API implementation. It does not download, install, resolve Git packages or verify package signatures. Network entry points are blocked before importing the analyzer; the subprocess has no filesystem write or child-process permissions. Those controls reduce reachability of the affected paths in this integration, but do not erase third-party advisories.

This is a documented release risk, not a claim of a clean dependency audit. Review the upstream dependency changes before distributing a release. Run `npm audit --omit=dev` to obtain the current advisory state. Do not apply unsupported dependency overrides without testing the actual installed package tree.

Advisories:

- [sigstore DSSE payload type binding](https://github.com/advisories/GHSA-jfc7-64v2-mr8c)

Development note: npm 10 encountered an Arborist `edgesOut` failure resolving the upstream shrinkwrap in this environment. npm 11 completed installation. Use npm 11 if the same upstream installation failure occurs; no package hooks are required.
