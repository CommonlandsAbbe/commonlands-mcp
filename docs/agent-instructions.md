# Commonlands MCP Agent Instructions

> Commerce update (v0.4.3): cart create/read/update/cancel and checkout create/read use Shopify UCP. Retain owner tokens; customers review and pay on Shopify. The [current commerce guide](commerce.md) supersedes older endpoint, payload, and hidden-checkout examples below. Live `tools/list` remains authoritative.

Use this guide as the prescriptive policy for AI agents connected to Commonlands MCP.

## Core Rule

Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute field of view on a specific sensor. Do not interpolate interior-sensor FoV from those fields. Do not run your own FoV script. Always call Commonlands MCP:

- Use `calculate_field_of_view` for one lens/sensor pair.
- Use `match_lens_to_sensor` for catalog-wide lens finding on one sensor.
- Use `read_shopify_products` before stating live price, availability, product URL, Shopify Product/Variant GID, inventory signal, media, metafields, or cart payload.

There is no `find_lenses` tool in the current public surface. For "find lenses for this sensor/target FoV" requests, the closest correct path is `match_lens_to_sensor`, optionally followed by `match_lens_to_sensor`, `compare_lenses`, and `read_shopify_products`.

## Default Lens-Selection Workflow

1. Identify the sensor model or active dimensions, resolution and pixel pitch.
2. Establish the required horizontal FoV and working distance. Discover the current tools with `tools/list`.
3. Use `match_lens_to_sensor` to find candidates, then `calculate_field_of_view` for final lens/sensor FoV and distortion. Preserve source, method and status.
4. Use `resolve_lens_product` to map the chosen family to current published Shopify variants. Select the full SKU explicitly.
5. Use `get_purchase_options` with that full SKU and requested quantity. Use `read_shopify_products` with metafields enabled for complete public specifications.
6. A base-price multiplication is an estimate. Do not invent quantity tiers, shipping, tax, lead time or quote expiry. Unknown means unknown.
7. Only create a cart or submit an RFQ after the buyer confirms the exact variant and quantity. Existing owner credentials remain mandatory for cart and checkout reads.

## What To Trust

Lambda/DynamoDB owns optical results; Shopify owns current commerce and variant
facts. Production optical failures return errors without substituting fixtures.
Legacy product aliases resolve live Shopify data, and old fixture handoffs are
retired. Sensor reference fallback remains labeled. Do not resolve conflicting
family/variant specifications by guessing. CIL039 remains at its approved 5MP.

See [quantity and shipping semantics](purchase-options.md) and
[complete typed specifications](inventory-availability.md). An official Shopify
Shop MCP connection is separate from Commonlands MCP and browser WebMCP; use the
existing authenticated buyer handoff described in [commerce](commerce.md).

## FoV Output Handling

When using `match_lens_to_sensor`, prefer returned fields over derived values:

- `hfov`, `vfov`, `dfov`: per-sensor horizontal, vertical, and diagonal FoV.
- `fov`: canonical per-axis FoV object with horizontal, vertical, and diagonal degree fields.
- `coverageClass`: `full`, `inscribed`, `cropped`, or `unknown`.
- `coverage.pixelCounts`: sensor, covered, and cropped pixel counts when the Worker can compute them.
- `distortionAtFieldEdge`: field-edge distortion status/value/display summary.
- `provenance`: method/rev/source metadata returned by the Worker.
- `errors`: backend failures sanitized by part number where available.
- `source`, `correctionStatus`, `schemaVersion`, and `modelVersion`: the payload-level source and model context.

Preserve these fields in answers when explaining why a lens was selected. Do not invent provenance. If the payload does not say `method: real_height_table` or `rev: 2026-05`, do not claim it.

## Safe Answer Pattern

For a request like "Find M12 lenses for IMX477 around 50 degrees HFOV":

1. Call `match_lens_to_sensor` with `sensorPartNumber: "IMX477"`.
2. Filter/rank returned lenses by `hfov`, `coverageClass`, `coverage.pixelCounts`, mount, and backend errors.
3. Optionally call `compare_lenses` or `match_lens_to_sensor` for explanatory tradeoffs.
4. Call `read_shopify_products` for the final SKU candidates.
5. Answer with separate sections for optical fit and live purchase truth.

Good answer shape:

```text
For your selected sensor, these are the closest candidates returned by
match_lens_to_sensor. I checked each final sensor/lens pair using
calculate_field_of_view and retained its returned distortion status.

I resolved the selected family to a full Shopify SKU and checked the requested
quantity with get_purchase_options. Base price, online stock, backorder policy
and any missing commercial terms are reported separately.
```

## Prohibited Behavior

- Do not fetch Commonlands product pages directly as a substitute for MCP tools when bot protection blocks page access.
- Do not compute FoV from EFL and sensor dimensions in the model response.
- Do not interpolate from catalog max FoV, image circle, or distortion display fields.
- Do not expose raw Lambda/DynamoDB distortion coefficients, secrets, request arguments, customer data, or cart IDs beyond returned public fields.
- Do not perform Shopify product, variant, collection, tag, metafield, inventory, order, customer, discount, Acumatica, or database writes. Submit an RFQ only through the existing buyer-confirmed `submit_rfq` tool.
- Do not ask users for card numbers, CVV/CVC, passwords, payment tokens, or customer account credentials.
