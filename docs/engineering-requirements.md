# Check a lens against your requirements

Start with the image sensor: its model, active dimensions, resolution and pixel
pitch. Establish the required field of view, then use `match_lens_to_sensor` to
find candidates. For a shortlisted optical part number, use
`assess_lens_requirements` to see which requested checks pass, fail or still need
engineering confirmation.

This tool is included in the phase 4 source changes. Check the connected server's
`tools/list` before using it; merging a PR does not deploy the Worker.

Example tool arguments:

```json
{
  "lens_sku": "CIL353",
  "sensor": "IMX477",
  "requirements": {
    "horizontal_fov_deg": { "min": 68, "max": 74 },
    "full_sensor_coverage": true,
    "mount": "M12",
    "distortion": { "axis": "horizontal", "max_absolute_percent": 3 },
    "max_weight_g": 10,
    "require_evidence": ["mtf", "cra", "mechanical_fit"]
  }
}
```

Use the actual requirements from the engineer. The example's limits are not a
Commonlands recommendation or a claim that CIL353 meets them. Alternatively,
replace `sensor` with either `widthPx`, `heightPx` and `pixelSizeUm`, or
`sensorWidthMm` and `sensorHeightMm`. Supply one sensor description, not several.
The report identifies the sensor source and active dimensions used. Named
sensors retain the existing live-table lookup and labeled reference fallback.
Custom inputs remain caller-supplied dimensions, not independently verified specs.

## Read the result

Each requested check has `status: satisfied`, `failed` or `unknown`, the requested
limit, the observed value, its unit, source and explanation. An unknown observed
value is `null` and has an entry in `missingData`. Unrequested checks are omitted;
their omission does not mean they passed.

- `satisfies_requested_checks`: the available evidence passes every requested
  check, conditional on the sensor inputs and the optical part-number record.
- `needs_confirmation`: at least one requested check lacks evidence, or the
  named sensor used the reference fixture fallback.
- `fails_requested_requirements`: at least one requested check fails. Any other
  unknown checks remain visible; failures do not erase them.

The tool invokes the existing live FoV backend and uses the same FoV response
builder as `calculate_field_of_view`. It does not recalculate optics, rank lenses,
interpolate catalog fields or change the private calculation model. A failed,
ambiguous, truncated or erroneous backend result returns an error without
substituting a fixture lens. A successful response's `evaluatedAt` is the report
time, not the revision or measurement date of the underlying data.

## What can be checked

| Requirement | Evidence and limits |
| --- | --- |
| `horizontal_fov_deg`, `vertical_fov_deg`, `diagonal_fov_deg` | Inclusive `{min, max}` ranges in degrees, compared with the live per-sensor result. |
| `full_sensor_coverage: true` | Existing image-circle coverage result. Does not establish image quality at the edge. |
| `mount` | Nominal M12/S-mount, C-mount/C FA, or CS-mount. C and CS remain distinct; a mount match does not establish physical fit. |
| `distortion` | `{axis, max_absolute_percent}` uses the absolute backend **calculated** value for that axis. A display string, a different axis, or an absent value returns unknown. Calculated is not measured acceptance data. |
| `max_weight_g`, `max_diameter_mm` | Compared only when the public source field contains an explicit positive value in `g` or `mm`, respectively. Numeric or unitless string fields remain unknown. No unit conversions or reference planes are inferred. |
| `require_evidence` | Requests confirmation of the structured engineering evidence below. Currently returns unknown because these datasets are not in the public backend contract. |

The optional `require_evidence` names are:

| Name | Evidence needed before it can be assessed |
| --- | --- |
| `mtf` | Spatial frequency, field position, sagittal/tangential orientation, wavelength, aperture, focus condition, measured versus nominal status. |
| `cra` | Chief-ray angle versus image height, wavelength and configuration. |
| `relative_illumination` | Image height, aperture and spectral conditions. |
| `spectral_transmission` | Transmission data for the exact filter/lens configuration. |
| `mechanical_fit` | Holder dimensions, thread engagement, rear clearance and dimension reference planes. |
| `environmental` | Tested configuration, temperature range, focus shift and ingress-test scope. |
| `depth_of_field` | Circle-of-confusion criterion, working-distance reference and validated focus model. |

`pixelpitchres` and a nominal resolution rating do not establish measured MTF.
The report does not infer these datasets from marketing text, nominal ratings,
flange distance, MBFL or an ingress label. It does not calculate finite-distance
object coverage or depth of field.

## Provenance and purchasing

The live backend does not currently return a source dataset revision.
`sourceRevision`/`sourceDataRevision` therefore remain null. The separate
`adapterModelRevision` identifies the adapter's model label and must not be cited
as a verified source-data revision. Sensor source is explicit: `live`, `fixture`
or `custom`.

An optical-part report is not qualification of a selected Shopify configuration,
a stock check or a purchasing recommendation. Resolve the family with
`resolve_lens_product`, select the full variant SKU, then call
`get_purchase_options` for the requested quantity. Shopify inventory continues
to be read from the backend on each product/purchase-options request. Discuss
unknown engineering checks with Commonlands before committing to a design.

## Next data increment

Before adding MTF, CRA or illumination comparisons, obtain approved source
records that identify the optical design and applicable full variant, units,
measurement/design conditions, public-release permission and dataset revision.
Add an explicit allowlist and contract for those records. Do not publish private
Lambda code or private coefficients to fill the gaps. Structured RFQ context is
the next separate workflow increment; RFQ status tracking requires a real stored
reference and read backend, not an invented confirmation number.
