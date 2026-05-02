# Optics model

Phase 2 adds the public MCP contract for FoV calculation while live AppSync/DynamoDB coefficients are still pending.

## Current model status

- `compute_fov` is fixture-backed parity scaffolding, not final optical truth.
- The tool uses the confirmed legacy calculator pattern: clip sensor dimensions by image circle, compute field of view from effective focal length, cap by lens `max_fov`, and report angular resolution as pixels per degree.
- Every result includes `correctionStatus: "fixture_parity_scaffold"`, model version, assumptions, and warnings so callers cannot mistake fixture math for production-calibrated optics.

## Safety boundaries

- No live AppSync/DynamoDB reads.
- No Shopify API calls.
- No secrets.
- No writes, checkout, cart mutation, or inventory mutation.
- No direct DocSend URLs.

## Replacement gate

Before customer-facing launch, replace fixture coefficients with the production projection-polynomial convention and parity fixtures from the existing calculator or current optical source of truth. Required confirmations:

1. coefficient names, order, sign, units, and normalization;
2. projection enum values;
3. deployed lens schema fields for `alpha`, `beta`, `efl`, `image_circle`, and `max_fov` or their replacements;
4. launch tolerances for HFOV/VFOV/DFOV, scene size, and angular resolution.
