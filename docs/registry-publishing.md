# Publishing to the official MCP Registry

This server is listed in the official [Model Context Protocol registry](https://registry.modelcontextprotocol.io/)
so that MCP-capable agents and tools can discover it. The metadata lives in
[`server.json`](../server.json) at the repo root.

Publishing to the official registry is the highest-leverage listing: several
third-party directories (PulseMCP, etc.) auto-ingest from it, so one publish
propagates widely. We use the **DNS-verified `com.commonlands` namespace** rather
than a GitHub namespace, because the branded name is better for discovery (SEO/GEO).

## SEO / GEO notes

The registry only indexes `name`, `title`, and `description` for search, and the
registry caps `title` and `description` at **100 characters each**. `server.json`
is therefore written to pack the priority keywords into those fields:

- **name:** `com.commonlands/optics-mcp`
- **title:** Commonlands Optics: M12 Lens and C-Mount Lens Finder + Field-of-View Calculator
- **description:** M12 lens and C-mount lens finder with image-sensor matching and field-of-view calculator.
- **websiteUrl:** points at the GEO-optimized agentic page, which carries the
  long-tail keywords (depth-of-field calculator, effective focal length, sensor
  reference, etc.) that don't fit the 100-char limit.

The richer keyword surface for agents that actually **connect** is the server's
own `instructions` (returned on `initialize`) and the per-tool descriptions —
keep those keyword-aware when editing `src/index.ts`.

## Prerequisites

- The [`mcp-publisher`](https://github.com/modelcontextprotocol/registry) CLI.
  - **Windows (PowerShell):** download the latest release binary, e.g.
    ```powershell
    Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz" -OutFile "mcp-publisher.tar.gz"
    tar xf mcp-publisher.tar.gz mcp-publisher.exe
    ```
    then put `mcp-publisher.exe` somewhere on your `PATH`.
  - **macOS:** `brew install mcp-publisher`.
  - **From source:** `git clone https://github.com/modelcontextprotocol/registry && cd registry && make publisher` (needs Go 1.24+).
- OpenSSL 3 (required for Ed25519). On Windows, Git Bash already ships OpenSSL 3 —
  run the keypair commands below in Git Bash. macOS ships LibreSSL, so install
  OpenSSL 3 via Homebrew first.
- Access to Commonlands DNS (to add a TXT record at the `commonlands.com` apex).

## One-time: DNS verification for the `com.commonlands` namespace

The registry proves you control `commonlands.com` via a TXT record containing the
**public** half of an Ed25519 keypair. Generate the keypair on a trusted machine
and keep `registry-key.pem` secret (treat it like any private key — never commit it).

```bash
# 1. Generate the keypair (keep registry-key.pem PRIVATE — do not commit)
openssl genpkey -algorithm Ed25519 -out registry-key.pem

# 2. Derive the public key for the TXT record
PUBLIC_KEY="$(openssl pkey -in registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "v=MCPv1; k=ed25519; p=${PUBLIC_KEY}"
```

Add the printed string as a **TXT record on the apex domain** `commonlands.com`
(host `@`), value:

```
v=MCPv1; k=ed25519; p=<PUBLIC_KEY from step 2>
```

Notes:
- It must be the **apex** (`commonlands.com`), not a subdomain or selector.
- Remove any stale `v=MCPv1` TXT records first, or verification can fail.
- Wait for propagation (usually minutes) before logging in.

## Authenticate and publish

```bash
# Log in using the private key (extracted from the PEM)
PRIVATE_KEY="$(openssl pkey -in registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain commonlands.com --private-key "${PRIVATE_KEY}"

# Publish (reads ./server.json)
mcp-publisher publish
```

## Updating the listing later

1. Bump `version` in `server.json` to match the deployed server
   (`SERVER_INFO.version` / `package.json`, surfaced at `/healthz`).
2. Re-run `mcp-publisher login dns ...` if the session expired.
3. `mcp-publisher publish` again.

Keep `server.json`'s `version` and the live `/healthz` `version` in sync so the
registry's continuous health checks don't flag drift.
