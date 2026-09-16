# Lab Results to DIGGS

A single HTML file that turns laboratory soil test results into a
[DIGGS 3.0](https://diggsml.org) XML file. It runs entirely in your browser,
offline, with no installation and no server.

**Download:** [`dist/lab_results_to_diggs.html`](dist/lab_results_to_diggs.html)
(open the file, then use *Download raw file*), or get it from
[diggs.geosetta.org](https://diggs.geosetta.org/?tool=lab_diggs_builder).

## How it works

1. Open the HTML file in Chrome, Edge, Firefox or Safari.
2. Download the Excel workbook from the page. It has a sheet for the project,
   the borings, the samples and each test, with dropdowns and a note on every
   column.
3. Fill in the sheets for the tests you ran and save the workbook as `.xlsx`.
4. Drop the workbook on the page. It checks the data, computes the derived
   values and writes the DIGGS XML file on your computer.

Nothing leaves your computer unless you press one of the two optional online
buttons. *Check the file online* sends the XML to the
[Geosetta DIGGS validator](https://diggs.geosetta.org) for schema, codelist and
business-rule checks. *Build a DIGGS File Inspector page* wraps it in the
[DIGGS File Inspector](https://github.com/DIGGSml/diggs_file_inspector).
Each sheet can also be supplied as a separate CSV file with the same header row.

## Supported tests

| Sheet | Results | Method |
|---|---|---|
| Water Content | Water content | ASTM D2216 |
| Atterberg Limits | Liquid limit, plastic limit, plasticity index, non-plastic | ASTM D4318 |
| Wash 200 | Percent passing the No. 200 sieve | ASTM D1140 |
| Gradation | Sieve and hydrometer points; computed gravel, sand, silt and clay, D10/D30/D50/D60, Cu, Cc and USCS | ASTM D6913, D7928 or D422; D2487 |
| Specific Gravity | Specific gravity of soil solids | ASTM D854 |
| Unit Weight | Moist and dry density | ASTM D7263 |
| Organic Content | Organic content (loss on ignition) | ASTM D2974 |
| Compaction | Standard or Modified Proctor trial points; fitted maximum dry density and optimum water content | ASTM D698, D1557 |
| Corrosion | pH, minimum resistivity, water-soluble sulfate and chloride | ASTM G51, G187, C1580, D4327 |

Every results row carries `boring_id`, `sample_id`, `top_depth`,
`bottom_depth` and `sample_type`, so rows on different sheets that name the
same boring and sample describe the same sample. Every boring needs a
latitude and longitude (WGS84 decimal degrees) because DIGGS requires a
location for each sampling feature. Ground elevation is strongly recommended;
without it the file is still schema-valid, but the business-rule check reports
one geometry error per boring.

## DIGGS encoding

The output follows the encoding of the Geosetta DIGGS Lab Standard
certification challenge:

- Each sample is a `Sample`, placed in its borehole by a `SamplingActivity`
  and `SampleProduced` at its depth interval.
- Each test is its own `Test`, linked to its sample with `sampleRef`, and
  carries its procedure (`WaterContentTest`, `AtterbergLimitsTest`,
  `ParticleSizeTest`, `SpecificGravityTest`, `LabDensityTest`,
  `LossOnIgnitionTest`, `LabCompactionTest`, `LabChemicalTest`,
  `LabResistivityTest`) with the ASTM method as `testProcedureMethod`.
- Curves live in the procedure: sieve points as
  `SieveAnalysis/gradingData/Grading`, hydrometer points as
  `Hydrometer/sedimentationData/Sedimentation`, and compaction points as
  `LabCompactionTest/trial/LabCompactionTestTrial`. Modified Proctor sets
  `compactionTestType` to `Modified Proctor`.
- Reported and derived values go in the test outcome, with property codes
  from the DIGGS property dictionary in the procedures its occurrence rules
  allow. For example, USCS is reported with the particle-size test, and moist
  density uses `bulk_density` because the dictionary has no lab `unit_weight`
  code.

Values are written as entered, labelled with the units chosen on the Project
sheet. Output from this tool passes Geosetta's full Lab Standard export
certification (schema, codelists, business rules and data fidelity).

## Development

```
src/index.html      page shell
src/styles.css      styles
src/core.js         all logic, no DOM: CSV and .xlsx reading, the .xlsx
                    template writer, derived values, DIGGS generation
src/ui.js           page behaviour
src/templates.json  sheet and column definitions (one source for the
                    workbook writer, the reader and the column reference)
build.py            inlines src/ into dist/lab_results_to_diggs.html
test/run.js         unit tests (node, no dependencies)
```

```
node test/run.js          # tests
python3 build.py          # rebuild dist/ (commit it with your change)
python3 build.py --check  # checks dist/ matches src/
```

No libraries are used. The `.xlsx` reader includes a DEFLATE decoder ported
from [tiny-inflate](https://github.com/foliojs/tiny-inflate) (MIT; its license
is reproduced in `src/core.js`).

When you edit the sources, keep them free of raw control characters. An
inline script turns a raw NUL into U+FFFD and breaks the page; the tests check
for this. The page checks
`https://diggs.geosetta.org/api/lab-diggs-builder/version` to offer updates;
the version is a hash of the sources, computed the same way by `build.py`.

This repository is the upstream for the copy hosted at diggs.geosetta.org.

## License

MIT. See [LICENSE](LICENSE).
