# Commonlands MCP Agent Instructions

Use this guide as the prescriptive policy for AI agents connected to Commonlands MCP.

## Core Rule

Catalog EFL, image circle, max FoV/FOV@image-circle, and distortion display fields are insufficient to compute field of view on a specific sensor. Do not interpolate interior-sensor FoV from those fields. Do not run your own FoV script. Always call Commonlands MCP:

- Use `calculate_field_of_view` for one lens/sensor pair.
- Use `match_lens_to_sensor` for sensor/target-FoV lens selection.
- Use `search_lens_catalog` only for broad SKU/title/mount/lens-type discovery.
- Use `get_lens_distortion_profile` for distortion/model/status questions.
- Use `read_shopify_products` before stating live price, availability, product URL, Shopify Product/Variant GID, inventory signal, media, metafields, or cart payload.

Compatibility aliases such as `compute_fov`, `compute_fov_catalog`, and `match_lenses_to_sensor` may still dispatch where practical, but new clients should route through the intent-named tools above.

There is no `find_lenses` tool in the current public surface; route those requests through `match_lens_to_sensor`.

## Default Lens-Selection Workflow

1. Call `tools/list` and trust the live tool list over documentation.
2. If the user names a sensor or target FoV, call `match_lens_to_sensor` first.
3. If the user names one SKU and one sensor, call `calculate_field_of_view`.
4. For final candidate lens/sensor claims, call `calculate_field_of_view` and preserve the returned `hfov_deg`, `vfov_deg`, `dfov_deg`, `method`, `distortion_model`, `coverage_ok`, `image_circle_mm`, `sensor_diagonal_mm`, and `rectilinear_comparison`.
5. Ground the request with `resources/read` for `commonlands://sensors/{part}` or `commonlands://lenses/{sku}` when the client supports resources. Lowercase sensor URIs such as `commonlands://sensors/ar0234` are accepted.
6. Use `prompts/list` / `prompts/get` with `select_lens_for_sensor_fov_working_distance` when a client surfaces MCP prompts.
7. Before recommending a purchasable product, call `read_shopify_products` for live commerce truth.
8. Only call `create_cart` or `update_cart` after the buyer explicitly confirms live Variant GIDs and quantities.

## What To Trust

- `read_shopify_products`: live Shopify product truth for product/variant IDs, SKU, price, inventory signal, URL, media, and selected metafields.
- `calculate_field_of_view` and `match_lens_to_sensor`: authoritative Commonlands MCP path for sensor-specific FoV. In production they use the authenticated Lambda/DynamoDB FoV backend when configured.
- `commonlands://sensors/{part}`: per-sensor MCP resource with active area, pixel pitch, resolution, and FoV input metadata.
- `commonlands://lenses/{sku}`: per-lens MCP resource with fixture or live catalog optical fields. Live resources can include catalog lenses such as `commonlands://lenses/CIL061`.
- `search_lens_catalog`, `search_catalog`, `get_lens_details`, `get_product`, `get_product_page_details`, `compare_lenses`, and `recommend_lenses_for_application`: useful context and shortlist helpers, not live product truth.

If fixture context conflicts with `read_shopify_products`, use Shopify truth for commerce facts. If a FoV tool fails closed, report the actionable error and retry path instead of substituting a hand calculation.

## Error Handling

Tool errors are part of the contract. If a response names a missing parameter, invalid sensor, auth failure, timeout, or upstream 5xx, show that actionable failure to the user or retry the same MCP path after the issue is fixed. Do not fall back to focal-length-only math after a silent auth, timeout, or 500-style backend failure.

Calculator tools have a p95 latency target of 1500 ms. If latency is consistently above target, measure with `npm run eval:routing` and inspect MCP telemetry before changing routing descriptions.

## FoV Output Handling

Prefer returned fields over derived values:

- `hfov_deg`, `vfov_deg`, `dfov_deg`: sensor-specific horizontal, vertical, and diagonal FoV from `calculate_field_of_view`.
- `rectilinear_comparison`: focal-length-only reference and delta, supplied only to prove why MCP data matters.
- `method`, `distortion_model`, `distortion_status`, `commonlands_data`, and `details.provenance`: source/method metadata returned by the Worker.
- `coverage_ok`, `image_circle_mm`, and `sensor_diagonal_mm`: coverage and geometry metadata.
- `errors`: sanitized backend failures where available.

Preserve these fields in answers when explaining why a lens was selected. Do not invent provenance. Do not claim measured polynomial correction when the payload says source-display-only.

## Safe Answer Pattern

For a request like "Find M12 lenses for IMX477 around 50 degrees HFOV":

1. Call `match_lens_to_sensor` with `sensor: "IMX477"` and `desired_horizontal_fov_deg: 50`.
2. Call `calculate_field_of_view` for final SKU candidates.
3. Optionally call `get_lens_distortion_profile` for distortion status.
4. Call `read_shopify_products` for the final SKU candidates.
5. Answer with separate sections for optical fit and live purchase truth.

Good answer shape:

```text
For IMX477, the closest optical candidates from match_lens_to_sensor are:
- CIL250: HFOV ..., VFOV ..., DFOV ..., coverage ..., source ...
- CIL078: HFOV ..., coverage ...

I verified the final SKU through read_shopify_products for live URL, price, inventory signal, and Variant GID. I did not use catalog EFL/image-circle interpolation for these FoV values.
```

## Routing Regression Check

Run canonical routing evals after changing tool names, descriptions, schemas, resources, prompts, or backend error behavior:

```bash
npm run eval:routing
ENFORCE_LATENCY_TARGET=true npm run eval:routing
```

The eval checks that canonical prompts such as "find me a 60 degree lens on the AR0234" and "HFOV of CIL061 on AR0234" call the intended MCP tools, not just that the resulting answer could be correct.

## Prohibited Behavior

- Do not fetch Commonlands product pages directly as a substitute for MCP tools when bot protection blocks page access.
- Do not compute FoV from EFL and sensor dimensions in the model response.
- Do not interpolate from catalog max FoV, image circle, or distortion display fields.
- Do not hide MCP auth, timeout, or 5xx failures behind a naive fallback answer.
- Do not expose raw Lambda/DynamoDB distortion coefficients, secrets, request arguments, customer data, or cart IDs beyond returned public fields.
- Do not perform Shopify product, variant, collection, tag, metafield, inventory, order, customer, discount, RFQ, Acumatica, or database writes.
- Do not ask users for card numbers, CVV/CVC, passwords, payment tokens, or customer account credentials.
