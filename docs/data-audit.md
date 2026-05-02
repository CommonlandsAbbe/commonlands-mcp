# Data Audit Plan

Phase 0 does not connect to AWS, Shopify, Acumatica, or a database. This document records what must be confirmed before Phase 1 uses real data.

## Confirmed from planning/discovery

- Legacy calculator uses a DynamoDB/AppSync lens data source.
- Known local Amplify names: AppSync API `lenslist`, DynamoDB storage base `dynamoLensList`, region `us-west-2`.
- Local `src/aws-exports.js` was missing in the legacy app, so deployed endpoint/API key are not available from local source.
- Legacy FoV calculation uses `alpha`, `beta`, `efl`, `image_circle`, and `max_fov`.
- Shopify mapping sheet fields identified during planning:
  - product handle / slug
  - short part number
  - mechanical drawing URL
- Mechanical drawing links inspected in the planning sample were Shopify CDN links; DocSend links are separate and must remain gated.

## Required real-data audit before Phase 1

Capture 5-10 sanitized lens records and document:

- Canonical table/API name and environment.
- Primary key and SKU/short-part-number field.
- Lens optical fields: EFL, image circle, projection model, distortion coefficients, max FoV, F-number, mount.
- Sensor fields needed for parity fixtures.
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
