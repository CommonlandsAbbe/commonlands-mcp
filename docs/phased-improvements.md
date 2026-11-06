# MCP improvement PRs

Phases 1–3 and their commerce prerequisite are merged and deployed as v0.4.4,
commit `527bf43`. Production smoke checks verified live FoV, exact-variant
Shopify inventory, quantity purchase options and public catalog reads. Deployment
remains a separate manual operation; pushing or merging a PR does not deploy the Worker.

1. **Live identity and reliability.** Route production legacy product reads to
   Shopify, require an exact full SKU for variant selection, normalize mount
   aliases, and fail closed on optical backend failures. Bounded retries apply
   only to reads. Existing optics calculations, authorization and RFQ confirmation
   remain unchanged.
2. **Current inventory and complete public specifications.** Query Shopify Admin
   on every product read. Keep website quantity and online sellable quantity
   distinct, expose unknowns as null, and parse allowlisted metafields without
   returning partial JSON as evidence. Preserve gated documents and private data.
3. **Quantity purchase options and web access.** Resolve an exact variant for the
   requested quantity. Return current base price with currency and arithmetic,
   inventory, explicit unknown commercial terms and the existing checkout/RFQ
   routes. Provide a bounded paginated GET catalog using the same live adapter.

Acceptance gates: lint, typecheck, version parity and regression tests for live
failures, SKU ambiguity, CS/C-mount separation, quantity changes between reads,
complete/malformed public fields, quote arithmetic and privacy. No test orders,
RFQs or Shopify content writes. CIL039 stays at its upstream approved 5MP; no
product data corrections are made by this stack.

Unresolved merchant facts: CIL250 weight differs between sources; there is no
verified variant-specific mapping that explains it. Family optical specs and
Shopify variant specs remain separately attributed. Quantity discount rules,
shipping dates and private B2B pricing must not be inferred from page copy.

## Completed PRs

Prerequisite [#55](https://github.com/CommonlandsAbbe/commonlands-mcp/pull/55)
reconciled main with the previously deployed commerce code. Phase 1
[#56](https://github.com/CommonlandsAbbe/commonlands-mcp/pull/56), phase 2
[#57](https://github.com/CommonlandsAbbe/commonlands-mcp/pull/57), and phase 3
[#58](https://github.com/CommonlandsAbbe/commonlands-mcp/pull/58) followed in that
order. All 179 tests passed before the authorized merge and manual deployment.
Existing uncommitted work in the primary checkout was preserved; these PRs were
built in an isolated worktree.

## Phase 4: engineering requirements

[PR #59](https://github.com/CommonlandsAbbe/commonlands-mcp/pull/59) adds a read-only
`assess_lens_requirements` tool for one optical part number and
sensor, reusing the existing live FoV path. Explicit ranges and limits produce
satisfied, failed or unknown checks. Unpublished MTF/CRA/illumination evidence,
unitless mechanical fields and display-only distortion cannot silently pass.
Keep source-data revisions null when unavailable, and label sensor fallback.
See [the contract and examples](engineering-requirements.md).

Acceptance gates: existing verification suite plus exact-part matching, upstream
failure, missing-unit/evidence, distortion-axis, boundary and privacy regressions.
This increment does not create engineering datasets or claim that the broader
phase 4 data work is complete. Approved, configuration-specific source records
are required before adding quantitative MTF/CRA/illumination checks.

## Subsequent separate PRs

5. Carry exact variants, per-line quantities and technical-selection context into
   the existing buyer-confirmed RFQ preview/submission. Add reference/status only
   with a real persistence and status source; preserve fixed-recipient and privacy controls.
6. Validate authorized Shop/Shopify handoffs and order/fulfillment status with
   supported buyer authentication and explicit transaction authorization. Read-only
   probes alone cannot demonstrate a completed payment or actual order.
