# MCP directory submissions

Where this server is (or should be) listed so agents can discover it, plus the
exact submission package for each. The official MCP registry is already done
(see [`registry-publishing.md`](./registry-publishing.md)); PulseMCP and other
subregistries auto-ingest from it.

Status:

| Directory | Method | Status |
|---|---|---|
| Official MCP registry | `mcp-publisher publish` | ✅ published (`com.commonlands/optics-mcp`) |
| PulseMCP | auto-ingests from official registry | ⏳ propagates automatically |
| Anthropic Connectors Directory | claude.ai admin portal | ☐ package below |
| mcp.so | submit form | ☐ steps below |
| Smithery | publisher account + manifest | ☐ steps below |
| Glama | `glama.json` + claim flow | ☐ file added, claim below |

---

## 1. Anthropic Connectors Directory (highest value — Claude users)

**Portal:** https://claude.ai/admin-settings/directory/submissions/new

**Prerequisite (important):** submission requires a **Claude Team or Enterprise**
organization and **Owner / directory-management** access — individual plans
cannot submit. Confirm the org plan before starting.

**Technical readiness (already met, v0.2.0):**
- All 20 tools include `title` + `readOnlyHint`/`destructiveHint` annotations ✅
- Read and write actions are separate tools ✅
- Public endpoint, **no authentication** → reviewers connect instantly ✅
- Privacy policy exists ✅
- Public-data-only Shopify reads (Anthropic review): active products, coarse availability, allowlisted `custom.*` metafields off by default; `read_shopify_metaobjects` removed ✅
- Cart abuse controls: per-IP rate limits (120 req/min, 10 cart mutations/min) ✅

### Field-by-field package (copy/paste)

- **Server connection:** URL `https://mcp.commonlands.com/mcp` · transport **Streamable HTTP** · auth **None**
- **Name (≤100):** `Commonlands Optics: M12 Lens and C-Mount Lens Finder + Field-of-View Calculator`
- **Tagline (≤55):** `M12 and C-mount lens finder with FOV calculator`
- **URL slug:** `commonlands-optics`
- **Categories (1–5):** Developer Tools; Data & Analytics; Shopping/Commerce *(pick the closest the form offers)*
- **Documentation URL:** `https://commonlands.com/pages/agentic-mcp-for-m12-lenses-and-optics`
- **Privacy policy URL:** `https://commonlands.com/policies/privacy-policy`
- **Support contact:** `support@commonlands.com` *(confirm the real inbox before submitting)*
- **Company:** Commonlands LLC · `https://commonlands.com` · review contact: Max Henkart
- **Data scope:** Both (read + buyer-confirmed cart write). Reads are **public data only** (active products, coarse availability, allowlisted public product-page metafields off by default). No payment, orders, customer records, or inventory writes.
- **User prerequisites:** None — public endpoint, no account or API key.
- **Test credentials:** None required. Reviewers connect to `https://mcp.commonlands.com/mcp` and call `tools/list` (20 tools). Sample call: `match_lens_to_sensor` with `{ "sensorPartNumber": "IMX477", "desiredHorizontalFovDeg": 70 }`.

**Description (≤2000):**

> Commonlands Optics MCP lets an AI assistant select precision optics instead of
> guessing. It searches Commonlands M12 (S-mount) lenses and C-mount lenses,
> matches them to image sensors by active-area and image-circle coverage, and
> computes field of view, angular resolution, and distortion with Commonlands'
> own optical models — not a thin-lens approximation that breaks on wide-angle
> and fisheye lenses.
>
> Built for machine vision, robotics, embedded vision, and camera engineering, it
> covers lens search and lookup, image-sensor matching, field-of-view and
> effective-focal-length calculation, lens comparison, and application-based
> recommendations. It can read live product truth (price, availability, variant
> IDs) before quoting, and supports safe, buyer-confirmed cart handoff to the
> Commonlands storefront.
>
> Safety boundaries are explicit: every tool result is source-labeled (fixture,
> calculator, live read, or cart), read and write actions are separate tools, and
> the server never completes checkout, takes payment, creates orders or customer
> records, applies discounts, or writes inventory. The public endpoint requires no
> API key.
>
> Example prompts: "Find an M12 lens for an IMX477 sensor at 70° horizontal field
> of view," or "Compare C-mount lenses for a low-distortion inspection camera."

**Policy acknowledgments (7):** read each; the **financial-transactions** one is
fine — the server only creates buyer-confirmed cart handoff state and never
completes payment. **Prompt-injection** — the server uses fixed allowlisted
endpoints and rejects client-supplied downstream tokens.

**Assets to provide:** an icon/logo (Commonlands mark, square PNG).

Review status appears in the submissions dashboard; escalate to
`mcp-review@anthropic.com`. Timeline varies (≈2 weeks–months).

### Reviewer test-access / autonomous verification (v0.2.0)

Authoritative copy of the test-access instructions submitted to Anthropic.
Everything below is unauthenticated; the 20-tool surface is identical for every
caller. Header used: `-H "content-type: application/json" -H "accept: application/json, text/event-stream"`.

```
CREDENTIALS: None required. Public, unauthenticated, stateless remote MCP server.
No account, login, API key, OAuth, or paid plan. The catalog is pre-populated and
identical for every caller, so the "fully populated account" requirement is met by
default.

ENDPOINT
- MCP endpoint (Streamable HTTP, JSON-RPC 2.0 over POST): https://mcp.commonlands.com/mcp  (GET returns 405; use POST.)
- Health: https://mcp.commonlands.com/healthz
- Discovery: https://mcp.commonlands.com/.well-known/ucp
- Docs: https://commonlands.com/pages/agentic-mcp-for-m12-lenses-and-optics
- Agent docs: https://commonlands.com/llms.txt and https://commonlands.com/agents.md
- Source: https://github.com/CommonlandsAbbe/commonlands-mcp

CONNECT IN CLAUDE
Settings > Connectors > Add custom connector > URL https://mcp.commonlands.com/mcp > no authentication. 20 tools should appear.

VERIFICATION (all unauthenticated)
1) Health:            curl -s https://mcp.commonlands.com/healthz  -> version 0.2.0
2) Initialize:        POST method:initialize protocolVersion 2025-11-25
3) List tools:        POST method:tools/list  -> expect 20
4) Sensor spec:       tools/call get_sensor_specs {"partNumber":"IMX477"}  -> activeAreaMm 6.287 x 4.712, pitch 1.55 um
5) Find lenses:       tools/call match_lens_to_sensor {"sensorPartNumber":"IMX477","desiredHorizontalFovDeg":70,"maxResults":3}
6) Field of view:     tools/call calculate_field_of_view {"lensSku":"CIL250","sensorPartNumber":"IMX477"}  -> HFOV ~14 deg
7) Live product read: tools/call read_shopify_products {"sku":"CIL250","limit":1}  -> ProductVariant GID; public data only (active products, coarse availability, metafields off by default)
8) (Optional, safe write) tools/call create_cart {"cart":{"line_items":[{"quantity":1,"item":{"id":"gid://shopify/ProductVariant/41702699729014"}}]}}  -> transient cart id + continue_url; no charge/order/customer.

KNOWN-GOOD TEST DATA
- Sensors: IMX477, IMX219, AR0234 (get_sensor_specs also covers many more via the live table)
- Lens SKUs: CIL250 (25mm M12 telephoto), CIL078 (wide-angle M12), CIL121 (M12)

ABUSE CONTROLS & DATA SCOPE
- Public data only: read_shopify_products returns active products, coarse availability (no exact counts), allowlisted custom.* metafields off by default. read_shopify_metaobjects is not exposed.
- Per-IP rate limits: 120 requests/min endpoint-wide, 10 cart mutations/min (HTTP 429 + retry-after).
- Writes limited to transient Shopify-owned cart handoff; no payment, orders, customers, discounts, or inventory writes. Checkout/cancel not exposed.
```

---

## 2. mcp.so

**Submit:** https://mcp.so/submit

- **Name:** Commonlands Optics MCP
- **One-sentence description:** M12 lens and C-mount lens finder with image-sensor matching and a field-of-view calculator for machine vision and robotics.
- **Tool count:** 22
- **Transport:** Streamable HTTP
- **Repository URL:** `https://github.com/CommonlandsAbbe/commonlands-mcp`
- **Homepage URL:** `https://commonlands.com/pages/agentic-mcp-for-m12-lenses-and-optics`
- **Icon:** Commonlands logo (optional)

---

## 3. Smithery

**Submit:** https://smithery.ai (create a publisher account, then "Add server").

- Provide a manifest: name, description (reuse the above), **auth: none**,
  server URL `https://mcp.commonlands.com/mcp` (Streamable HTTP — Smithery
  supports remote servers).
- No API key/bearer token, so no auth prompt is surfaced at install.

---

## 4. Glama

Glama auto-crawls the GitHub repo; to **claim ownership** and control the
listing, this repo includes [`glama.json`](../glama.json) with the maintainer
GitHub handle. After it's merged:

1. Go to the server's page at `https://glama.ai/mcp/servers` (search "commonlands").
2. Run the **Claim ownership** flow; Glama reads `glama.json` and verifies the
   `maintainers` handle (`mhenkart`) against repo access.

> Note: GitHub-auth claiming doesn't work for org-hosted repos, so the
> `glama.json` file is the required path here.
