#!/usr/bin/env node
/*
 * Tests for src/core.js. No dependencies: node test/run.js
 *
 * Full DIGGS validation (XSD, codelists, business rules and the Lab Standard
 * certification checks) runs in Geosetta's hosting repository, which has the
 * validators; these tests cover the logic that does not need them.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const L = require('../src/core.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); }
  catch (e) { failures++; console.log('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

console.log('sources');
test('no raw control characters (HTML turns NUL into U+FFFD inside inline scripts)', () => {
  for (const f of ['index.html', 'styles.css', 'core.js', 'ui.js', 'templates.json']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text), f);
  }
});

console.log('inflate');
test('matches zlib for stored, fixed and dynamic blocks', () => {
  const samples = [Buffer.alloc(0), Buffer.from('a'), Buffer.from('sheet '.repeat(5000)),
    require('crypto').randomBytes(50000),
    Buffer.from(Array.from({ length: 120000 }, (_, i) => '<c r=A1 t=s><v>0</v></c>'.charCodeAt((i * 7919) % 24)))];
  for (const data of samples) {
    for (const level of [0, 1, 6, 9]) {
      assert.ok(Buffer.from(L.inflateRaw(zlib.deflateRawSync(data, { level }))).equals(data), 'level ' + level);
    }
  }
});
test('matches zlib for sync-flushed streams', () => {
  const data = Buffer.from('abcdefghij'.repeat(20000));
  const chunks = [];
  for (let i = 0; i < data.length; i += 7000) {
    chunks.push(zlib.deflateRawSync(data.subarray(i, i + 7000), { finishFlush: zlib.constants.Z_SYNC_FLUSH }));
  }
  // join independent sync-flushed pieces into one stream ending in an empty final stored block
  const stream = Buffer.concat([...chunks, Buffer.from([0x03, 0x00])]);
  assert.ok(Buffer.from(L.inflateRaw(stream)).equals(data));
});

console.log('workbook');
const example = L.writeWorkbook(true);
test('writes a ZIP with every expected part', () => {
  const parts = L.readZip(example);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
                   'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(parts[p], p);
  const wb = Buffer.from(parts['xl/workbook.xml']).toString();
  assert.ok(wb.includes('<definedName name="BoringIds">'));
});
const entries = L.workbookEntries('example.xlsx', example);
test('reads its own workbook back, sheet by sheet', () => {
  const sheets = entries.map((e) => e.detectName);
  assert.deepStrictEqual(sheets, ['project', 'borings', 'samples', 'water_content', 'atterberg_limits',
    'atterberg_trials', 'wash_200', 'gradation', 'specific_gravity', 'unit_weight', 'organic_content',
    'compaction', 'corrosion']);
});
const project = L.projectSettings(L.fileRows(entries[0]));
test('Project sheet gives the settings', () => {
  assert.strictEqual(project.projectName, 'Example laboratory program');
  assert.strictEqual(project.depthUnit, 'ft');
  assert.strictEqual(project.densityUnit, 'lbm/ft3');
});
test('blank workbook has no data sheets except the Project defaults', () => {
  assert.deepStrictEqual(L.workbookEntries('b.xlsx', L.writeWorkbook(false)).map((e) => e.detectName), ['project']);
});
test('example workbook builds DIGGS with no errors or warnings', () => {
  const ds = L.buildDataset(entries, Object.assign({ today: '2026-01-01' }, project));
  assert.deepStrictEqual(ds.errors, []);
  assert.deepStrictEqual(ds.warnings, []);
  assert.strictEqual(L.summarize(ds).tests, 14);
  const xml = L.generateDiggs(ds, project);
  for (const s of ['<Diggs xmlns="http://diggsml.org/schemas/3"', '<SamplingActivity', '<Sample gml:id=',
                   '<compactionTestType>Proctor</compactionTestType>', '<sedimentationData>',
                   'ts=";"', '<referencePoint>']) assert.ok(xml.includes(s), s);
});
test('reads Excel-style parts: rich text, booleans, formulas, sparse cells', () => {
  const shared = L.parseSharedStrings('<sst><si><r><t>ri</t></r><r><t xml:space="preserve">ch &amp; </t></r>' +
    '<rPh><t>X</t></rPh></si><si><t>a_x000D_b</t></si></sst>');
  assert.deepStrictEqual(shared, ['rich & ', 'a\rb']);
  const rows = L.parseSheetXml('<worksheet><sheetData><row r="2"><c r="B2" t="s"><v>0</v></c>' +
    '<c r="C2" t="b"><v>1</v></c><c r="D2" t="str"><f>A1</f><v>calc</v></c></row></sheetData></worksheet>', shared);
  assert.deepStrictEqual(rows, [[], ['', 'rich & ', 'TRUE', 'calc']]);
  assert.strictEqual(L.normDate('46174'), '2026-06-01');
});

console.log('csv');
test('CSV templates with examples build without errors', () => {
  const files = L.TEMPLATES.map((t) => ({ name: t.id + '.csv', text: L.templateCSV(t.id, true) }));
  const ds = L.buildDataset(files, { projectName: 'x' });
  assert.deepStrictEqual(ds.errors, []);
});
test('parses quotes, BOM, blank lines and semicolons', () => {
  assert.deepStrictEqual(L.parseCSV('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepStrictEqual(L.parseCSV('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]);
});
test('recognises files by name and by loose headers', () => {
  assert.strictEqual(L.detectTemplate('Water Content', ['boring_id', 'sample_id', 'top_depth', 'water_content_pct']), 'water_content');
  assert.strictEqual(L.detectTemplate('export.csv', ['Boring', 'Sample', 'Depth', 'LL', 'PL']), 'atterberg_limits');
});
test('reports bad input rows', () => {
  const ds = L.buildDataset([{ name: 'water_content.csv', text:
    'boring_id,sample_id,top_depth,bottom_depth,water_content_pct\nB-1,,1,2,10\nB-1,S-1,3,2,10\nB-1,S-2,1,2,wet\n' }], {});
  const all = ds.errors.join(' | ');
  for (const s of ['sample_id is blank', 'is above top_depth', '"wet" is not a number', 'No latitude/longitude']) {
    assert.ok(all.includes(s), s);
  }
});

console.log('starting from a DIGGS file');
function exampleProject(lineEnd, prefixed) {
  const entries = L.workbookEntries('example.xlsx', L.writeWorkbook(true));
  const site = entries.filter((e) => e.detectName === 'borings' || e.detectName === 'samples');
  let xml = L.generateDiggs(L.buildDataset(site, {}), { projectName: 'Example project' });
  if (prefixed) {
    xml = xml.replace('xmlns="http://diggsml.org/schemas/3"', 'xmlns:diggs="http://diggsml.org/schemas/3"')
      .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s\/>])/g, '<$1diggs:$2');
  }
  return { xml: xml.replace(/\n/g, lineEnd), results: entries.filter((e) => e.detectName !== 'borings') };
}
const INSERTED = /\r?\n[ \t]*<(samplingActivity|sample|measurement|auditTrail) xmlns="http:\/\/diggsml\.org\/schemas\/3"[^>]*>[\s\S]*?<\/\1>/g;
for (const [label, lineEnd, prefixed] of [['LF', '\n', false], ['CRLF', '\r\n', false], ['diggs: prefix', '\n', true]]) {
  test('merges into a project file (' + label + '), keeping it byte for byte', () => {
    const p = exampleProject(lineEnd, prefixed);
    const info = L.readDiggs(p.xml, 'project.xml');
    assert.deepStrictEqual(L.describeSource(info).names, ['B-1', 'B-2']);
    const st = { source: info, labName: 'Lab', today: '2026-01-01' };
    const ds = L.buildDataset(p.results, st);
    assert.deepStrictEqual(ds.errors, []);
    assert.strictEqual(ds.sampleOrder.filter((k) => ds.samples[k].sourceId).length, 2);
    const merged = L.mergeDiggs(info, ds, st);
    assert.strictEqual(merged.replace(INSERTED, ''), p.xml);
    if (lineEnd === '\r\n') assert.ok(!/[^\r]\n/.test(merged));
    // inserted records follow the root element order
    const order = ['samplingFeature', 'samplingActivity', 'sample', 'measurement'];
    const seen = [...merged.matchAll(/\n[ \t]*<(?:diggs:)?(samplingFeature|samplingActivity|sample|measurement)[\s>]/g)]
      .map((m) => order.indexOf(m[1]));
    assert.deepStrictEqual(seen, [...seen].sort((a, b) => a - b));
    // every added id is prefixed and unique; merging again changes nothing
    const ids = [...merged.matchAll(/gml:id="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(new Set(ids).size, ids.length);
    const info2 = L.readDiggs(merged, 'project.xml');
    assert.strictEqual(L.describeSource(info2).labTests, 14);
    assert.strictEqual(L.mergeDiggs(info2, L.buildDataset(p.results, Object.assign({}, st, { source: info2 })), st), merged);
  });
}
test('reports borings and units that do not fit the file', () => {
  const p = exampleProject('\n', false);
  const info = L.readDiggs(p.xml, 'project.xml');
  const bad = [{ name: 'water_content.csv', text:
    'boring_id,sample_id,top_depth,bottom_depth,water_content_pct\nb01,S-1,,,10\nB-9,S-1,1,2,10\n' }];
  const ds = L.buildDataset(bad, { source: info, workbookDepthUnit: 'm' });
  const all = ds.errors.join(' | ');
  assert.ok(ds.warnings.some((w) => w.includes('"b01" was matched to "B-1"')));
  assert.ok(all.includes('boring "B-9" is not in project.xml'));
  assert.ok(all.includes('The workbook gives depths in meters'));
});
test('refuses files it cannot merge into', () => {
  assert.throws(() => L.readDiggs('<Diggs xmlns="http://diggsml.org/schemas/2.6"/>'), /not a DIGGS 3 file/);
  assert.throws(() => L.readDiggs('<!DOCTYPE x><Diggs xmlns="http://diggsml.org/schemas/3"/>'), /DOCTYPE/);
  assert.throws(() => L.readDiggs('<Diggs xmlns="http://diggsml.org/schemas/3">\n<a></b></Diggs>'), /line 2/);
});
test('prepared workbook lists the file\'s borings and samples', () => {
  const info = L.readDiggs(exampleProject('\n', false).xml, 'project.xml');
  const entries = L.workbookEntries('p.xlsx', L.writeWorkbook(false, L.sourceSeed(info)));
  const by = Object.fromEntries(entries.map((e) => [e.detectName, L.fileRows(e)]));
  assert.deepStrictEqual(by.borings.slice(1).map((r) => r[0]), ['B-1', 'B-2']);
  assert.deepStrictEqual(by.samples.slice(1).map((r) => r[1]), ['S-1', 'ST-3']);
  assert.strictEqual(L.projectSettings(by.project).sourceFile, 'project.xml');
  assert.ok(Buffer.from(L.readZip(L.writeWorkbook(false, L.sourceSeed(info)))['xl/workbook.xml']).toString()
    .includes('<definedName name="SampleIds">'));
});

console.log('raw measurements');
const rawFiles = L.TEMPLATES.map((t) => ({ name: t.id + '.csv', text: L.templateCSV(t.id, true) }));
const rawProject = L.projectSettings(L.parseCSV(L.templateCSV('project', true)));
test('the example rows carry raw measurements and reported results', () => {
  const ds = L.buildDataset(rawFiles, Object.assign({}, rawProject));
  assert.deepStrictEqual(ds.errors, []);
  assert.deepStrictEqual(ds.warnings, []);
  const xml = L.generateDiggs(ds, Object.assign({ projectName: 'Raw' }, rawProject));
  for (const needle of ['<SoilSpecimen', '<parameterName>tare_mass</parameterName>', '<CasagrandeTrial',
                        '<PlasticLimitTrial', '<blowCount>', '<weightRetained uom="gf">', '<PanData',
                        '<hydrometerReading uom="g/L">', '<elapsedTime uom="min">', '<diameter uom="mm">',
                        '<wetWeight uom="gf">', '<mouldVolume uom="cm3">', '<wetDensity uom="lbm/ft3">',
                        '<parameterName>resistance_ohm</parameterName>']) {
    assert.ok(xml.includes(needle), needle);
  }
});
test('nothing is computed: a missing result is reported, not filled in', () => {
  const key = 'boring_id,sample_id,top_depth,bottom_depth,sample_type,';
  const ds = L.buildDataset([
    { name: 'water_content.csv', text: key + 'water_content_pct,tare_mass,wet_mass_with_tare,dry_mass_with_tare\n' +
        'B-1,S-1,2.5,4,,,15.6,128.4,116.0\n' },
    { name: 'atterberg_trials.csv', text: key + 'trial_type,blows,water_content_pct\n' +
        'B-1,S-2,5,6.5,,casagrande,25,32.1\nB-1,S-2,5,6.5,,plastic_limit,,19.0\n' }
  ], {});
  const all = ds.errors.join(' | ');
  assert.ok(all.includes('has raw measurements but no water_content_pct'), all);
  assert.ok(all.includes('needs liquid_limit and plastic_limit'), all);
  assert.ok(!('uscs' in L) && !('gradationSummary' in L) && !('compactionSummary' in L));
});

console.log('other checks');
test('sieve designations', () => {
  assert.deepStrictEqual([L.sieveSize('#200'), L.sieveSize('3/4"'), L.sieveSize('No 10')], [0.075, 19, 2]);
});

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
