# Data Audit Plan

The Worker does not yet connect to AWS, Shopify, Acumatica, or a database. Phase 1/2/3/4/5/6/7 catalog, FoV, recommendation, product-page detail, snapshot-status, Shopify/UCP-readiness, UCP alias, and purchase-handoff behavior is fixture-backed until the real data contracts below are confirmed.

## Confirmed from planning/discovery

- Legacy calculator uses a DynamoDB/AppSync lens data source.
- Known local Amplify names: AppSync API `lenslist`, DynamoDB storage base `dynamoLensList`, region `us-west-2`.
- Local `src/aws-exports.js` was missing in the legacy app, so deployed endpoint/API key are not available from local source.
- Legacy FoV calculation uses `alpha`, `beta`, `efl`, `image_circle`, and `max_fov`. Phase 2 only preserves the contract-level pattern until coefficient convention/sign/units are confirmed.
- Shopify mapping sheet fields identified during planning:
  - product handle / slug
  - short part number
  - mechanical drawing URL
- Mechanical drawing links inspected in the planning sample were Shopify CDN links; DocSend links are separate and must remain gated.

## Required real-data audit before replacing fixtures

Capture 5-10 sanitized lens records and document:

- Canonical table/API name and environment.
- Primary key and SKU/short-part-number field.
- Lens optical fields: EFL, image circle, projection model, distortion coefficients, coefficient convention/sign/units, max FoV, F-number, mount.
- Sensor fields needed for parity fixtures: active area, resolution, pixel size, and any calculator-specific clipping behavior.
- Lens resolution is expected to come from the DynamoDB/AppSync optical catalog (`LensList.resolution` in the legacy schema), not Shopify enrichment; connector work must preserve that provenance in responses.
- Recommendation fields: stock confidence, mount/form-factor suitability, MTF/resolution/CRA if reliable, distortion flags, application categories, and any fields that should influence ranking or be explicitly excluded.
- Shopify join key and collision/missing-record behavior.
- Mechanical drawing field format: public URL vs file reference.
- Any fields that are private, gated, deprecated, or unsafe to expose.

## Fixture rules

- Fixtures must contain no credentials, signed URLs, internal tokens, private customer data, or direct DocSend URLs.
- Prefer minimal sanitized JSON records that preserve shape and numeric optics fields.
- Document fixture provenance and date captured.

## Open questions

1. Is the canonical data path deployed AppSync, direct DynamoDB, or a newer table/API?
2. What are the exact production/staging table names and schemas?
3. Which Cloudflare environment owns `mcp.commonlands.com`?
4. Should the launch endpoint support `/sse` for legacy clients, or only Streamable HTTP at `/mcp`?


## Joined snapshot audit requirements

Before replacing Phase 5 fixture snapshot status with a connector-backed cache, confirm:

- Snapshot storage target: Cloudflare KV, R2, Durable Object, or another cache layer.
- Snapshot schema versioning and backward-compatibility policy for MCP responses.
- Refresh trigger: scheduled only, protected manual endpoint, deployment-time build, or a combination.
- Missing-join semantics for optical-only, commerce-only, retired, and duplicate SKU records.
- Maximum acceptable stale age and how stale data should be represented to public MCP callers.
- Validation failure behavior: keep last known good snapshot, serve partial results with warnings, or fail closed.

## Product detail audit requirements

Before replacing Phase 4 fixtures with connector-backed data, confirm:

- DynamoDB/AppSync lens `resolution` field format and allowed values (for example `5MP`, numeric megapixel strings, or newer structured values).
- Whether public product price/availability should be fixture, Shopify read-only, hidden, or quantity-banded.
- Exact Shopify metafield/file-reference source for mechanical drawings and whether every exposed URL can be validated as public and non-gated.
- How missing Shopify handles, missing drawings, retired products, or SKU collisions should be represented.

## Recommendation audit requirements

Before replacing Phase 3 fixture ranking with production ranking, confirm:

- Whether stock should be binary in-stock/out-of-stock, quantity bands, or hidden entirely for public MCP callers.
- Whether MTF, CRA, distortion, and resolution values are complete enough for ranking or should remain informational only.
- Which application categories Commonlands wants to expose publicly (embedded robotics, machine vision inspection, Raspberry Pi/student, harsh environment, etc.).
- Whether price should influence ranking or stay out of engineering recommendations.
- What launch tolerance is acceptable for “recommended” vs. “conditional” candidates.


## Shopify Storefront MCP / UCP compatibility audit requirements

Phase 7 exposes fixture-backed aliases only. Before replacing them with live Shopify-backed behavior or claiming production UCP compliance, confirm:

- Stable Shopify product and variant identifiers to return in UCP-shaped `id` fields.
- Whether Commonlands should expose UCP aliases directly or keep Commonlands-native tools plus compatibility metadata.
- Price and availability freshness rules, including whether public MCP responses can show current price/stock or should use product-page handoff only.
- Country/language/currency behavior for UCP `context` hints.
- Category, tag, option, media, and seller fields required for launch clients.
- Unknown-SKU lookup semantics: UCP-style success with `not_found` messages vs. JSON-RPC tool errors for Commonlands-native tools.
- Whether the fixture `/.well-known/ucp` profile shape is sufficient for target clients, or whether a separate UCP catalog endpoint is required in addition to `/mcp`.
- Whether legacy `/sse` support is required, or Streamable HTTP at `/mcp` is sufficient.

Cart, checkout, customer-account, order, and return tools require separate approval, OAuth/protected-customer-data review where relevant, and a write-safety design. They are intentionally absent from the public read-only MVP.


## Independence and Shopify integration notes

Commonlands MCP is built from Commonlands-owned catalog, optics, and commerce contracts. Public MVP responses must remain provenance-rich, validated, deterministic, and safe for AI clients.

Commonlands should win by returning structured optical/spec responses instead of raw text, preserving source provenance on every optical/commerce field, exposing resources as well as tools, adding deterministic tests, and making the future transaction path Shopify-native instead of custom order/RFQ links. Live cart/checkout/customer/order behavior still requires explicit approval and separate write-safety design.
