# Rule catalogue

All rules report confidence separately from severity. Rules never claim SAP mandates a heuristic. Source locations identify the syntax establishing evidence; a config-level issue may identify its file without a line when no reliable token location exists.

| ID | Detection | Basis | Valid exceptions / limits |
| --- | --- | --- | --- |
| KAEV-PROJ-001 | Insufficient UI5 evidence | Heuristic | Non-UI5 folder or unsupported workspace root; no numeric score |
| KAEV-CONFIG-001 | Manifest parsing/read failure | Derived | Fix syntax/access before relying on dependent checks |
| KAEV-CONFIG-002 | Missing config with declared UI5 CLI, or malformed config | Derived | Legacy projects without UI5 CLI do not require ui5.yaml |
| KAEV-CONFIG-003 | Missing spec/type or component type below spec 5 | Official | Partial consistency check; does not replace CLI schema validation |
| KAEV-UI5-001 | Selected sap.m XML controls without IDs in flexibility-enabled freestyle apps | Official | Other apps/controls are not checked; aggregation/template semantics need review |
| KAEV-ODATA-001 | filter on a locally traced OData V2 collection | Derived | Small intentional client datasets can be valid; no arbitrary arrays |
| KAEV-ODATA-002 | sort on a locally traced OData V2 collection | Derived | Same exceptions as filtering |
| KAEV-ODATA-003 | Literal OData model size limit above 10,000 | Heuristic | A binding size limit does not by itself fetch the whole service |
| KAEV-ARCH-001 | fetch, jQuery AJAX or XHR open targeting a configured/recognizable OData URL | Derived | Intentional low-level networking may be legitimate |
| KAEV-ARCH-002 | innerHTML/outerHTML assignments in controller/component source | Heuristic | Custom rendering can be intentional; security finding takes precedence |
| KAEV-PERF-001 | Proven OData model refresh inside a syntactic loop | Heuristic | Does not trace event handlers or indirect loop helpers |
| KAEV-SEC-001 | Credential-name/literal structure evidence, bearer strings or private-key markers | Heuristic | Not a comprehensive secret scanner; placeholders and names alone do not suffice |
| KAEV-SEC-002 | Sensitive storage key in localStorage/sessionStorage setItem | Heuristic | Harmless preferences are not reported |
| KAEV-SEC-003 | Dynamic HTML assignment or UI5 HTML without explicit sanitizeContent | Heuristic | Data may already be trusted/sanitized; not proof of XSS |
| KAEV-SEC-004 | eval or new Function | Derived | Review dynamic execution and CSP requirements |
| KAEV-SEC-005 | Non-loopback HTTP network call or configured OData endpoint | Heuristic | Local development endpoints and test directories excluded |
| KAEV-SEC-006 | Sensitive identifiers passed to supported log calls | Heuristic | No interprocedural taint tracking; harmless logs excluded |
| KAEV-SEC-007 | Role/permission condition controlling UI5 visibility/enabled state | Heuristic | Verify backend independently; frontend-only evidence cannot establish missing authorization |
| KAEV-SEC-008 | Direct POST/PUT/PATCH/DELETE to recognizable OData endpoint | Derived | Verify manual CSRF lifecycle; not a confirmed CSRF exploit |

Official analyzer findings use `UI5LINT/[original-rule-id]`. Kaev does not reimplement UI5 deprecation/global rules. These are classified as modernization and scored conservatively. Explicit security checks add Kaev context and confidence.

## Source references

References are centrally resolved in `src/core/standards.ts`, not hardcoded into rule implementations:

- [UI5 CLI configuration and resource paths](https://ui5.github.io/cli/v5/pages/Configuration)
- [UI5 Linter Node API and compatibility scope](https://github.com/UI5/linter#nodejs-api)
- [Official UI5 Linter rules](https://github.com/UI5/linter/blob/main/docs/Rules.md)
- [SAPUI5 server-side filtering](https://help.sap.com/docs/SAPUI5/b2f662dd9d7a4ec680056733050b4d34/5338bd1f9afb45fb8b2af957c3530e8f.html)

The docs metadata path `/rules/[ID]` is a future documentation resolver contract; it does not assume a hosted Kaev domain.
