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

**Technical readiness (already met):**
- All 22 tools include `title` + `readOnlyHint`/`destructiveHint` annotations ✅
- Read and write actions are separate tools ✅
- Public endpoint, **no authentication** → reviewers connect instantly ✅
- Privacy policy exists ✅

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
- **Data scope:** Both (read + buyer-confirmed cart write). No payment, orders, customer records, or inventory writes.
- **User prerequisites:** None — public endpoint, no account or API key.
- **Test credentials:** None required. Reviewers connect to `https://mcp.commonlands.com/mcp` and call `tools/list` (22 tools). Sample call: `match_lenses_to_sensor` with `{ "sensorPartNumber": "IMX477", "desiredHorizontalFovDeg": 70 }`.

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
