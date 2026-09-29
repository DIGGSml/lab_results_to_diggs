# Lab Results to DIGGS

A single HTML file that turns laboratory soil test results into a
[DIGGS 3.0](https://diggsml.org) XML file. It runs entirely in your browser,
offline, with no installation and no server.

**Download:** [`dist/lab_results_to_diggs.html`](dist/lab_results_to_diggs.html)
(open the file, then use *Download raw file*), or get it from
[diggs.geosetta.org](https://diggs.geosetta.org/?tool=lab_diggs_builder).

## How it works

**Recommended: start from the project's DIGGS file.** Ask the engineer or
driller for the project's DIGGS 3 file with the proposed or as-drilled
borings.

1. Open the HTML file in Chrome, Edge, Firefox or Safari.
2. Drop the project's DIGGS file on the page, say whether its boring
   locations are proposed or as drilled, and download the workbook prepared
   for it. The workbook lists the file's borings and samples, with dropdowns
   and a note on every column.
3. Enter the results on the sheets for the tests you ran and save the
   workbook as `.xlsx`.
4. Drop the workbook on the page and download the DIGGS file with your
   results added.

The lab never types boring locations: they come from the DIGGS file. The
original file is kept exactly as it was; the page only inserts new samples
and tests that point at its boreholes, and notes in the file's audit trail
who added them and whether the locations were proposed. Results are
matched to the file's samples by sample name within the boring (or by an
identical depth interval), and a sample that is not in the file is added at
the depths given. Adding an updated workbook again replaces the earlier
results, so a lab can re-run it at any time, including against the
as-drilled file once it exists.

**No DIGGS file?** Download the blank workbook instead, enter each
boring's latitude and longitude (WGS84 decimal degrees) on the Borings
sheet, and the page writes a new DIGGS file. Each sheet can also be supplied
as a separate CSV file with the same header row.

Nothing leaves your computer unless you press one of the two optional online
buttons. *Check the file online* sends the XML to the
[Geosetta DIGGS validator](https://diggs.geosetta.org) for schema, codelist and
business-rule checks. *Build a DIGGS File Inspector page* wraps it in the
[DIGGS File Inspector](https://github.com/DIGGSml/diggs_file_inspector).

## Supported tests

| Sheet | Results | Method |
|---|---|---|
| Water Content | Water content, with the tare, wet and dry masses | ASTM D2216 |
| Atterberg Limits | Liquid limit, plastic limit, plasticity index, non-plastic | ASTM D4318 |
| Atterberg Trials | Raw trials: blow counts, trial water contents, cone penetration | ASTM D4318 |
| Wash 200 | Percent passing the No. 200 sieve | ASTM D1140 |
| Gradation | Sieve and hydrometer points, with masses retained and hydrometer readings; the reported gravel, sand, silt and clay, D-values, Cu, Cc and USCS | ASTM D6913, D7928 or D422; D2487 |
| Specific Gravity | Specific gravity of soil solids, with the pycnometer masses and temperature | ASTM D854 |
| Unit Weight | Moist and dry density, with specimen mass and dimensions | ASTM D7263 |
| Organic Content | Organic content (loss on ignition) | ASTM D2974 |
| Compaction | Standard or Modified Proctor trial points with mould and rammer details; the reported maximum dry density and optimum water content | ASTM D698, D1557 |
| Corrosion | pH, minimum resistivity, water-soluble sulfate and chloride, with the soil box reading | ASTM G51, G187, C1580, D4327 |

Every results row carries `boring_id`, `sample_id`, `top_depth`,
`bottom_depth` and `sample_type`, so rows on different sheets that name the
same boring and sample describe the same sample. When you start from a DIGGS
file, depths may be left blank for samples that are already in it. Without a
DIGGS file, every boring needs a latitude and longitude because DIGGS
requires a location for each sampling feature; ground elevation is strongly
recommended, since without it the business-rule check reports one geometry
error per boring.

## It translates, it does not calculate

The tool moves a laboratory's data into DIGGS. Reported results are written
exactly as entered, and the raw measurements behind them are carried into the
test procedure, where DIGGS has a place for them:

- specimen masses and dimensions on a `SoilSpecimen` (tare, wet and dry
  masses as named parameters; diameter, height, volume and specimen weights
  as specimen conditions),
- Atterberg trials as `CasagrandeTrial`, `PlasticLimitTrial` and
  `FallConeTrial` records with their blow counts and water contents,
- masses retained per sieve on `Grading`, the pan on `PanData`, and
  hydrometer readings (elapsed time, reading, temperature, correction,
  effective length) on `Sedimentation`,
- Proctor mould volume, rammer mass and drop, layers and blows on the test,
  with wet density and the raw masses on each trial,
- pycnometer masses, soil box readings and anything else DIGGS has no element
  for as named parameters, verbatim.

Nothing is computed, corrected or rounded. A value the laboratory did not
report is marked as not reported rather than filled in: DIGGS needs at least
one result in a test, so the expected property is written with
`<nullValue reason="missing">notReported</nullValue>` and that token in the
data block. A test can therefore travel with its raw measurements alone, and
the page warns for each one.

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
sheet (including the mass, dimension and volume units for raw measurements) (or, when merging, with the depth unit of each borehole in the DIGGS
file; a workbook that says otherwise is refused). Output from this tool,
written new or merged into a field DIGGS file, passes Geosetta's full Lab
Standard export certification (schema, codelists, business rules and data
fidelity). Records added to an existing file have `gml:id`s starting with
`LAB_`.

## Development

```
src/index.html      page shell
src/styles.css      styles
src/core.js         all logic, no DOM: CSV and .xlsx reading, the .xlsx
                    template writer, derived values, DIGGS generation,
                    reading a DIGGS file and merging results into it
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
