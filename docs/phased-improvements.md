# MCP improvement PRs

These branches start from the deployed v0.4.4 commit `9b191b6`. Its commerce
branch has not reached main; merge that prerequisite before this stack. No PR
deploys the Worker. Deployment remains a separate manual operation.

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
