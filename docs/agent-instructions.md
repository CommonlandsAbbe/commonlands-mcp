# Commonlands MCP Agent Instructions

Use this guide as the prescriptive policy for AI agents connected to Commonlands MCP.

## Core Rule

Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute field of view on a specific sensor. Do not interpolate interior-sensor FoV from those fields. Do not run your own FoV script. Always call Commonlands MCP:

- Use `compute_fov` for one lens/sensor pair.
- Use `compute_fov_catalog` for catalog-wide lens finding on one sensor.
- Use `read_shopify_products` before stating live price, availability, product URL, Shopify Product/Variant GID, inventory signal, media, metafields, or cart payload.

There is no `find_lenses` tool in the current public surface. For "find lenses for this sensor/target FoV" requests, the closest correct path is `compute_fov_catalog`, optionally followed by `match_lenses_to_sensor`, `compare_lenses`, and `read_shopify_products`.

## Default Lens-Selection Workflow

1. Call `tools/list` and trust the live tool list over documentation.
2. If the user names a sensor or target FoV, call `compute_fov_catalog` first. Its lens records carry per-sensor HFOV/VFOV/DFOV when available, image-circle coverage class, and provenance/source metadata.
3. If the user names one SKU and one sensor, call `compute_fov`.
4. Use `search_lenses` or `search_catalog` only for broad SKU/title/mount discovery, not for sensor-specific FoV.
5. Use `match_lenses_to_sensor`, `compare_lenses`, or `recommend_lenses_for_application` as shortlist/explanation helpers. Treat them as fixture-backed context unless the returned payload says otherwise.
6. Before recommending a purchasable product, call `read_shopify_products` for live commerce truth.
7. Only call `create_cart` or `update_cart` after the buyer explicitly confirms live Variant GIDs and quantities.

## What To Trust

- `read_shopify_products`: live Shopify product truth for product/variant IDs, SKU, price, inventory signal, URL, media, and selected metafields.
- `compute_fov` and `compute_fov_catalog`: authoritative Commonlands MCP path for sensor-specific FoV. In production they use the authenticated Lambda/DynamoDB FoV backend when configured; otherwise they return fixture/fail-closed behavior with warnings.
- `search_lenses`, `search_catalog`, `get_lens_details`, `get_product`, `get_product_page_details`, `match_lenses_to_sensor`, `compare_lenses`, and `recommend_lenses_for_application`: useful context and shortlist helpers, not live product truth.

If fixture context conflicts with `read_shopify_products`, use Shopify truth for commerce facts. If a FoV tool fails closed, report the unsupported SKU/sensor pair instead of substituting a hand calculation.

## FoV Output Handling

When using `compute_fov_catalog`, prefer returned fields over derived values:

- `hfov`, `vfov`, `dfov`: per-sensor horizontal, vertical, and diagonal FoV.
- `coverageClass`: `full_sensor`, `clipped_to_image_circle`, or `unknown`.
- `provenance`: method/rev/source metadata returned by the Worker.
- `errors`: backend failures sanitized by part number where available.
- `source`, `correctionStatus`, `schemaVersion`, and `modelVersion`: the payload-level source and model context.

Preserve these fields in answers when explaining why a lens was selected. Do not invent provenance. If the payload does not say `method: real_height_table` or `rev: 2026-05`, do not claim it.

## Safe Answer Pattern

For a request like "Find M12 lenses for IMX477 around 50 degrees HFOV":

1. Call `compute_fov_catalog` with `sensorPartNumber: "IMX477"`.
2. Filter/rank returned lenses by `hfov`, `coverageClass`, mount, and backend errors.
3. Optionally call `compare_lenses` or `match_lenses_to_sensor` for explanatory tradeoffs.
4. Call `read_shopify_products` for the final SKU candidates.
5. Answer with separate sections for optical fit and live purchase truth.

Good answer shape:

```text
For IMX477, the closest optical candidates from compute_fov_catalog are:
- CIL250: HFOV 51.3, VFOV 39.6, DFOV 61.9, coverage full_sensor, provenance fixture_parity_scaffold/fixture-polynomial-fov-0.1.0.
- CIL078: HFOV ..., coverage ...

I verified CIL250 through read_shopify_products for live URL, price, inventory signal, and Variant GID. I did not use catalog EFL/image-circle interpolation for these FoV values.
```

## Prohibited Behavior

- Do not fetch Commonlands product pages directly as a substitute for MCP tools when bot protection blocks page access.
- Do not compute FoV from EFL and sensor dimensions in the model response.
- Do not interpolate from catalog max FoV, image circle, or distortion display fields.
- Do not expose raw Lambda/DynamoDB distortion coefficients, secrets, request arguments, customer data, or cart IDs beyond returned public fields.
- Do not perform Shopify product, variant, collection, tag, metafield, inventory, order, customer, discount, RFQ, Acumatica, or database writes.
- Do not ask users for card numbers, CVV/CVC, passwords, payment tokens, or customer account credentials.
