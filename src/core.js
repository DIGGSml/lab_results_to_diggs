/*
 * Lab Results -> DIGGS: core logic (no DOM).
 *
 * Mirrors the Python Lab Standard encoder (certification/tools/flavors/lab.py
 * lab_to_diggs + core/vlm_to_diggs.py borehole skeleton), so files built here
 * pass the same XSD + codelist + business-rule checks as the certification
 * reference. Keep the two in step when either changes.
 *
 * Loaded inline in the standalone HTML, and by node for the test harness
 * (test_lab_diggs_builder.py) through module.exports at the bottom.
 */
var LabDiggs = (function () {
  'use strict';

  var NS_DIGGS = 'http://diggsml.org/schemas/3';
  var PROPS = 'https://diggsml.org/def/codes/DIGGS/0.1/properties.xml';
  var ROLES = 'https://diggsml.org/def/codes/DIGGS/0.1/roles.xml';
  var EPSG = 'http://www.opengis.net/def/crs/EPSG/0/';
  // Compound CRS: EPSG:4326 horizontal + NAVD88 height (6360 = US survey ft,
  // 5703 = m). Same form as core/vlm_to_diggs.py CRS_COMPOUND_4326_NAVD88FT.
  function compoundCrs(depthUnit) {
    var vert = depthUnit === 'm' ? '5703' : '6360';
    return 'https://www.opengis.net/def/crs-compound?1=' + EPSG + '4326%262=' + EPSG + vert;
  }

  var DENSITY_UNITS = {
    'lbm/ft3': 'lbm/ft3 (pcf)',
    'lbf/ft3': 'lbf/ft3 (pcf, unit weight)',
    'kg/m3': 'kg/m3',
    'Mg/m3': 'Mg/m3',
    'g/cm3': 'g/cm3'
  };

  // ASTM D6913 / common sieve designations -> opening (mm)
  var SIEVE_SIZES = {
    '6 in': 150, '4 in': 100, '3 in': 75, '2 in': 50, '1-1/2 in': 37.5, '1 1/2 in': 37.5,
    '1 in': 25, '3/4 in': 19, '1/2 in': 12.5, '3/8 in': 9.5, '1/4 in': 6.3,
    'no. 4': 4.75, 'no. 8': 2.36, 'no. 10': 2.0, 'no. 16': 1.18, 'no. 20': 0.85,
    'no. 30': 0.6, 'no. 40': 0.425, 'no. 50': 0.3, 'no. 60': 0.25, 'no. 80': 0.18,
    'no. 100': 0.15, 'no. 140': 0.106, 'no. 200': 0.075
  };

  function sieveKey(label) {
    var s = String(label || '').trim().toLowerCase()
      .replace(/["”]/g, ' in').replace(/\binch(es)?\b/g, 'in')
      .replace(/^#\s*/, 'no. ').replace(/^no\.?\s*/, 'no. ')
      .replace(/\s+/g, ' ').trim();
    return s;
  }

  function sieveSize(label) {
    var k = sieveKey(label);
    return Object.prototype.hasOwnProperty.call(SIEVE_SIZES, k) ? SIEVE_SIZES[k] : null;
  }

  // USCS symbols accepted in a lab-supplied classification (ASTM D2487 group
  // symbols, grp-astmD2487.xml).
  var USCS_SYMBOLS = ['CH', 'CL', 'CL-ML', 'GC', 'GC-GM', 'GM', 'GP', 'GP-GC', 'GP-GM', 'GW',
    'GW-GC', 'GW-GM', 'MH', 'ML', 'OH', 'OL', 'PT', 'SC', 'SC-SM', 'SM', 'SP', 'SP-SC',
    'SP-SM', 'SW', 'SW-SC', 'SW-SM'];

  // ---------------------------------------------------------------------
  // Test definitions: procedure element, display name, ASTM methods
  // ---------------------------------------------------------------------
  var SPECS = {
    D2216: 'Laboratory Determination of Water (Moisture) Content of Soil and Rock by Mass',
    D4318: 'Liquid Limit, Plastic Limit, and Plasticity Index of Soils',
    D1140: 'Determining the Amount of Material Finer than 75-um (No. 200) Sieve in Soils by Washing',
    D6913: 'Particle-Size Distribution (Gradation) of Soils Using Sieve Analysis',
    D7928: 'Particle-Size Distribution (Gradation) of Fine-Grained Soils Using the Sedimentation (Hydrometer) Analysis',
    D422: 'Particle-Size Analysis of Soils (withdrawn 2016)',
    D2487: 'Classification of Soils for Engineering Purposes (Unified Soil Classification System)',
    D854: 'Specific Gravity of Soil Solids by the Water Pycnometer',
    D7263: 'Laboratory Determination of Density and Unit Weight of Soil Specimens',
    D2974: 'Determining the Water (Moisture) Content, Ash Content, and Organic Material of Peat and Other Organic Soils',
    D698: 'Laboratory Compaction Characteristics of Soil Using Standard Effort',
    D1557: 'Laboratory Compaction Characteristics of Soil Using Modified Effort',
    G51: 'Measuring pH of Soil for Use in Corrosion Testing',
    G187: 'Measurement of Soil Resistivity Using the Two-Electrode Soil Box Method',
    C1580: 'Water-Soluble Sulfate in Soil',
    D4327: 'Anions in Water by Suppressed Ion Chromatography'
  };

  var KINDS = {
    water_content: { name: 'Water Content', proc: 'WaterContentTest' },
    atterberg_limits: { name: 'Atterberg Limits', proc: 'AtterbergLimitsTest' },
    wash_200: { name: 'Wash No. 200', proc: 'ParticleSizeTest' },
    gradation: { name: 'Gradation', proc: 'ParticleSizeTest' },
    specific_gravity: { name: 'Specific Gravity', proc: 'SpecificGravityTest' },
    unit_weight: { name: 'Unit Weight', proc: 'LabDensityTest' },
    organic_content: { name: 'Organic Content', proc: 'LossOnIgnitionTest' },
    compaction: { name: 'Proctor', proc: 'LabCompactionTest' },
    ph: { name: 'pH', proc: 'LabChemicalTest' },
    resistivity: { name: 'Resistivity', proc: 'LabResistivityTest' },
    sulfate: { name: 'Water-Soluble Sulfate', proc: 'LabChemicalTest' },
    chloride: { name: 'Water-Soluble Chloride', proc: 'LabChemicalTest' }
  };
  var KIND_ORDER = Object.keys(KINDS);

  // ---------------------------------------------------------------------
  // CSV templates
  // ---------------------------------------------------------------------
  // Template definitions live in templates.json, shared with the workbook
  // builder (core/lab_workbook.py). The page build inlines the JSON here;
  // node loads the file.
  var TEMPLATE_DATA = /*__TEMPLATES_JSON__*/null;
  if (!TEMPLATE_DATA && typeof require === 'function') {
    TEMPLATE_DATA = require(require('path').join(__dirname, 'templates.json'));
  }

  var KEY_COLS = TEMPLATE_DATA.key_columns;
  var PROJECT = TEMPLATE_DATA.project;
  var TEMPLATES = TEMPLATE_DATA.templates.map(function (t) {
    var cols = t.keyed ? KEY_COLS.concat(t.columns) : t.columns;
    return { id: t.id, title: t.title, sheet: t.sheet, astm: t.astm, optional: t.optional,
             keyed: t.keyed, columns: cols, examples: t.examples, notes: t.notes || '' };
  });
  // project.csv / the Project sheet: key/value rows, read by projectSettings()
  TEMPLATES.push({ id: 'project', title: 'Project', sheet: PROJECT.sheet, astm: '', optional: true,
    keyed: false, isProject: true,
    columns: [{ name: 'field', required: true, doc: 'Field name, as listed below' },
              { name: 'value', required: true, doc: 'Value' }],
    examples: PROJECT.fields.map(function (f) { return [f.key, f.example]; }),
    notes: 'Fields: ' + PROJECT.fields.map(function (f) { return f.key + ' (' + f.doc + ')'; }).join('; ') });

  var TEMPLATE_BY_ID = {};
  TEMPLATES.forEach(function (t) { TEMPLATE_BY_ID[t.id] = t; });

  // header aliases -> canonical column name
  var ALIASES = {
    boring: 'boring_id', boring_no: 'boring_id', boring_number: 'boring_id', borehole: 'boring_id',
    borehole_id: 'boring_id', hole_id: 'boring_id', loca_id: 'boring_id', location_id: 'boring_id',
    sample: 'sample_id', sample_no: 'sample_id', sample_number: 'sample_id', samp_id: 'sample_id',
    depth: 'top_depth', depth_top: 'top_depth', top: 'top_depth', from: 'top_depth', samp_top: 'top_depth',
    depth_bottom: 'bottom_depth', bottom: 'bottom_depth', to: 'bottom_depth', samp_base: 'bottom_depth',
    type: 'sample_type', samp_type: 'sample_type',
    lat: 'latitude', lon: 'longitude', long: 'longitude', lng: 'longitude',
    elevation: 'ground_elevation', ground_elev: 'ground_elevation', gl: 'ground_elevation',
    depth_total: 'total_depth', date: 'date_drilled',
    water_content: 'water_content_pct', moisture_content: 'water_content_pct', moisture_pct: 'water_content_pct',
    w: 'water_content_pct', w_pct: 'water_content_pct', mc: 'water_content_pct',
    ll: 'liquid_limit', pl: 'plastic_limit', pi: 'plasticity_index', np: 'non_plastic',
    passing_200: 'percent_passing_200', p200: 'percent_passing_200', fines: 'percent_passing_200',
    percent_fines: 'percent_passing_200', passing_200_pct: 'percent_passing_200',
    size_mm: 'particle_size_mm', particle_size: 'particle_size_mm', diameter_mm: 'particle_size_mm',
    passing: 'percent_passing', percent_finer: 'percent_passing', pct_passing: 'percent_passing',
    uscs: 'uscs_symbol', group_symbol: 'uscs_symbol', group_name: 'uscs_group_name',
    gs: 'specific_gravity', sg: 'specific_gravity',
    moist_unit_weight: 'moist_density', wet_density: 'moist_density', bulk_density: 'moist_density',
    total_unit_weight: 'moist_density', dry_unit_weight: 'dry_density',
    organic_content: 'organic_content_pct', loi: 'organic_content_pct', loss_on_ignition: 'organic_content_pct',
    trial_no: 'trial', dry_density_lbm_ft3: 'dry_density',
    mdd: 'max_dry_density', maximum_dry_density: 'max_dry_density',
    omc: 'optimum_water_content', optimum_moisture_content: 'optimum_water_content',
    resistivity: 'resistivity_ohm_cm', sulfate: 'sulfate_ppm', sulfate_content: 'sulfate_ppm',
    chloride: 'chloride_ppm', chloride_content: 'chloride_ppm', soil_ph: 'ph'
  };

  function normHeader(h) {
    var s = String(h || '').replace(/^\uFEFF/, '').trim().toLowerCase()
      .replace(/%/g, 'pct').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (ALIASES[s]) return ALIASES[s];
    // tolerate unit suffixes: top_depth_ft, ground_elevation_m, dry_density_pcf ...
    var stripped = s.replace(/_(ft|m|feet|meters|pcf|kn_m3|lbm_ft3|mg_m3|kg_m3|g_cm3)$/, '');
    if (stripped !== s) return ALIASES[stripped] || stripped;
    return s;
  }

  // ---------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------
  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    // Excel in some locales saves ';'-separated files
    var firstLine = text.split(/\r?\n/, 1)[0] || '';
    var delim = (firstLine.split(';').length > firstLine.split(',').length &&
                 firstLine.indexOf('\t') < 0) ? ';'
      : (firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',');
    var rows = [], row = [], field = '', i = 0, inQuotes = false, n = text.length;
    while (i < n) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQuotes = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function templateCSV(id, withExamples) {
    var t = TEMPLATE_BY_ID[id];
    var rows = [t.columns.map(function (c) { return c.name; })];
    if (withExamples) rows = rows.concat(t.examples);
    return toCSV(rows);
  }

  function detectTemplate(fileName, headers) {
    var base = String(fileName || '').toLowerCase().replace(/^.*[\\/]/, '').replace(/\.[a-z]+$/, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    var cols = headers.map(normHeader);
    var has = function (c) { return cols.indexOf(c) >= 0; };
    var matches = TEMPLATES.filter(function (t) {
      return t.columns.every(function (c) { return !c.required || has(c.name); });
    });
    for (var i = 0; i < matches.length; i++) {
      if (base === matches[i].id) return matches[i].id;
    }
    for (var j = 0; j < matches.length; j++) {
      if (base.indexOf(matches[j].id) >= 0) return matches[j].id;
    }
    // Score by distinctive (non-key) columns present
    var best = null, bestScore = 0;
    matches.forEach(function (t) {
      var score = t.columns.filter(function (c) {
        return KEY_COLS.every(function (k) { return k.name !== c.name; }) && has(c.name);
      }).length;
      if (score > bestScore) { best = t.id; bestScore = score; }
    });
    if (best) return best;
    if (matches.some(function (t) { return t.id === 'samples'; })) return 'samples';
    if (matches.some(function (t) { return t.id === 'borings'; })) return 'borings';
    return null;
  }

  // ---------------------------------------------------------------------
  // Numbers / formatting
  // ---------------------------------------------------------------------
  function num(v) {
    if (v == null) return null;
    var s = String(v).trim().replace(/,/g, '');
    if (s === '') return null;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function fmt(v) {
    if (typeof v !== 'number') return String(v);
    if (Object.is(v, -0)) v = 0;
    return String(Number(v.toPrecision(12)));
  }

  function round(v, d) {
    var f = Math.pow(10, d);
    return Math.round((v + (v >= 0 ? 1 : -1) * 1e-9) * f) / f;
  }

  function truthy(v) {
    return /^(true|yes|y|1|x|np)$/i.test(String(v || '').trim());
  }

  function normDate(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      // Excel date serial (1900 date system): days since 1899-12-30
      var dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(s)) * 86400000);
      if (dt.getUTCFullYear() < 1950 || dt.getUTCFullYear() > 2150) return null;
      return dt.toISOString().slice(0, 10);
    }
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    var y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/))) {
      mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
    } else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }

  function safeId(raw) {
    var s = String(raw).replace(/[^A-Za-z0-9_]/g, '_');
    if (!s || !/^[A-Za-z_]/.test(s)) s = '_' + s;
    return s;
  }

  // ---------------------------------------------------------------------
  // Derived values (ported from lab.py)
  // ---------------------------------------------------------------------

  /** Particle size at `percent` passing, log-linear between bracketing points.
   *  curve: [{size, pass}] sorted by size descending. */
  function dValue(curve, percent) {
    for (var i = 0; i + 1 < curve.length; i++) {
      var s1 = curve[i].size, p1 = curve[i].pass, s2 = curve[i + 1].size, p2 = curve[i + 1].pass;
      if (p1 >= percent && percent >= p2 && p1 !== p2) {
        var logSize = Math.log10(s2) + (percent - p2) * (Math.log10(s1) - Math.log10(s2)) / (p1 - p2);
        return Math.pow(10, logSize);
      }
    }
    return null;
  }

  /** Percent passing at `size` mm: exact point (within 1 %), else log-linear
   *  between bracketing points, else 100 above a 100 % point. */
  function passingAt(curve, size) {
    for (var i = 0; i < curve.length; i++) {
      if (Math.abs(curve[i].size - size) <= size * 0.01) return curve[i].pass;
    }
    for (var j = 0; j + 1 < curve.length; j++) {
      var a = curve[j], b = curve[j + 1];
      if (a.size > size && size > b.size) {
        return b.pass + (Math.log10(size) - Math.log10(b.size)) *
          (a.pass - b.pass) / (Math.log10(a.size) - Math.log10(b.size));
      }
    }
    if (curve.length && size > curve[0].size && curve[0].pass >= 100) return 100;
    return null;
  }

  function aLine(ll) { return 0.73 * (ll - 20); }

  /** Plasticity-chart symbol for the fines (ASTM D2487, inorganic soils). */
  function finesSymbol(ll, pi) {
    if (ll == null) return 'ML';  // non-plastic with no liquid limit
    if (ll < 50) {
      if (pi > 7 && pi >= aLine(ll)) return 'CL';
      if (pi >= 4 && pi <= 7 && pi >= aLine(ll)) return 'CL-ML';
      return 'ML';
    }
    return pi >= aLine(ll) ? 'CH' : 'MH';
  }

  var FINE_NAMES = { 'CL': 'lean clay', 'CL-ML': 'silty clay', 'ML': 'silt',
    'CH': 'fat clay', 'MH': 'elastic silt' };

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /** [symbol, group name] per ASTM D2487 for inorganic soils, or null with a
   *  reason when the tests needed to classify were not run. */
  function uscs(summary, plasticity) {
    var gravel = summary.gravel, sand = summary.sand, fines = summary.fines;
    if (gravel == null || sand == null || fines == null) {
      return { reason: 'the gradation does not cover the No. 4 and No. 200 sieves' };
    }
    var fs = plasticity ? finesSymbol(plasticity.ll, plasticity.pi) : null;

    if (fines >= 50) {
      if (!fs) return { reason: 'fine-grained soil needs Atterberg limits on the same sample' };
      var base = FINE_NAMES[fs], coarse = 100 - fines, name;
      if (coarse < 15) name = base;
      else if (coarse < 30) name = base + ' with ' + (sand >= gravel ? 'sand' : 'gravel');
      else if (sand >= gravel) name = 'sandy ' + base + (gravel >= 15 ? ' with gravel' : '');
      else name = 'gravelly ' + base + (sand >= 15 ? ' with sand' : '');
      return { symbol: fs, name: cap(name) };
    }

    var isG = gravel > sand;
    var letter = isG ? 'G' : 'S', soil = isG ? 'gravel' : 'sand';
    var other = isG ? sand : gravel, otherWord = isG ? 'sand' : 'gravel';
    var graded = null;
    if (fines <= 12) {
      if (summary.cu == null || summary.cc == null) {
        return { reason: 'coarse soil with 12 % fines or less needs D10, D30 and D60 (Cu, Cc)' };
      }
      var well = summary.cu >= (isG ? 4 : 6) && summary.cc >= 1 && summary.cc <= 3;
      graded = { sym: letter + (well ? 'W' : 'P'), word: well ? 'Well-graded' : 'Poorly graded' };
    }
    if (fines < 5) {
      return { symbol: graded.sym, name: graded.word + ' ' + soil + (other >= 15 ? ' with ' + otherWord : '') };
    }
    if (!fs) return { reason: 'coarse soil with 5 % fines or more needs Atterberg limits on the same sample' };
    var clayey = fs === 'CL' || fs === 'CH' || fs === 'CL-ML';
    if (fines <= 12) {
      var sym2 = letter + (clayey ? 'C' : 'M');
      return { symbol: graded.sym + '-' + sym2,
               name: graded.word + ' ' + soil + ' with ' + (clayey ? 'clay' : 'silt') +
                     (other >= 15 ? ' and ' + otherWord : '') };
    }
    var suffix = other >= 15 ? ' with ' + otherWord : '';
    if (fs === 'CL-ML') return { symbol: letter + 'C-' + letter + 'M', name: 'Silty, clayey ' + soil + suffix };
    if (clayey) return { symbol: letter + 'C', name: 'Clayey ' + soil + suffix };
    return { symbol: letter + 'M', name: 'Silty ' + soil + suffix };
  }

  function gradationSummary(curve, hasHydrometer) {
    var out = {};
    var fines = passingAt(curve, 0.075), p4 = passingAt(curve, 4.75);
    if (fines != null) out.fines = fines;
    if (fines != null && p4 != null) {
      out.gravel = round(100 - p4, 1);
      out.sand = round(p4 - fines, 1);
    }
    if (hasHydrometer && fines != null) {
      var clay = passingAt(curve, 0.002);
      if (clay != null && clay <= fines) {
        out.clay = round(clay, 1);
        out.silt = round(fines - clay, 1);
      }
    }
    [10, 30, 50, 60].forEach(function (p) {
      var d = dValue(curve, p);
      if (d != null) out['d' + p] = round(d, 4);
    });
    if (out.d10 != null && out.d30 != null && out.d60 != null && out.d10 > 0) {
      out.cu = round(out.d60 / out.d10, 2);
      out.cc = round(out.d30 * out.d30 / (out.d10 * out.d60), 2);
    }
    return out;
  }

  /** {omc, mdd}: vertex of the parabola through the highest trial and its two
   *  neighbours (lab.py compaction_summary). null when it cannot be fitted. */
  function compactionSummary(trials) {
    if (trials.length < 3) return null;
    var peak = 0;
    trials.forEach(function (t, i) { if (t.dd > trials[peak].dd) peak = i; });
    var lo = Math.min(Math.max(peak - 1, 0), trials.length - 3);
    var x1 = trials[lo].w, y1 = trials[lo].dd, x2 = trials[lo + 1].w, y2 = trials[lo + 1].dd,
        x3 = trials[lo + 2].w, y3 = trials[lo + 2].dd;
    var denom = (x1 - x2) * (x1 - x3) * (x2 - x3);
    if (!denom) return null;
    var a = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / denom;
    var b = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / denom;
    var c = (x2 * x3 * (x2 - x3) * y1 + x3 * x1 * (x3 - x1) * y2 + x1 * x2 * (x1 - x2) * y3) / denom;
    if (!(a < 0)) return null;
    var omc = -b / (2 * a);
    if (omc < trials[0].w || omc > trials[trials.length - 1].w) return null;
    return { omc: round(omc, 1), mdd: round(c - b * b / (4 * a), 1) };
  }

  // ---------------------------------------------------------------------
  // Dataset
  // ---------------------------------------------------------------------

  /** Rows of a loaded file: CSV text, or rows already read from a workbook
   *  sheet. Cells become trimmed strings; blank rows are dropped. */
  function fileRows(f) {
    if (!f.rows) return parseCSV(f.text);
    return f.rows.map(function (r) {
      var out = [];
      for (var i = 0; i < r.length; i++) out.push(r[i] == null ? '' : String(r[i]));
      return out;
    }).filter(function (r) { return r.some(function (v) { return v.trim() !== ''; }); });
  }

  /** Project settings from project.csv / the Project sheet (field,value rows).
   *  Returns {settingName: value} for the fields that have a value. */
  function projectSettings(rows) {
    var out = {};
    if (!rows || rows.length < 2) return out;
    var headers = rows[0].map(normHeader);
    var fi = headers.indexOf('field'), vi = headers.indexOf('value');
    if (fi < 0 || vi < 0) return out;
    var byKey = {};
    PROJECT.fields.forEach(function (f) { byKey[f.key] = f; byKey[normHeader(f.label)] = f; });
    byKey.lab = byKey.lab_name = byKey.laboratory;
    rows.slice(1).forEach(function (r) {
      var key = normHeader(r[fi]);
      var f = byKey[key];
      var v = String(r[vi] == null ? '' : r[vi]).trim();
      if (key === 'source_file' && v) { out.sourceFile = v; return; }
      if (!f || !v) return;
      if (f.key === 'depth_unit') {
        if (/^(m|meters?|metres?)$/i.test(v)) v = 'm';
        else if (/^(ft|feet|foot)$/i.test(v)) v = 'ft';
        else return;
      }
      if (f.key === 'density_unit') {
        var u = v.replace(/\s*\(.*\)$/, '').replace(/\^/g, '').trim();
        if (/^pcf$/i.test(u)) u = 'lbm/ft3';
        if (!DENSITY_UNITS[u]) return;
        v = u;
      }
      out[f.setting] = v;
    });
    return out;
  }

  /**
   * files: [{name, text | rows, template?, sheet?, detectName?}]
   *   template overrides detection; sheet marks a workbook sheet (unrecognised
   *   sheets are skipped with a warning instead of blocking the build)
   * settings: {projectName, projectNumber, client, labName, depthUnit, densityUnit}
   */
  function buildDataset(files, settings) {
    var ds = { borings: {}, boringOrder: [], samples: {}, sampleOrder: [], tests: [],
               warnings: [], errors: [], files: [] };
    var depthUnit = settings.depthUnit === 'm' ? 'm' : 'ft';

    function warn(msg) { ds.warnings.push(msg); }
    function err(msg) { ds.errors.push(msg); }

    // Starting from a DIGGS file: borings and samples resolve against it
    var src = settings.source || null;
    ds.merge = !!src;
    var featByName = {}, featByKey = {}, unknownBorings = {}, noted = {};
    if (src) {
      src.features.forEach(function (f) {
        featByName[f.name] = f;
        (featByKey[nameKey(f.name)] = featByKey[nameKey(f.name)] || []).push(f);
      });
    }
    function canonicalBoring(id, where) {
      if (!src) return id;
      if (featByName[id]) return id;
      var loose = featByKey[nameKey(id)] || [];
      if (loose.length === 1) {
        if (!noted['b:' + id]) {
          warn(where + ': boring "' + id + '" was matched to "' + loose[0].name + '" in ' + src.fileName);
          noted['b:' + id] = true;
        }
        return loose[0].name;
      }
      if (!unknownBorings[id]) unknownBorings[id] = where;
      return id;
    }

    function boring(id) {
      if (!ds.borings[id]) {
        ds.borings[id] = { id: id };
        if (src && featByName[id]) ds.borings[id].feature = featByName[id];
        ds.boringOrder.push(id);
      }
      return ds.borings[id];
    }

    function matchSourceSample(where, b, s, top, bottom) {
      var feat = featByName[b];
      if (!feat) return null;
      var keepLab = settings.previousLab === 'keep';
      var pool = src.samples.filter(function (c) { return c.boring === b && (keepLab || !c.lab); });
      var near = function (x, y) { return x == null || y == null || Math.abs(x - y) <= 0.05; };
      var byName = pool.filter(function (c) { return nameKey(c.name) === nameKey(s); });
      if (byName.length > 1 && top != null) {
        byName = byName.filter(function (c) { return near(c.top, top) && near(c.bottom, bottom); });
      }
      if (byName.length > 1) {
        err(where + ': ' + src.fileName + ' has ' + byName.length + ' samples named "' + s + '" in ' + b +
            '. Give top_depth and bottom_depth to pick one.');
        return null;
      }
      if (byName.length === 1) {
        var c = byName[0];
        if (c.name !== s) warn(where + ': sample "' + s + '" in ' + b + ' was matched to sample "' + c.name + '" in ' + src.fileName);
        return c;
      }
      if (top == null) return null;
      var byDepth = pool.filter(function (c) {
        return c.top != null && Math.abs(c.top - top) <= 0.05 &&
               (bottom == null || c.bottom == null || Math.abs(c.bottom - bottom) <= 0.05);
      });
      if (byDepth.length === 1) {
        warn(where + ': sample "' + s + '" in ' + b + ' has no sample of that name in ' + src.fileName +
             ', so it was matched by depth to sample "' + byDepth[0].name + '" (' + fmt(byDepth[0].top) +
             (byDepth[0].bottom != null ? '-' + fmt(byDepth[0].bottom) : '') + ')');
        return byDepth[0];
      }
      return null;
    }

    function sample(where, r) {
      var b = canonicalBoring(r.boring_id, where), s = r.sample_id;
      var key = b + '\u0000' + s;
      var top = num(r.top_depth), bottom = num(r.bottom_depth);
      if (top != null && isNaN(top)) { err(where + ': top_depth "' + r.top_depth + '" is not a number'); top = null; }
      if (bottom != null && isNaN(bottom)) { err(where + ': bottom_depth "' + r.bottom_depth + '" is not a number'); bottom = null; }
      if (top != null && bottom != null && bottom < top) {
        err(where + ': bottom_depth ' + bottom + ' is above top_depth ' + top); bottom = null;
      }
      boring(b);
      var smp = ds.samples[key];
      if (!smp) {
        smp = ds.samples[key] = { key: key, boring: b, id: s, top: top, bottom: bottom,
          type: (r.sample_type || '').trim(), tests: [] };
        ds.sampleOrder.push(key);
        var match = src ? matchSourceSample(where, b, s, top, bottom) : null;
        if (match) {
          smp.sourceId = match.id;
          smp.sourceName = match.name;
          var off = function (x, y) { return x != null && y != null && Math.abs(x - y) > 0.05; };
          if (off(top, match.top) || off(bottom, match.bottom)) {
            warn(where + ': depths for ' + b + ' ' + s + ' (' + fmt(top) + (bottom != null ? '-' + fmt(bottom) : '') +
                 ') differ from the sample in ' + src.fileName + ' (' + fmt(match.top) +
                 (match.bottom != null ? '-' + fmt(match.bottom) : '') + '); the file\'s depths are used');
          }
          smp.top = match.top != null ? match.top : top;
          smp.bottom = match.top != null ? match.bottom : bottom;
          smp.fixed = true;
        }
      } else if (smp.fixed) {
        if (!smp.type && r.sample_type) smp.type = r.sample_type.trim();
      } else {
        if (smp.top == null) smp.top = top;
        else if (top != null && Math.abs(top - smp.top) > 1e-6) {
          warn(where + ': sample ' + b + ' ' + s + ' top depth ' + fmt(top) +
               ' differs from ' + fmt(smp.top) + ' given earlier; using ' + fmt(smp.top));
        }
        if (smp.bottom == null) smp.bottom = bottom;
        else if (bottom != null && Math.abs(bottom - smp.bottom) > 1e-6) {
          warn(where + ': sample ' + b + ' ' + s + ' bottom depth ' + fmt(bottom) +
               ' differs from ' + fmt(smp.bottom) + ' given earlier; using ' + fmt(smp.bottom));
        }
        if (!smp.type && r.sample_type) smp.type = r.sample_type.trim();
      }
      return smp;
    }

    function addTest(smp, kind, data) {
      var t = { kind: kind, sample: smp.key, data: data };
      smp.tests.push(t);
      ds.tests.push(t);
      return t;
    }

    // Parse all files into canonical row objects, grouped by template
    var byTemplate = {};
    files.forEach(function (f) {
      var rows = fileRows(f);
      if (rows.length < 2) {
        if (!f.sheet) warn(f.name + ': ' + (rows.length ? 'no data rows' : 'file is empty'));
        return;
      }
      var headers = rows[0].map(normHeader);
      var id = f.template || detectTemplate(f.detectName || f.name, rows[0]);
      if (!id || !TEMPLATE_BY_ID[id]) {
        if (f.sheet) warn(f.name + ': sheet not recognised, so it was ignored. Choose a template for it if it holds results.');
        else err(f.name + ': could not tell which template this file follows. Check the header row against the templates.');
        return;
      }
      var t = TEMPLATE_BY_ID[id];
      if (t.isProject) { ds.files.push({ name: f.name, template: id, rows: rows.length - 1 }); return; }
      var missing = t.columns.filter(function (c) { return c.required && headers.indexOf(c.name) < 0; });
      if (missing.length) {
        err(f.name + ': missing required column(s) ' + missing.map(function (c) { return c.name; }).join(', ') +
            ' for the ' + t.title + ' template');
        return;
      }
      var known = {};
      t.columns.forEach(function (c) { known[c.name] = true; });
      var extra = headers.filter(function (h) { return h && !known[h]; });
      if (extra.length) warn(f.name + ': ignored column(s) ' + extra.join(', '));
      var objs = [];
      for (var i = 1; i < rows.length; i++) {
        var o = { _where: f.name + ' row ' + (i + 1) };
        headers.forEach(function (h, j) {
          if (known[h] && o[h] === undefined) o[h] = (rows[i][j] == null ? '' : String(rows[i][j])).trim();
        });
        objs.push(o);
      }
      ds.files.push({ name: f.name, template: id, rows: objs.length });
      var bucket = byTemplate[id] = byTemplate[id] || [];
      objs.forEach(function (o) { bucket.push(o); });
    });

    function rowsOf(id) { return byTemplate[id] || []; }

    function keyed(r) {
      if (!r.boring_id) { err(r._where + ': boring_id is blank'); return false; }
      if (!r.sample_id) { err(r._where + ': sample_id is blank'); return false; }
      return true;
    }

    function numField(r, col, opts) {
      var v = num(r[col]);
      if (v != null && isNaN(v)) { err(r._where + ': ' + col + ' "' + r[col] + '" is not a number'); return null; }
      if (v != null && opts && opts.min != null && v < opts.min) { err(r._where + ': ' + col + ' ' + v + ' is below ' + opts.min); return null; }
      if (v != null && opts && opts.max != null && v > opts.max) { err(r._where + ': ' + col + ' ' + v + ' is above ' + opts.max); return null; }
      return v;
    }

    // borings
    rowsOf('borings').forEach(function (r) {
      if (!r.boring_id) { err(r._where + ': boring_id is blank'); return; }
      if (src) {
        // locations come from the DIGGS file; the sheet only lists the borings
        var canon = canonicalBoring(r.boring_id, r._where);
        if (!featByName[canon]) return;
        return;
      }
      var b = boring(r.boring_id);
      if (b.fromFile) warn(r._where + ': boring ' + r.boring_id + ' listed twice; using the first row');
      if (b.fromFile) return;
      b.fromFile = true;
      b.lat = numField(r, 'latitude', { min: -90, max: 90 });
      b.lon = numField(r, 'longitude', { min: -180, max: 180 });
      b.elev = numField(r, 'ground_elevation');
      b.total = numField(r, 'total_depth', { min: 0 });
      if (r.date_drilled) {
        b.date = normDate(r.date_drilled);
        if (!b.date) warn(r._where + ': date_drilled "' + r.date_drilled + '" not understood (use YYYY-MM-DD); left out');
      }
      if ((b.lat == null) !== (b.lon == null)) {
        warn(r._where + ': boring ' + b.id + ' needs both latitude and longitude; location left out');
        b.lat = b.lon = null;
      }
    });

    // Locations typed into the page override / complete borings.csv
    var typed = src ? {} : (settings.borings || {});
    Object.keys(typed).forEach(function (id) {
      var o = typed[id] || {};
      if (!ds.borings[id]) return;  // only borings that appear in the files
      var b = ds.borings[id];
      var where = 'Boring ' + id + ' (entered on the page)';
      ['lat', 'lon', 'elev', 'total'].forEach(function (k) {
        if (o[k] === undefined || o[k] === null || String(o[k]).trim() === '') return;
        var v = num(o[k]);
        if (isNaN(v)) { err(where + ': "' + o[k] + '" is not a number'); return; }
        b[k] = v;
      });
      if (o.date) {
        var dt = normDate(o.date);
        if (dt) b.date = dt; else warn(where + ': date "' + o.date + '" not understood (use YYYY-MM-DD)');
      }
    });

    rowsOf('samples').forEach(function (r) { if (keyed(r)) sample(r._where, r); });

    var single = {
      water_content: function (r) {
        var w = numField(r, 'water_content_pct', { min: 0 });
        if (w == null) return null;
        return { w: w, dryingTemp: numField(r, 'drying_temperature_c') };
      },
      atterberg_limits: function (r) {
        var np = truthy(r.non_plastic) || /^n\.?p\.?$/i.test(r.plastic_limit || '') ||
                 /^n\.?p\.?$/i.test(r.plasticity_index || '');
        var pl = /^n\.?p\.?$/i.test(r.plastic_limit || '') ? null : numField(r, 'plastic_limit', { min: 0 });
        var pi = /^n\.?p\.?$/i.test(r.plasticity_index || '') ? null : numField(r, 'plasticity_index', { min: 0 });
        var ll = /^n\.?[pv]\.?$/i.test(r.liquid_limit || '') ? null : numField(r, 'liquid_limit', { min: 0 });
        if (np) return { ll: ll, nonPlastic: true, prep: r.preparation, llMethod: r.ll_method };
        if (ll == null && pl == null) {
          err(r._where + ': Atterberg row needs liquid_limit and plastic_limit, or non_plastic = TRUE');
          return null;
        }
        if (ll == null || pl == null) {
          err(r._where + ': Atterberg row needs both liquid_limit and plastic_limit');
          return null;
        }
        var rll = Math.round(ll), rpl = Math.round(pl);
        if (rll !== ll || rpl !== pl) warn(r._where + ': Atterberg limits are reported as whole numbers; rounded');
        if (pi == null) pi = rll - rpl;
        else if (Math.round(pi) !== rll - rpl) {
          warn(r._where + ': plasticity_index ' + pi + ' is not LL - PL (' + (rll - rpl) + '); kept as reported');
        }
        return { ll: rll, pl: rpl, pi: Math.round(pi), nonPlastic: false,
                 prep: r.preparation, llMethod: r.ll_method };
      },
      wash_200: function (r) {
        var p = numField(r, 'percent_passing_200', { min: 0, max: 100 });
        return p == null ? null : { p200: p };
      },
      specific_gravity: function (r) {
        var gs = numField(r, 'specific_gravity', { min: 1, max: 5 });
        if (gs == null) return null;
        var t = numField(r, 'water_temperature_c');
        return { gs: gs, waterTemp: t == null ? 20 : t };
      },
      unit_weight: function (r) {
        var moist = numField(r, 'moist_density', { min: 0 });
        var dry = numField(r, 'dry_density', { min: 0 });
        var w = numField(r, 'water_content_pct', { min: 0 });
        if (moist == null && dry == null) return null;
        return { moist: moist, dry: dry, w: w };
      },
      organic_content: function (r) {
        var loi = numField(r, 'organic_content_pct', { min: 0, max: 100 });
        if (loi == null) return null;
        var t = numField(r, 'ignition_temperature_c');
        return { loi: loi, ignitionTemp: t == null ? 440 : t };
      }
    };

    Object.keys(single).forEach(function (kind) {
      rowsOf(kind).forEach(function (r) {
        if (!keyed(r)) return;
        var errorsBefore = ds.errors.length;
        var data = single[kind](r);
        var smp = sample(r._where, r);
        if (!data) {
          if (ds.errors.length === errorsBefore) {
            warn(r._where + ': no ' + KINDS[kind].name.toLowerCase() + ' value; row skipped');
          }
          return;
        }
        data.where = r._where;
        addTest(smp, kind, data);
      });
    });

    // corrosion: one test per filled cell
    var CORR = [['ph', 'ph', 0, 14], ['resistivity', 'resistivity_ohm_cm', 0, null],
                ['sulfate', 'sulfate_ppm', 0, null], ['chloride', 'chloride_ppm', 0, null]];
    rowsOf('corrosion').forEach(function (r) {
      if (!keyed(r)) return;
      var smp = sample(r._where, r);
      var any = false;
      CORR.forEach(function (c) {
        var v = numField(r, c[1], { min: c[2], max: c[3] });
        if (v == null) return;
        any = true;
        addTest(smp, c[0], { value: v, where: r._where });
      });
      if (!any) warn(r._where + ': no corrosion values; row skipped');
    });

    // gradation (long): group by sample + standard
    var groups = {}, groupOrder = [];
    rowsOf('gradation').forEach(function (r) {
      if (!keyed(r)) return;
      var smp = sample(r._where, r);
      var std = String(r.standard || '').toUpperCase().replace(/^ASTM\s*/, '').replace(/\s+/g, '');
      if (std && ['D422', 'D6913', 'D7928', 'D6913/D7928'].indexOf(std) < 0) {
        warn(r._where + ': standard "' + r.standard + '" not recognised; using D6913');
        std = '';
      }
      var legacy = std === 'D422';
      var gk = smp.key + '\u0000' + (legacy ? 'D422' : '');
      var g = groups[gk];
      if (!g) {
        g = groups[gk] = { smp: smp, legacy: legacy, points: [], where: r._where };
        groupOrder.push(gk);
      }
      if (r.uscs_symbol && !g.uscsSymbol) g.uscsSymbol = r.uscs_symbol.toUpperCase().replace(/\s+/g, '');
      if (r.uscs_group_name && !g.uscsName) g.uscsName = r.uscs_group_name;
      var method = String(r.method || '').toLowerCase().trim();
      if (method.indexOf('hyd') === 0 || method === 'sedimentation') method = 'hydrometer';
      else if (method.indexOf('siev') === 0 || method === '') method = 'sieve';
      else { err(r._where + ': method "' + r.method + '" must be sieve or hydrometer'); return; }
      var pass = numField(r, 'percent_passing', { min: 0, max: 100 });
      if (pass == null) {
        if (r.percent_passing === '') warn(r._where + ': percent_passing is blank; row skipped');
        return;
      }
      var size = numField(r, 'particle_size_mm', { min: 0 });
      if (size === 0) { err(r._where + ': particle_size_mm must be greater than 0'); return; }
      if (size == null && method === 'sieve') size = sieveSize(r.sieve);
      if (size == null) {
        err(r._where + ': give particle_size_mm' + (method === 'sieve' ? ' (sieve "' + r.sieve + '" is not a standard designation)' : ''));
        return;
      }
      g.points.push({ method: method, sieve: method === 'sieve' ? r.sieve : '', size: size, pass: pass, where: r._where });
    });
    groupOrder.forEach(function (gk) {
      var g = groups[gk];
      if (!g.points.length) return;
      var sieves = g.points.filter(function (p) { return p.method === 'sieve'; });
      var hydro = g.points.filter(function (p) { return p.method === 'hydrometer'; });
      var bySize = function (a, b) { return b.size - a.size; };
      sieves.sort(bySize); hydro.sort(bySize);
      var curve = sieves.concat(hydro).sort(bySize);
      for (var i = 0; i + 1 < curve.length; i++) {
        if (curve[i + 1].pass > curve[i].pass + 1e-9) {
          warn(g.where + ': percent passing rises from ' + fmt(curve[i].pass) + ' at ' + fmt(curve[i].size) +
               ' mm to ' + fmt(curve[i + 1].pass) + ' at ' + fmt(curve[i + 1].size) + ' mm for ' +
               g.smp.boring + ' ' + g.smp.id + '; check the data');
          break;
        }
      }
      addTest(g.smp, 'gradation', { legacy: g.legacy, sieves: sieves, hydro: hydro, curve: curve,
        uscsSymbol: g.uscsSymbol, uscsName: g.uscsName, where: g.where });
    });

    // compaction (long): group by sample + effort
    var cgroups = {}, corder = [];
    rowsOf('compaction').forEach(function (r) {
      if (!keyed(r)) return;
      var smp = sample(r._where, r);
      var effort = String(r.effort || '').toLowerCase().trim();
      if (/^(mod|d1557|astm ?d1557|t180)/.test(effort)) effort = 'modified';
      else if (/^(std|stan|d698|astm ?d698|t99)/.test(effort)) effort = 'standard';
      else { err(r._where + ': effort "' + r.effort + '" must be standard or modified'); return; }
      var ck = smp.key + '\u0000' + effort;
      var g = cgroups[ck];
      if (!g) { g = cgroups[ck] = { smp: smp, effort: effort, trials: [], where: r._where }; corder.push(ck); }
      var mdd = numField(r, 'max_dry_density', { min: 0 }), omc = numField(r, 'optimum_water_content', { min: 0 });
      var gs = numField(r, 'specific_gravity', { min: 1, max: 5 });
      if (mdd != null && g.mdd == null) g.mdd = mdd;
      if (omc != null && g.omc == null) g.omc = omc;
      if (gs != null && g.gs == null) g.gs = gs;
      var w = numField(r, 'water_content_pct', { min: 0 }), dd = numField(r, 'dry_density', { min: 0 });
      if (w != null && dd != null) {
        g.trials.push({ n: numField(r, 'trial'), w: w, dd: dd });
      } else if (w != null || dd != null) {
        err(r._where + ': a trial needs both water_content_pct and dry_density');
      }
    });
    corder.forEach(function (ck) {
      var g = cgroups[ck];
      g.trials.sort(function (a, b) { return a.w - b.w; });
      var fit = compactionSummary(g.trials);
      var mdd = g.mdd, omc = g.omc;
      if (mdd == null || omc == null) {
        if (fit) {
          if (mdd == null) mdd = fit.mdd;
          if (omc == null) omc = fit.omc;
        } else if (g.trials.length) {
          var peak = g.trials.reduce(function (a, b) { return b.dd > a.dd ? b : a; });
          if (mdd == null) mdd = peak.dd;
          if (omc == null) omc = peak.w;
          warn(g.where + ': could not fit a compaction curve for ' + g.smp.boring + ' ' + g.smp.id +
               ' (needs 3 or more trials with a peak inside them); reported the highest trial point instead');
        }
      }
      if (mdd == null && omc == null && !g.trials.length) {
        err(g.where + ': compaction for ' + g.smp.boring + ' ' + g.smp.id + ' has no trials and no reported maximum');
        return;
      }
      addTest(g.smp, 'compaction', { effort: g.effort, trials: g.trials, mdd: mdd, omc: omc, gs: g.gs, where: g.where });
    });

    // samples must have a depth
    ds.sampleOrder.forEach(function (k) {
      var s = ds.samples[k];
      if (s.top == null) {
        err('Sample ' + s.boring + ' ' + s.id + (src && featByName[s.boring]
          ? ' is not in ' + src.fileName + '. Give its top_depth to add it as a new sample.'
          : ' has no top_depth in any file'));
      }
    });

    // duplicates of the same test on one sample
    ds.sampleOrder.forEach(function (k) {
      var s = ds.samples[k], seen = {};
      s.tests.forEach(function (t) {
        var tag = t.kind + (t.kind === 'compaction' ? ':' + t.data.effort : '') +
                  (t.kind === 'gradation' ? ':' + t.data.legacy : '');
        if (seen[tag]) warn(t.data.where + ': a second ' + KINDS[t.kind].name.toLowerCase() +
                            ' result for ' + s.boring + ' ' + s.id + '; both are kept as separate tests');
        seen[tag] = true;
      });
      s.tests.sort(function (a, b) { return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind); });
    });

    // Derived values that need other tests on the same sample
    ds.tests.forEach(function (t) {
      var smp = ds.samples[t.sample];
      var d = t.data;
      if (t.kind === 'unit_weight') {
        var w = d.w;
        if (w == null) {
          var wc = smp.tests.filter(function (x) { return x.kind === 'water_content'; })[0];
          if (wc) d.wFromSample = wc.data.w;
        }
        var wUse = w != null ? w : d.wFromSample;
        if (d.dry == null && d.moist != null) {
          if (wUse != null) d.dryComputed = round(d.moist / (1 + wUse / 100), 1);
          else warn(d.where + ': no water content for ' + smp.boring + ' ' + smp.id +
                    ', so dry density was not computed');
        }
      }
      if (t.kind === 'gradation') {
        var att = smp.tests.filter(function (x) { return x.kind === 'atterberg_limits'; })[0];
        var plast = null;
        if (att) plast = att.data.nonPlastic ? { ll: att.data.ll, pi: 0 } : { ll: att.data.ll, pi: att.data.pi };
        d.summary = gradationSummary(d.curve, d.hydro.length > 0);
        if (d.summary.fines == null) {
          warn(d.where + ': gradation for ' + smp.boring + ' ' + smp.id +
               ' has no No. 200 (0.075 mm) point, so percent fines and USCS were not computed');
        }
        if (d.uscsSymbol) {
          if (USCS_SYMBOLS.indexOf(d.uscsSymbol) < 0) {
            warn(d.where + ': USCS symbol "' + d.uscsSymbol + '" is not an ASTM D2487 group symbol');
          }
          d.uscs = { symbol: d.uscsSymbol, name: d.uscsName || null, reported: true };
        } else if (d.summary.fines != null) {
          var u = uscs(d.summary, plast);
          if (u.symbol) d.uscs = u;
          else warn(d.where + ': USCS not computed for ' + smp.boring + ' ' + smp.id + ': ' + u.reason);
        }
      }
    });

    // borings: apply page entries for borings first seen in results files,
    // fill total depth, check location
    Object.keys(typed).forEach(function (id) {
      var b = ds.borings[id], o = typed[id] || {};
      if (!b) return;
      ['lat', 'lon', 'elev', 'total'].forEach(function (k) {
        var v = num(o[k]);
        if (v != null && !isNaN(v)) b[k] = v;
      });
      if (o.date && normDate(o.date)) b.date = normDate(o.date);
    });
    if (src) {
      // samples already in the file that get no results add nothing
      ds.sampleOrder = ds.sampleOrder.filter(function (k) {
        var smp = ds.samples[k];
        if (smp.sourceId && !smp.tests.length) { delete ds.samples[k]; return false; }
        return true;
      });
      checkAgainstSource();
      if (!ds.tests.length && !ds.errors.length) err('No test results found. Add the filled-in workbook.');
      ds.depthUnit = depthUnit;
      return ds;
    }

    function checkAgainstSource() {
      var names = src.features.map(function (f) { return f.name; });
      Object.keys(unknownBorings).forEach(function (id) {
        err(unknownBorings[id] + ': boring "' + id + '" is not in ' + src.fileName + '. Borings in the file: ' +
            (names.length > 12 ? names.slice(0, 12).join(', ') + ', ...' : names.join(', ')) + '.');
      });
      var wbUnit = settings.workbookDepthUnit;
      ds.boringOrder.forEach(function (id) {
        var f = featByName[id];
        if (!f) return;
        var used = ds.sampleOrder.some(function (k) { return ds.samples[k].boring === id && ds.samples[k].tests.length; }) ||
                   ds.sampleOrder.some(function (k) { return ds.samples[k].boring === id && !ds.samples[k].sourceId; });
        if (!used) return;
        if (!f.lrs) err('Boring ' + id + ' in ' + src.fileName + ' has no linear referencing, so results cannot be placed along it.');
        if (!f.unit) {
          err('Boring ' + id + ' in ' + src.fileName + ' measures depth in "' + (f.unitText || '?') +
              '", which this tool does not recognise (feet or meters).');
        } else if (wbUnit && wbUnit !== f.unit) {
          err('The workbook gives depths in ' + (wbUnit === 'm' ? 'meters' : 'feet') + ', but boring ' + id + ' in ' +
              src.fileName + ' is measured in ' + (f.unit === 'm' ? 'meters' : 'feet') +
              '. Enter depths in ' + (f.unit === 'm' ? 'meters' : 'feet') + ' and set depth_unit on the Project sheet to match.');
        }
        if (!f.located) warn('Boring ' + id + ' in ' + src.fileName + ' has no location; the file will not pass DIGGS validation until it has one.');
        var total = f.total != null && (!f.totalUnit || f.totalUnit === f.unit) ? f.total : null;
        ds.sampleOrder.forEach(function (k) {
          var smp = ds.samples[k];
          var deepest = smp.bottom != null ? smp.bottom : smp.top;
          if (smp.boring === id && total != null && deepest != null && deepest > total + 1e-6) {
            warn('Sample ' + id + ' ' + smp.id + ' (' + fmt(deepest) + ') is deeper than the total depth of the boring in ' +
                 src.fileName + ' (' + fmt(total) + ')');
          }
        });
      });
      ds.sampleOrder.forEach(function (k) {
        var smp = ds.samples[k];
        if (!smp.sourceId) return;
        smp.tests.forEach(function (t) {
          var proc = KINDS[t.kind].proc;
          var dup = src.tests.some(function (x) { return x.sample === smp.sourceId && x.proc === proc; });
          if (dup) {
            warn(src.fileName + ' already has a ' + testName(t.kind, t.data).toLowerCase() + ' test (' + proc + ') for ' +
                 smp.boring + ' ' + (smp.sourceName || smp.id) + '; the new result is added as a separate test');
          }
        });
      });
    }

    var noXY = [], noZ = [];
    ds.boringOrder.forEach(function (id) {
      var b = ds.borings[id];
      var maxDepth = 0;
      ds.sampleOrder.forEach(function (k) {
        var s = ds.samples[k];
        if (s.boring !== id) return;
        maxDepth = Math.max(maxDepth, s.bottom != null ? s.bottom : (s.top || 0));
      });
      if (b.total == null) { b.total = maxDepth; b.totalComputed = true; }
      else if (b.total < maxDepth) {
        warn('Boring ' + id + ': total_depth ' + fmt(b.total) + ' is shallower than its deepest sample (' +
             fmt(maxDepth) + ')');
      }
      if (b.lat != null && (b.lat < -90 || b.lat > 90)) { err('Boring ' + id + ': latitude ' + b.lat + ' is out of range'); }
      if (b.lon != null && (b.lon < -180 || b.lon > 180)) { err('Boring ' + id + ': longitude ' + b.lon + ' is out of range'); }
      if (b.lat == null || b.lon == null) noXY.push(id);
      else if (b.elev == null) noZ.push(id);
    });
    if (noXY.length) {
      err('No latitude/longitude for boring' + (noXY.length > 1 ? 's ' : ' ') + noXY.join(', ') +
          '. DIGGS requires a location for every boring. Enter it in the Borings table or in borings.csv.');
    }
    if (noZ.length) {
      warn('No ground elevation for ' + noZ.join(', ') +
           '. The file is valid DIGGS, but the online business-rule check reports one geometry error for each of these borings. Add the elevation to clear it.');
    }
    if (!ds.tests.length && !ds.errors.length) err('No test results found. Add at least one results file.');
    ds.depthUnit = depthUnit;
    return ds;
  }

  // ---------------------------------------------------------------------
  // XML writer
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // XML 1.0 forbids most control characters
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  }

  function E(tag, attrs, children) {
    if (!Array.isArray(children) && children !== undefined && children !== null && typeof children !== 'object') {
      children = String(children);
    }
    return { tag: tag, attrs: attrs || {}, children: children };
  }

  function serialize(node, indent, out) {
    var pad = new Array(indent + 1).join('  ');
    var attrs = '';
    Object.keys(node.attrs).forEach(function (k) {
      if (node.attrs[k] !== undefined && node.attrs[k] !== null) attrs += ' ' + k + '="' + esc(node.attrs[k]) + '"';
    });
    var ch = node.children;
    if (ch === undefined || ch === null || (Array.isArray(ch) && !ch.filter(Boolean).length)) {
      out.push(pad + '<' + node.tag + attrs + '/>');
    } else if (typeof ch === 'string') {
      out.push(pad + '<' + node.tag + attrs + '>' + esc(ch) + '</' + node.tag + '>');
    } else {
      out.push(pad + '<' + node.tag + attrs + '>');
      (Array.isArray(ch) ? ch : [ch]).forEach(function (c) { if (c) serialize(c, indent + 1, out); });
      out.push(pad + '</' + node.tag + '>');
    }
  }

  function specList(kind, d) {
    if (kind === 'water_content') return ['D2216'];
    if (kind === 'atterberg_limits') return ['D4318'];
    if (kind === 'wash_200') return ['D1140'];
    if (kind === 'gradation') {
      var l = d.legacy ? ['D422'] : ['D6913'].concat(d.hydro.length ? ['D7928'] : []);
      if (d.uscs) l.push('D2487');
      return l;
    }
    if (kind === 'specific_gravity') return ['D854'];
    if (kind === 'unit_weight') return ['D7263'];
    if (kind === 'organic_content') return ['D2974'];
    if (kind === 'compaction') return [d.effort === 'modified' ? 'D1557' : 'D698'];
    return [{ ph: 'G51', resistivity: 'G187', sulfate: 'C1580', chloride: 'D4327' }[kind]];
  }

  function testName(kind, d) {
    if (kind === 'compaction') return d.effort === 'modified' ? 'Modified Proctor' : 'Standard Proctor';
    if (kind === 'gradation' && d.legacy) return 'Gradation (D422)';
    return KINDS[kind].name;
  }

  /** (code, propertyName, typeData, uom, value) rows for a test's outcome. */
  function results(kind, d, densityUnit) {
    var R = function (code, name, type, uom, value) { return { code: code, name: name, type: type, uom: uom, value: value }; };
    switch (kind) {
      case 'water_content': return [R('water_content_natural', 'Moisture Content', 'double', '%', d.w)];
      case 'atterberg_limits':
        if (d.nonPlastic) {
          var np = [];
          if (d.ll != null) np.push(R('liquid_limit', 'Liquid Limit', 'integer', null, Math.round(d.ll)));
          np.push(R('non_plastic', 'Non Plastic', 'boolean', null, 'true'));
          return np;
        }
        return [R('liquid_limit', 'Liquid Limit', 'integer', null, d.ll),
                R('plastic_limit', 'Plastic Limit', 'integer', null, d.pl),
                R('plasticity_index', 'Plasticity Index', 'integer', null, d.pi)];
      case 'wash_200': return [R('percent_fines', 'Percent Passing No. 200 Sieve', 'double', '%', d.p200)];
      case 'gradation':
        var g = d.summary, rows = [];
        if (g.gravel != null) rows.push(R('percent_gravel', 'Percent Gravel', 'double', '%', g.gravel),
                                        R('percent_sand', 'Percent Sand', 'double', '%', g.sand));
        if (g.silt != null) rows.push(R('percent_silt', 'Percent Silt', 'double', '%', g.silt),
                                      R('clay_percent_2_micron', 'Percent Clay (< 2 um)', 'double', '%', g.clay));
        if (g.fines != null) rows.push(R('percent_fines', 'Percent Fines', 'double', '%', g.fines));
        [10, 30, 50, 60].forEach(function (p) {
          if (g['d' + p] != null) rows.push(R('d' + p, 'D' + p, 'double', 'mm', g['d' + p]));
        });
        if (g.cu != null) rows.push(R('coef_uniformity', 'Coefficient of Uniformity', 'double', null, g.cu),
                                    R('coef_curvature', 'Coefficient of Curvature', 'double', null, g.cc));
        if (d.uscs) {
          rows.push(R('uscs_symbol', 'USCS Group Symbol', 'string', null, d.uscs.symbol));
          if (d.uscs.name) rows.push(R('uscs_group_name', 'USCS Group Name', 'string', null, d.uscs.name));
        }
        return rows;
      case 'specific_gravity': return [R('specific_gravity_solids', 'Specific Gravity of Solids', 'double', null, d.gs)];
      case 'unit_weight':
        var u = [];
        // the published dictionary has no unit_weight code for lab tests;
        // bulk_density carries the moist value
        if (d.moist != null) u.push(R('bulk_density', 'Moist Density', 'double', densityUnit, d.moist));
        var dry = d.dry != null ? d.dry : d.dryComputed;
        if (dry != null) u.push(R('dry_density', 'Dry Density', 'double', densityUnit, dry));
        if (d.w != null) u.push(R('water_content_natural', 'Moisture Content', 'double', '%', d.w));
        return u;
      case 'organic_content': return [R('LOI', 'Organic Content (Loss on Ignition)', 'double', '%', d.loi)];
      case 'compaction':
        var c = [];
        if (d.mdd != null) c.push(R('dry_density_max', 'Maximum Dry Density', 'double', densityUnit, d.mdd));
        if (d.omc != null) c.push(R('water_content_optimum', 'Optimum Water Content', 'double', '%', d.omc));
        if (d.gs != null) c.push(R('specific_gravity_solids', 'Specific Gravity of Solids', 'double', null, d.gs));
        return c;
      case 'ph': return [R('pH', 'pH', 'double', null, d.value)];
      case 'resistivity': return [R('resistivity', 'Minimum Resistivity', 'double', 'ohm.cm', d.value)];
      case 'sulfate': return [R('sulfate_content', 'Water-Soluble Sulfate', 'double', 'ppm', d.value)];
      case 'chloride': return [R('chloride_content', 'Water-Soluble Chloride', 'double', 'ppm', d.value)];
    }
    throw new Error('unknown test kind ' + kind);
  }

  function fmtValue(r) {
    if (r.type === 'integer') return String(Math.round(r.value));
    if (r.type === 'string' || r.type === 'boolean') return String(r.value);
    return fmt(r.value);
  }

  function procedureDetails(kind, d, tid, uid, densityUnit) {
    var out = [];
    if (kind === 'water_content') {
      if (d.dryingTemp != null) out.push(E('dryingTemperature', { uom: 'degC' }, fmt(d.dryingTemp)));
    } else if (kind === 'atterberg_limits') {
      var prep = String(d.prep || '').toLowerCase().trim();
      if (prep === 'wet' || prep === 'dry') out.push(E('sieveProcedure', {}, prep));
      var m = String(d.llMethod || '').toLowerCase().replace(/[^a-z]/g, '');
      if (m === 'multipoint' || m === 'onepoint' || m === 'singlepoint') {
        out.push(E('multiPointLLmethod', {}, m === 'multipoint' ? 'true' : 'false'));
      }
    } else if (kind === 'wash_200') {
      out.push(E('sieveAnalysis', {}, E('SieveAnalysis', { 'gml:id': uid('SV_' + tid) }, [
        E('coarseFractionWetSieved', {}, 'true'),
        E('gradingData', {}, E('Grading', { 'gml:id': uid('GR_' + tid + '_1') }, [
          E('particleSize', { uom: 'mm' }, '0.075'),
          E('sieveNumber', {}, 'No. 200'),
          E('percentPassing', { uom: '%' }, fmt(d.p200))
        ]))
      ])));
    } else if (kind === 'gradation') {
      var n = 0;
      if (d.sieves.length) {
        var rows = [E('coarseFractionWetSieved', {}, 'true')];
        d.sieves.forEach(function (p) {
          n++;
          rows.push(E('gradingData', {}, E('Grading', { 'gml:id': uid('GR_' + tid + '_' + n) }, [
            E('particleSize', { uom: 'mm' }, fmt(p.size)),
            p.sieve ? E('sieveNumber', {}, p.sieve) : null,
            E('percentPassing', { uom: '%' }, fmt(p.pass))
          ])));
        });
        out.push(E('sieveAnalysis', {}, E('SieveAnalysis', { 'gml:id': uid('SV_' + tid) }, rows)));
      }
      if (d.hydro.length) {
        var sed = [];
        d.hydro.forEach(function (p) {
          n++;
          sed.push(E('sedimentationData', {}, E('Sedimentation', { 'gml:id': uid('SED_' + tid + '_' + n) }, [
            E('particleDiameter', { uom: 'mm' }, fmt(p.size)),
            E('percentPassing', { uom: '%' }, fmt(p.pass))
          ])));
        });
        out.push(E('hydrometer', {}, E('Hydrometer', { 'gml:id': uid('HY_' + tid) }, sed)));
      }
    } else if (kind === 'specific_gravity') {
      out.push(E('waterTemperature', { uom: 'degC' }, fmt(d.waterTemp)));
    } else if (kind === 'organic_content') {
      out.push(E('ignitionTemperature', { uom: 'degC' }, fmt(d.ignitionTemp)));
    } else if (kind === 'compaction') {
      out.push(E('compactionTestType', {}, d.effort === 'modified' ? 'Modified Proctor' : 'Proctor'));
      d.trials.forEach(function (t, i) {
        var no = t.n != null && t.n > 0 && Math.round(t.n) === t.n ? t.n : i + 1;
        out.push(E('trial', {}, E('LabCompactionTestTrial', { 'gml:id': uid('TRL_' + tid + '_' + (i + 1)) }, [
          E('trialNo', {}, String(no)),
          E('waterContent', { uom: '%' }, fmt(t.w)),
          E('dryDensity', { uom: densityUnit }, fmt(t.dd))
        ])));
      });
    }
    return out;
  }

  var NS_GML = 'http://www.opengis.net/gml/3.2';
  var NS_XLINK = 'http://www.w3.org/1999/xlink';
  var NS_GLR = 'http://www.opengis.net/gml/3.3/lr';
  var LAB_PREFIX = 'LAB_';
  var LAB_AUDIT_MARK = 'Laboratory results added by Lab Results to DIGGS';

  function makeUid(reserved, prefix) {
    var used = {};
    Object.keys(reserved || {}).forEach(function (k) { used[k] = true; });
    return function uid(raw) {
      var base = safeId((prefix || '') + raw), id = base, i = 2;
      while (used[id]) id = base + '_' + (i++);
      used[id] = true;
      return id;
    };
  }

  /**
   * SamplingActivity/Sample/Test elements for a dataset.
   * ctx: {uid, projectId, bh: {boring: {id, lrs}}, densityUnit}
   * Samples matched to an existing Sample (s.sourceId) get no new records;
   * their tests point at the existing one.
   */
  function labFragments(ds, ctx) {
    var uid = ctx.uid, projectId = ctx.projectId, densityUnit = ctx.densityUnit;
    var activities = [], samples = [], measurements = [];
    ds.sampleOrder.forEach(function (k) {
      var s = ds.samples[k];
      if (s.top == null) return;
      var b = ctx.bh[s.boring];
      if (!b) return;
      var smpId = s.sourceId;
      if (!smpId) {
        var saId = uid('SA_' + s.boring + '_' + s.id), spId = uid('SP_' + s.boring + '_' + s.id);
        smpId = uid('SMP_' + s.boring + '_' + s.id);
        var isPoint = s.bottom == null || Math.abs(s.bottom - s.top) < 1e-9;
        var loc = function (idBase) {
          if (idBase.indexOf(LAB_PREFIX) === 0) idBase = idBase.slice(LAB_PREFIX.length);
          return isPoint
            ? E('PointLocation', { 'gml:id': uid('PL_' + idBase), srsDimension: '1', srsName: '#' + b.lrs },
                E('gml:pos', {}, fmt(s.top)))
            : E('LinearExtent', { 'gml:id': uid('LE_' + idBase), srsDimension: '1', srsName: '#' + b.lrs },
                E('gml:posList', {}, fmt(s.top) + ' ' + fmt(s.bottom)));
        };
        activities.push(E('samplingActivity', {}, E('SamplingActivity', { 'gml:id': saId }, [
          E('gml:name', {}, 'Sampling of ' + s.boring + ' ' + s.id + (s.type ? ' (' + s.type + ')' : '')),
          E('investigationTarget', {}, 'Natural Ground'),
          E('projectRef', { 'xlink:href': '#' + projectId }),
          E('samplingFeatureRef', { 'xlink:href': '#' + b.id }),
          E('samplingLocation', {}, loc(saId)),
          E('activityType', {}, 'collect'),
          // Sample requires a sampleProducedRef to this record
          E('sampleProduced', {}, E('SampleProduced', { 'gml:id': spId }, E('location', {}, loc(spId))))
        ])));
        samples.push(E('sample', {}, E('Sample', { 'gml:id': smpId }, [
          E('gml:name', {}, s.id),
          E('projectRef', { 'xlink:href': '#' + projectId }),
          E('samplingActivityRef', { 'xlink:href': '#' + saId }),
          E('sampleProducedRef', { 'xlink:href': '#' + spId }),
          E('classification', {}, 'Soil')
        ])));
      }

      s.tests.forEach(function (t) {
        var d = t.data;
        var rows = results(t.kind, d, densityUnit);
        if (!rows.length) return;
        var tid = uid('T_' + s.boring + '_' + s.id + '_' + t.kind);
        // child ids derive from the test id; drop the merge prefix so it is not repeated
        var tkey = tid.indexOf(LAB_PREFIX) === 0 ? tid.slice(LAB_PREFIX.length) : tid;
        var props = rows.map(function (r, i) {
          return E('Property', { index: String(i + 1), 'gml:id': uid('P_' + tkey + '_' + (i + 1)) }, [
            E('propertyName', {}, r.name),
            E('typeData', {}, r.type),
            E('propertyClass', { codeSpace: PROPS + '#' + r.code }, r.code),
            r.uom ? E('uom', {}, r.uom) : null
          ]);
        });
        var specs = specList(t.kind, d).map(function (a, i) {
          return E('testProcedureMethod', {}, E('Specification', { 'gml:id': uid('SPEC_' + tkey + '_' + (i + 1)) }, [
            E('accredtingBody', {}, 'ASTM'), // (sic) schema spelling
            E('standardReferenceNumber', {}, a),
            E('standardTitle', {}, SPECS[a])
          ]));
        });
        measurements.push(E('measurement', {}, E('Test', { 'gml:id': tid }, [
          E('gml:name', {}, testName(t.kind, d) + ' — ' + s.boring + ' ' + (s.sourceName || s.id)),
          E('investigationTarget', {}, 'Natural Ground'),
          E('projectRef', { 'xlink:href': '#' + projectId }),
          E('samplingFeatureRef', { 'xlink:href': '#' + b.id }),
          E('sampleRef', { 'xlink:href': '#' + smpId }),
          E('outcome', {}, E('TestResult', { 'gml:id': uid('TR_' + tkey) }, [
            E('location', {}, E('PointLocation', { 'gml:id': uid('PL_' + tkey), srsDimension: '1', srsName: '#' + b.lrs },
              E('gml:pos', {}, fmt(s.top)))),
            E('results', {}, E('ResultSet', {}, [
              E('parameters', {}, E('PropertyParameters', { 'gml:id': uid('PP_' + tkey) }, E('properties', {}, props))),
              // ";" between tuples: text results (USCS group names) contain spaces
              E('dataValues', { cs: ',', ts: ';', decimal: '.' }, rows.map(fmtValue).join(','))
            ]))
          ])),
          E('procedure', {}, E(KINDS[t.kind].proc, { 'gml:id': uid('PR_' + tkey) },
            specs.concat(procedureDetails(t.kind, d, tkey, uid, densityUnit))))
        ])));
      });
    });
    return { activities: activities, samples: samples, measurements: measurements };
  }

  function densityUnitOf(settings) {
    return DENSITY_UNITS[settings.densityUnit] ? settings.densityUnit : 'lbm/ft3';
  }

  /** Build a complete DIGGS 3.0 file for a dataset (no starting DIGGS file). */
  function generateDiggs(ds, settings) {
    var depthUnit = ds.depthUnit || 'ft';
    var uid = makeUid();
    var today = settings.today || new Date().toISOString().slice(0, 10);
    var projectId = uid('Project_1');
    var root = [];

    root.push(E('documentInformation', {}, E('DocumentInformation', { 'gml:id': uid('DocumentInfo') }, [
      E('creationDate', {}, today),
      E('auditTrail', {}, E('Remark', {}, E('content', {},
        'Generated from laboratory result tables by the Geosetta Lab Results to DIGGS tool' +
        (settings.toolVersion ? ' (version ' + settings.toolVersion + ')' : ''))))
    ])));

    var roles = [];
    function role(code, name) {
      roles.push(E('role', {}, E('Role', {}, [
        E('rolePerformed', { codeSpace: ROLES + '#' + code }, code),
        E('businessAssociate', {}, E('BusinessAssociate', { 'gml:id': uid('BA_' + code + '_' + name) },
          E('gml:name', {}, name)))
      ])));
    }
    if (settings.client) role('client', settings.client);
    // "preparer" is the only provider-type role the dictionary allows on a Project
    if (settings.labName) role('preparer', settings.labName);
    root.push(E('project', {}, E('Project', { 'gml:id': projectId }, [
      settings.projectNumber ? E('gml:description', {}, 'Project number: ' + settings.projectNumber) : null,
      E('gml:name', {}, settings.projectName || 'Laboratory testing')
    ].concat(roles))));

    var bh = {};
    ds.boringOrder.forEach(function (id) {
      var b = ds.borings[id];
      var bhId = uid('BH_' + id), lrsId = uid('lrs_' + id), leId = uid('LE_' + id);
      bh[id] = { id: bhId, lrs: lrsId };
      var kids = [E('gml:name', {}, id), E('investigationTarget', {}, 'Natural Ground'),
                  E('projectRef', { 'xlink:href': '#' + projectId })];
      var hasXY = b.lat != null && b.lon != null, hasZ = b.elev != null;
      var crs = compoundCrs(depthUnit), labels = 'dega dega ' + depthUnit;
      if (hasXY) {
        // EPSG:4326 axis order is latitude, longitude
        kids.push(E('referencePoint', {}, E('PointLocation', hasZ
          ? { 'gml:id': uid('pl_' + id), srsDimension: '3', srsName: crs, uomLabels: labels }
          : { 'gml:id': uid('pl_' + id), srsDimension: '2', srsName: EPSG + '4326', uomLabels: 'dega dega' },
          E('gml:pos', {}, hasZ ? fmt(b.lat) + ' ' + fmt(b.lon) + ' ' + fmt(b.elev) : fmt(b.lat) + ' ' + fmt(b.lon)))));
      }
      if (hasXY && hasZ) {
        // centerLine as lon lat elev, matching core/vlm_to_diggs.py
        kids.push(E('centerLine', {}, E('LinearExtent',
          { 'gml:id': leId, srsDimension: '3', srsName: crs, uomLabels: labels },
          E('gml:posList', {}, [fmt(b.lon), fmt(b.lat), fmt(b.elev), fmt(b.lon), fmt(b.lat),
                                fmt(round(b.elev - b.total, 6))].join(' ')))));
      } else {
        kids.push(E('centerLine', {}, E('LinearExtent', { 'gml:id': leId, srsDimension: '1' },
          E('gml:posList', {}, '0 ' + fmt(b.total)))));
      }
      kids.push(E('linearReferencing', {}, E('LinearSpatialReferenceSystem', { 'gml:id': lrsId }, [
        E('gml:identifier', { codeSpace: '' }),
        E('glr:linearElement', { 'xlink:href': '#' + leId }),
        E('glr:lrm', {}, E('glr:LinearReferencingMethod', { 'gml:id': uid(leId + '_lrm') }, [
          E('glr:name', {}, 'chainage'), E('glr:type', {}, 'absolute'), E('glr:units', {}, depthUnit)
        ]))
      ])));
      if (b.date) {
        kids.push(E('whenConstructed', {}, E('TimeInterval', { 'gml:id': uid('time_' + id) },
          [E('start', {}, b.date), E('end', {}, b.date)])));
      }
      kids.push(E('totalMeasuredDepth', { uom: depthUnit }, fmt(b.total)));
      root.push(E('samplingFeature', {}, E('Borehole', { 'gml:id': bhId }, kids)));
    });

    var frag = labFragments(ds, { uid: uid, projectId: projectId, bh: bh, densityUnit: densityUnitOf(settings) });
    root = root.concat(frag.activities, frag.samples, frag.measurements);
    var doc = E('Diggs', {
      xmlns: NS_DIGGS,
      'xmlns:glr': NS_GLR,
      'xmlns:gml': NS_GML,
      'xmlns:xlink': NS_XLINK,
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation': NS_DIGGS + ' https://diggsml.org/schema-dev/Diggs.xsd',
      'gml:id': 'Lab_Results'
    }, root);
    var out = ['<?xml version="1.0" encoding="UTF-8"?>'];
    serialize(doc, 0, out);
    return out.join('\n') + '\n';
  }

  // ---------------------------------------------------------------------
  // Reading an existing DIGGS file and merging lab results into it
  // ---------------------------------------------------------------------

  function decodeEntities(s) {
    return String(s).replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, function (m, e) {
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'amp') return '&';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      return String.fromCodePoint(e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
  }

  function lineOf(text, pos) { return text.slice(0, pos).split('\n').length; }

  /**
   * A small namespace-aware XML parser that keeps source offsets, so a
   * merge can insert text without re-serialising (and so without changing)
   * the original file. Elements: {local, ns, attrs: [{local, ns, value}],
   * children, text, start, end, contentStart, contentEnd, parent}.
   * DTDs are refused.
   */
  function parseXml(text) {
    var n = text.length, i = 0, stack = [], root = null;
    var nameRe = /<([^\s\/>]+)/y;
    var attrRe = /\s*([^\s=\/>]+)\s*=\s*("[^"]*"|'[^']*')/y;
    var endRe = /\s*(\/?)>/y;
    function fail(msg, at) { throw new Error(msg + ' (line ' + lineOf(text, at) + ')'); }
    function resolve(prefix, nsmap, isAttr) {
      if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace';
      if (!prefix) return isAttr ? '' : (nsmap[''] || '');
      if (!(prefix in nsmap)) fail('undeclared namespace prefix "' + prefix + '"', i);
      return nsmap[prefix];
    }
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    while (i < n) {
      var lt = text.indexOf('<', i);
      if (lt < 0) lt = n;
      if (lt > i) {
        if (stack.length) stack[stack.length - 1].text += decodeEntities(text.slice(i, lt));
        else if (text.slice(i, lt).trim()) fail('text outside the root element', i);
        i = lt;
        if (i >= n) break;
      }
      if (text.startsWith('<?', i)) {
        var pe = text.indexOf('?>', i);
        if (pe < 0) fail('unterminated processing instruction', i);
        i = pe + 2;
      } else if (text.startsWith('<!--', i)) {
        var ce = text.indexOf('-->', i + 4);
        if (ce < 0) fail('unterminated comment', i);
        i = ce + 3;
      } else if (text.startsWith('<![CDATA[', i)) {
        var de = text.indexOf(']]>', i);
        if (de < 0 || !stack.length) fail('bad CDATA section', i);
        stack[stack.length - 1].text += text.slice(i + 9, de);
        i = de + 3;
      } else if (text.startsWith('<!', i)) {
        fail('files with a DOCTYPE are not supported', i);
      } else if (text.startsWith('</', i)) {
        var ge = text.indexOf('>', i);
        if (ge < 0) fail('unterminated end tag', i);
        var qn = text.slice(i + 2, ge).trim();
        var open = stack.pop();
        if (!open || open.qname !== qn) fail('mismatched end tag </' + qn + '>', i);
        open.contentEnd = i;
        open.end = ge + 1;
        i = ge + 1;
      } else {
        nameRe.lastIndex = i;
        var m = nameRe.exec(text);
        if (!m) fail('malformed tag', i);
        var el = { qname: m[1], attrs: [], children: [], text: '', start: i,
                   parent: stack.length ? stack[stack.length - 1] : null };
        var p = nameRe.lastIndex, rawAttrs = [];
        for (;;) {
          attrRe.lastIndex = p;
          var am = attrRe.exec(text);
          if (!am) break;
          rawAttrs.push([am[1], decodeEntities(am[2].slice(1, -1))]);
          p = attrRe.lastIndex;
        }
        endRe.lastIndex = p;
        var em = endRe.exec(text);
        if (!em) fail('malformed start tag <' + m[1] + '>', i);
        var nsmap = Object.create(el.parent ? el.parent.nsmap : null);
        rawAttrs.forEach(function (a) {
          if (a[0] === 'xmlns') nsmap[''] = a[1];
          else if (a[0].indexOf('xmlns:') === 0) nsmap[a[0].slice(6)] = a[1];
        });
        el.nsmap = nsmap;
        var colon = m[1].indexOf(':');
        el.local = colon < 0 ? m[1] : m[1].slice(colon + 1);
        el.ns = resolve(colon < 0 ? '' : m[1].slice(0, colon), nsmap, false);
        rawAttrs.forEach(function (a) {
          if (a[0] === 'xmlns' || a[0].indexOf('xmlns:') === 0) return;
          var c = a[0].indexOf(':');
          el.attrs.push({ local: c < 0 ? a[0] : a[0].slice(c + 1),
                          ns: resolve(c < 0 ? '' : a[0].slice(0, c), nsmap, true), value: a[1] });
        });
        if (el.parent) el.parent.children.push(el);
        else if (root) fail('more than one root element', i);
        else root = el;
        i = endRe.lastIndex;
        el.contentStart = i;
        if (em[1]) { el.contentEnd = el.start; el.end = i; el.selfClosing = true; }
        else stack.push(el);
      }
    }
    if (stack.length) fail('unclosed element <' + stack[stack.length - 1].qname + '>', n);
    if (!root) throw new Error('no XML element found');
    return root;
  }

  function kids(el, ns, local) {
    return el ? el.children.filter(function (c) { return c.ns === ns && (!local || c.local === local); }) : [];
  }
  function kid(el, ns, local) { return kids(el, ns, local)[0] || null; }
  function firstElement(el) { return el && el.children.length ? el.children[0] : null; }
  function attrOf(el, ns, local) {
    if (!el) return null;
    for (var i = 0; i < el.attrs.length; i++) {
      if (el.attrs[i].ns === ns && el.attrs[i].local === local) return el.attrs[i].value;
    }
    return null;
  }
  function textOf(el) { return el ? el.text.trim() : ''; }
  function hrefId(el) {
    var h = attrOf(el, NS_XLINK, 'href');
    return h ? h.replace(/^.*#/, '') : null;
  }
  function descend(el, ns, local, out) {
    out = out || [];
    if (!el) return out;
    el.children.forEach(function (c) {
      if (c.ns === ns && c.local === local) out.push(c);
      descend(c, ns, local, out);
    });
    return out;
  }
  function numbers(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean).map(Number);
  }
  function depthUnitCode(u) {
    u = String(u || '').trim().toLowerCase();
    if (/^(ft|foot|feet|us-ft|ft\[us\])$/.test(u)) return 'ft';
    if (/^(m|meter|meters|metre|metres)$/.test(u)) return 'm';
    return null;
  }

  var FEATURE_KINDS = { Borehole: 'boring', TrialPit: 'test pit' };

  /** Everything the merge needs to know about a DIGGS 3 file. */
  function readDiggs(text, fileName) {
    text = String(text);
    var root;
    try { root = parseXml(text); } catch (e) { throw new Error('not a readable XML file: ' + e.message); }
    if (root.local !== 'Diggs') throw new Error('this XML file is not a DIGGS file (its root element is <' + root.local + '>)');
    if (root.ns !== NS_DIGGS) {
      throw new Error('this is not a DIGGS 3 file (namespace "' + root.ns + '"). Convert it to DIGGS 3 first.');
    }
    var D = NS_DIGGS;
    var info = { fileName: fileName || 'DIGGS file', text: text, root: root, ids: {}, features: [],
                 featureById: {}, samples: [], sampleById: {}, tests: [], labBlocks: [], labTests: 0,
                 labAudits: [], unusable: [] };
    (function walk(el) {
      var id = attrOf(el, NS_GML, 'id');
      if (id) info.ids[id] = true;
      el.children.forEach(walk);
    })(root);

    var project = firstElement(kid(root, D, 'project'));
    if (!project) throw new Error('the DIGGS file has no project, so results cannot be linked to it');
    info.projectId = attrOf(project, NS_GML, 'id');
    info.projectName = textOf(kid(project, NS_GML, 'name'));
    info.docInfo = firstElement(kid(root, D, 'documentInformation'));

    kids(root, D, 'samplingFeature').forEach(function (wrap) {
      var f = firstElement(wrap);
      if (!f || f.ns !== D) return;
      var name = textOf(kid(f, NS_GML, 'name'));
      if (!FEATURE_KINDS[f.local]) { if (name) info.unusable.push(name + ' (' + f.local + ')'); return; }
      var feat = { name: name, id: attrOf(f, NS_GML, 'id'), kind: FEATURE_KINDS[f.local], element: f.local };
      var lrs = descend(kid(f, D, 'linearReferencing'), D, 'LinearSpatialReferenceSystem')[0];
      feat.lrs = lrs ? attrOf(lrs, NS_GML, 'id') : null;
      var units = descend(lrs, NS_GLR, 'units')[0];
      feat.unitText = textOf(units);
      feat.unit = depthUnitCode(feat.unitText);
      var pl = firstElement(kid(f, D, 'referencePoint'));
      if (pl) {
        var posEl = kid(pl, NS_GML, 'pos');
        // srsName may sit on the geometry or on gml:pos itself
        var srs = attrOf(pl, '', 'srsName') || attrOf(posEl, '', 'srsName') || '';
        var pos = numbers(textOf(posEl));
        feat.crs = srs;
        // EPSG:4326 (alone or as the horizontal part of a compound CRS) is latitude, longitude
        if (/4326/.test(srs) && pos.length >= 2) {
          feat.lat = pos[0]; feat.lon = pos[1];
          if (pos.length >= 3) feat.elev = pos[2];
        }
        feat.located = pos.length >= 2;
      }
      var tmd = kid(f, D, 'totalMeasuredDepth');
      if (tmd) {
        feat.total = num(textOf(tmd));
        feat.totalUnit = depthUnitCode(attrOf(tmd, '', 'uom'));
      }
      var when = kid(f, D, 'whenConstructed');
      if (when) {
        var st = descend(when, D, 'start')[0] || descend(when, NS_GML, 'beginPosition')[0] ||
                 descend(when, NS_GML, 'timePosition')[0];
        feat.date = st ? textOf(st).slice(0, 10) : '';
        feat.constructed = true;
      }
      if (feat.id && feat.name) { info.features.push(feat); info.featureById[feat.id] = feat; }
    });

    var activityById = {};
    kids(root, D, 'samplingActivity').forEach(function (wrap) {
      var a = firstElement(wrap);
      if (!a) return;
      var locEl = firstElement(kid(a, D, 'samplingLocation'));
      var vals = [];
      if (locEl) {
        vals = numbers(textOf(kid(locEl, NS_GML, 'posList')) || textOf(kid(locEl, NS_GML, 'pos')));
      }
      activityById[attrOf(a, NS_GML, 'id')] = {
        feature: hrefId(kid(a, D, 'samplingFeatureRef')),
        top: vals.length ? vals[0] : null,
        bottom: vals.length > 1 ? vals[vals.length - 1] : null
      };
    });

    kids(root, D, 'sample').forEach(function (wrap) {
      var smp = firstElement(wrap);
      if (!smp || smp.local !== 'Sample') return;
      var act = activityById[hrefId(kid(smp, D, 'samplingActivityRef'))];
      var feat = act ? info.featureById[act.feature] : null;
      if (!feat) return;
      var rec = { id: attrOf(smp, NS_GML, 'id'), name: textOf(kid(smp, NS_GML, 'name')), boring: feat.name,
                  top: act.top, bottom: act.bottom };
      rec.lab = rec.id.indexOf(LAB_PREFIX) === 0;  // added by an earlier run of this tool
      info.samples.push(rec);
      info.sampleById[rec.id] = rec;
    });

    root.children.forEach(function (wrap) {
      var inner = firstElement(wrap);
      var id = attrOf(inner, NS_GML, 'id') || '';
      if (id.indexOf(LAB_PREFIX) === 0) {
        info.labBlocks.push(wrap);
        if (wrap.local === 'measurement') info.labTests++;
        return;
      }
      if (wrap.ns === D && wrap.local === 'measurement' && inner) {
        var proc = firstElement(kid(inner, D, 'procedure'));
        var refs = descend(inner, D, 'sampleRef').map(hrefId);
        refs.forEach(function (r) { info.tests.push({ sample: r, proc: proc ? proc.local : '' }); });
      }
    });
    kids(info.docInfo, D, 'auditTrail').forEach(function (at) {
      var content = descend(at, D, 'content')[0];
      if (content && textOf(content).indexOf(LAB_AUDIT_MARK) === 0) info.labAudits.push(at);
    });

    var units = {};
    info.features.forEach(function (f) { if (f.unit) units[f.unit] = true; });
    info.depthUnit = Object.keys(units).length === 1 ? Object.keys(units)[0] : null;
    info.allConstructed = info.features.length > 0 && info.features.every(function (f) { return f.constructed; });
    return info;
  }

  /** Short description of a loaded DIGGS file for the page. */
  function describeSource(info) {
    var located = info.features.filter(function (f) { return f.located; }).length;
    return { project: info.projectName, borings: info.features.length, located: located,
             samples: info.samples.filter(function (s) { return !s.lab; }).length, labTests: info.labTests, depthUnit: info.depthUnit,
             allConstructed: info.allConstructed, unusable: info.unusable,
             names: info.features.map(function (f) { return f.name; }) };
  }

  /** Borings and Samples sheet rows for a workbook prepared from a DIGGS file. */
  function sourceSeed(info) {
    var unitWord = { ft: 'feet', m: 'meters' };
    return {
      sourceFile: info.fileName,
      projectName: info.projectName,
      depthUnit: unitWord[info.depthUnit] || '',
      borings: info.features.map(function (f) {
        return [f.name, f.lat != null ? fmt(f.lat) : '', f.lon != null ? fmt(f.lon) : '',
                f.elev != null ? fmt(f.elev) : '', f.total != null ? fmt(f.total) : '', f.date || ''];
      }),
      samples: info.samples.filter(function (s) { return !s.lab; }).map(function (s) {
        return [s.boring, s.name, s.top != null ? fmt(s.top) : '', s.bottom != null ? fmt(s.bottom) : '', ''];
      })
    };
  }

  // name keys: case, spaces and punctuation ignored, leading zeros in numbers dropped
  function nameKey(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')
      .replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').trim()
      .replace(/\b0+(\d)/g, '$1').replace(/ /g, '');
  }

  /**
   * Insert a dataset into the DIGGS file it was matched against.
   * settings.boringStatus: 'as drilled' | 'proposed'
   * settings.previousLab: 'replace' (default) | 'keep'
   */
  function mergeDiggs(info, ds, settings) {
    var text = info.text, root = info.root, D = NS_DIGGS;
    var replace = settings.previousLab !== 'keep';
    var edits = [];  // {at, del, ins, seq}
    var nl = /\r\n/.test(text.slice(0, 2000)) ? '\r\n' : '\n';
    function edit(at, del, ins) { edits.push({ at: at, del: del, ins: ins, seq: edits.length }); }
    var removed = {};

    function lineStart(pos) {
      var j = pos;
      while (j > 0 && (text[j - 1] === ' ' || text[j - 1] === '\t')) j--;
      if (j > 0 && text[j - 1] === '\n') return (j > 1 && text[j - 2] === '\r') ? j - 2 : j - 1;
      return pos;
    }
    function remove(el) {
      var from = lineStart(el.start);
      edit(from, el.end - from, '');
      removed[el.start] = true;
    }
    var reserved = {};
    Object.keys(info.ids).forEach(function (k) { reserved[k] = true; });
    if (replace) {
      info.labBlocks.forEach(remove);
      info.labAudits.forEach(remove);
      // ids inside removed blocks may be reused
      info.labBlocks.forEach(function (b) {
        (function walk(el) {
          var id = attrOf(el, NS_GML, 'id');
          if (id) delete reserved[id];
          el.children.forEach(walk);
        })(b);
      });
    }
    var uid = makeUid(reserved, LAB_PREFIX);

    var bh = {};
    info.features.forEach(function (f) { bh[f.name] = { id: f.id, lrs: f.lrs }; });
    var frag = labFragments(ds, { uid: uid, projectId: info.projectId, bh: bh, densityUnit: densityUnitOf(settings) });

    // indentation used by the file for root children
    var indentMatch = /\n([ \t]+)</.exec(text.slice(root.contentStart, root.contentStart + 400));
    var unit = indentMatch ? indentMatch[1] : '  ';
    var nsAttrs = { xmlns: D, 'xmlns:gml': NS_GML, 'xmlns:xlink': NS_XLINK };
    function block(nodes) {
      return nodes.map(function (node) {
        Object.keys(nsAttrs).forEach(function (k) { node.attrs[k] = nsAttrs[k]; });
        var out = [];
        serialize(node, 0, out);
        return nl + out.map(function (l) {
          var m = /^((?:  )*)/.exec(l);
          return unit + new Array(m[1].length / 2 + 1).join(unit) + l.slice(m[1].length);
        }).join(nl);
      }).join('');
    }

    // root child order: documentInformation, project, program, samplingFeature,
    // samplingActivity, sample, observation, measurement, constructionActivity, group
    var ORDER = ['documentInformation', 'project', 'program', 'samplingFeature', 'samplingActivity',
                 'sample', 'observation', 'measurement', 'constructionActivity', 'group'];
    var kept = root.children.filter(function (c) { return !removed[c.start]; });
    function insertAfter(localName) {
      var rank = ORDER.indexOf(localName), pos = null;
      kept.forEach(function (c) {
        var r = ORDER.indexOf(c.local);
        if (c.ns === D && r >= 0 && r <= rank) pos = c.end;
      });
      return pos === null ? root.contentStart : pos;
    }
    [['samplingActivity', frag.activities], ['sample', frag.samples], ['measurement', frag.measurements]]
      .forEach(function (pair) {
        if (pair[1].length) edit(insertAfter(pair[0]), 0, block(pair[1]));
      });

    // audit trail note
    var tests = frag.measurements.length;
    var nSamples = ds.sampleOrder.filter(function (k) { return ds.samples[k].tests.length; }).length;
    var note = LAB_AUDIT_MARK + (settings.toolVersion ? ' (version ' + settings.toolVersion + ')' : '') +
      (settings.labName ? ' for ' + settings.labName : '') + ': ' + tests + ' test' + (tests === 1 ? '' : 's') +
      ' on ' + nSamples + ' sample' + (nSamples === 1 ? '' : 's') +
      '. Boring locations are as given in this file' +
      (settings.boringStatus === 'proposed'
        ? ', which the laboratory identified as PROPOSED locations; confirm against the as-drilled locations.'
        : ', which the laboratory identified as as-drilled locations.');
    var today = settings.today || new Date().toISOString().slice(0, 10);
    if (info.docInfo) {
      var trail = E('auditTrail', {}, E('Remark', {}, [E('content', {}, note), E('remarkDateTime', {}, today)]));
      var di = info.docInfo;
      var AFTER = ['creationDate', 'effectiveDate', 'expirationDate', 'author', 'disclaimer', 'sourceSoftware',
                   'destination', 'destinationSoftware', 'auditTrail'];
      var at = null;
      di.children.forEach(function (c) {
        if (c.ns === D && AFTER.indexOf(c.local) >= 0 && !removed[c.start]) at = c.end;
      });
      if (at === null) at = di.contentStart;
      var childIndent = di.children.length ? (/([ \t]*)$/.exec(text.slice(0, di.children[0].start))[1]) : unit + unit + unit;
      Object.keys(nsAttrs).forEach(function (k) { trail.attrs[k] = nsAttrs[k]; });
      var lines = [];
      serialize(trail, 0, lines);
      edit(at, 0, nl + lines.map(function (l) {
        var m = /^((?:  )*)/.exec(l);
        return childIndent + new Array(m[1].length / 2 + 1).join(unit) + l.slice(m[1].length);
      }).join(nl));
    }

    // apply from the end; at one position, removals first, then later
    // insertions before earlier ones so the final order matches push order
    edits.sort(function (a, b) { return b.at - a.at || b.del - a.del || b.seq - a.seq; });
    var out = text;
    edits.forEach(function (e) { out = out.slice(0, e.at) + e.ins + out.slice(e.at + e.del); });
    return out;
  }

  function summarize(ds) {
    var byKind = {};
    ds.tests.forEach(function (t) {
      var label = testName(t.kind, t.data);
      byKind[label] = (byKind[label] || 0) + 1;
    });
    return { borings: ds.boringOrder.length, samples: ds.sampleOrder.length, tests: ds.tests.length, byKind: byKind };
  }

  // ---------------------------------------------------------------------
  // Minimal ZIP writer (store only) for "download all templates"
  // ---------------------------------------------------------------------
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var bin = unescape(encodeURIComponent(s)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** entries: [{name, text}] -> Uint8Array of a .zip */
  function makeZip(entries) {
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    entries.forEach(function (e) {
      var name = utf8(e.name), data = utf8(e.text), crc = crc32(data);
      var common = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc),
                             u32(data.length), u32(data.length), u16(name.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), common));
      parts.push(local, name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0),
                                            u32(0), u32(offset))), name);
      offset += local.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (a, p) { return a + p.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length),
                                       u16(entries.length), u32(cdSize), u32(offset), u16(0)));
    var all = parts.concat(central, [end]);
    var total = all.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ---------------------------------------------------------------------
  // .xlsx reader: ZIP + raw inflate + the few SpreadsheetML parts we need.
  // No libraries; works offline and under node.
  // ---------------------------------------------------------------------

  /*
   * Raw DEFLATE decoder (RFC 1951), ported from tiny-inflate
   * (https://github.com/foliojs/tiny-inflate), used under this license:
   *
   * MIT License
   *
   * Copyright (c) 2015-present Devon Govett
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  var Inflate = (function () {
    function Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
    var sltree = new Tree(), sdtree = new Tree();
    var lengthBits = new Uint8Array(30), lengthBase = new Uint16Array(30);
    var distBits = new Uint8Array(30), distBase = new Uint16Array(30);
    var clcidx = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    var codeTree = new Tree(), lengths = new Uint8Array(288 + 32), offs = new Uint16Array(16);

    function buildBitsBase(bits, base, delta, first) {
      var i, sum;
      for (i = 0; i < delta; ++i) bits[i] = 0;
      for (i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;
      for (sum = first, i = 0; i < 30; ++i) { base[i] = sum; sum += 1 << bits[i]; }
    }
    function buildFixedTrees(lt, dt) {
      var i;
      for (i = 0; i < 7; ++i) lt.table[i] = 0;
      lt.table[7] = 24; lt.table[8] = 152; lt.table[9] = 112;
      for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
      for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
      for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
      for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;
      for (i = 0; i < 5; ++i) dt.table[i] = 0;
      dt.table[5] = 32;
      for (i = 0; i < 32; ++i) dt.trans[i] = i;
    }
    function buildTree(t, lens, off, num) {
      var i, sum;
      for (i = 0; i < 16; ++i) t.table[i] = 0;
      for (i = 0; i < num; ++i) t.table[lens[off + i]]++;
      t.table[0] = 0;
      for (sum = 0, i = 0; i < 16; ++i) { offs[i] = sum; sum += t.table[i]; }
      for (i = 0; i < num; ++i) if (lens[off + i]) t.trans[offs[lens[off + i]]++] = i;
    }
    function refill(d) {
      while (d.bitcount < 24) {
        if (d.si >= d.src.length + 4) throw new Error('corrupt compressed data');
        d.tag |= (d.src[d.si++] | 0) << d.bitcount;
        d.bitcount += 8;
      }
    }
    function getBit(d) {
      if (!d.bitcount--) { d.tag = d.src[d.si++] | 0; d.bitcount = 7; }
      var bit = d.tag & 1;
      d.tag >>>= 1;
      return bit;
    }
    function readBits(d, num, base) {
      if (!num) return base;
      refill(d);
      var val = d.tag & (0xffff >>> (16 - num));
      d.tag >>>= num;
      d.bitcount -= num;
      return val + base;
    }
    function decodeSymbol(d, t) {
      refill(d);
      var sum = 0, cur = 0, len = 0, tag = d.tag;
      do {
        cur = 2 * cur + (tag & 1);
        tag >>>= 1;
        ++len;
        if (len > 15) throw new Error('corrupt compressed data');
        sum += t.table[len];
        cur -= t.table[len];
      } while (cur >= 0);
      d.tag = tag;
      d.bitcount -= len;
      return t.trans[sum + cur];
    }
    function decodeTrees(d, lt, dt) {
      var hlit = readBits(d, 5, 257), hdist = readBits(d, 5, 1), hclen = readBits(d, 4, 4);
      var i, num, length;
      for (i = 0; i < 19; ++i) lengths[i] = 0;
      for (i = 0; i < hclen; ++i) lengths[clcidx[i]] = readBits(d, 3, 0);
      buildTree(codeTree, lengths, 0, 19);
      for (num = 0; num < hlit + hdist;) {
        var sym = decodeSymbol(d, codeTree);
        if (sym === 16) {
          var prev = lengths[num - 1];
          for (length = readBits(d, 2, 3); length; --length) lengths[num++] = prev;
        } else if (sym === 17) {
          for (length = readBits(d, 3, 3); length; --length) lengths[num++] = 0;
        } else if (sym === 18) {
          for (length = readBits(d, 7, 11); length; --length) lengths[num++] = 0;
        } else {
          lengths[num++] = sym;
        }
      }
      buildTree(lt, lengths, 0, hlit);
      buildTree(dt, lengths, hlit, hdist);
    }
    function put(d, byte) {
      if (d.len >= d.out.length) {
        var bigger = new Uint8Array(d.out.length * 2 + 1024);
        bigger.set(d.out);
        d.out = bigger;
      }
      d.out[d.len++] = byte;
    }
    function inflateBlock(d, lt, dt) {
      for (;;) {
        var sym = decodeSymbol(d, lt);
        if (sym === 256) return;
        if (sym < 256) { put(d, sym); continue; }
        sym -= 257;
        var length = readBits(d, lengthBits[sym], lengthBase[sym]);
        var dist = decodeSymbol(d, dt);
        var from = d.len - readBits(d, distBits[dist], distBase[dist]);
        if (from < 0) throw new Error('corrupt compressed data');
        for (var i = 0; i < length; ++i) put(d, d.out[from + i]);
      }
    }
    function inflateStored(d) {
      // give back whole bytes the bit buffer read ahead, drop the partial one
      while (d.bitcount >= 8) { d.si--; d.bitcount -= 8; }
      d.bitcount = 0;
      d.tag = 0;
      var length = d.src[d.si] | (d.src[d.si + 1] << 8);
      var inv = d.src[d.si + 2] | (d.src[d.si + 3] << 8);
      if (length !== (~inv & 0xffff)) throw new Error('corrupt compressed data');
      d.si += 4;
      for (var i = 0; i < length; ++i) put(d, d.src[d.si++]);
    }

    buildFixedTrees(sltree, sdtree);
    buildBitsBase(lengthBits, lengthBase, 4, 3);
    buildBitsBase(distBits, distBase, 2, 1);
    lengthBits[28] = 0;
    lengthBase[28] = 258;

    return function inflateRaw(src, sizeHint) {
      var d = { src: src, si: 0, tag: 0, bitcount: 0, out: new Uint8Array(sizeHint || src.length * 4 + 1024),
                len: 0, lt: new Tree(), dt: new Tree() };
      var last;
      do {
        last = getBit(d);
        var type = readBits(d, 2, 0);
        if (type === 0) inflateStored(d);
        else if (type === 1) inflateBlock(d, sltree, sdtree);
        else if (type === 2) { decodeTrees(d, d.lt, d.dt); inflateBlock(d, d.lt, d.dt); }
        else throw new Error('corrupt compressed data');
      } while (!last);
      return d.out.subarray(0, d.len);
    };
  })();

  /** {path: Uint8Array} for every file in a ZIP archive. */
  function readZip(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a ZIP archive');
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    var files = {};
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true),
          usize = dv.getUint32(p + 24, true), nlen = dv.getUint16(p + 28, true),
          elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true),
          local = dv.getUint32(p + 42, true);
      var name = utf8decode(bytes.subarray(p + 46, p + 46 + nlen));
      var start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      var data = bytes.subarray(start, start + csize);
      if (method === 0) files[name] = data;
      else if (method === 8) files[name] = Inflate(data, usize);
      else files[name] = null;  // unsupported compression; only fails if this part is needed
      p += 46 + nlen + elen + clen;
    }
    return files;
  }

  function utf8decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return decodeURIComponent(escape(s));
  }

  function xmlText(s) {
    return String(s)
      .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, function (m, e) {
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'amp') return '&';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        var code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return String.fromCodePoint(code);
      })
      // Excel escapes some characters as _xHHHH_ in strings
      .replace(/_x([0-9A-Fa-f]{4})_/g, function (m, hex) { return String.fromCharCode(parseInt(hex, 16)); });
  }

  function attr(attrs, name) {
    var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')').exec(attrs);
    return m ? xmlText(m[2] !== undefined ? m[2] : m[3]) : null;
  }

  /** Text of <t> runs, skipping phonetic <rPh> runs. */
  function runText(xml) {
    var out = '';
    xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g, function (m, t) {
      out += t ? xmlText(t) : '';
      return m;
    });
    return out;
  }

  function parseSharedStrings(xml) {
    var out = [];
    String(xml || '').replace(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, function (m, inner) {
      out.push(inner ? runText(inner) : '');
      return m;
    });
    return out;
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  /** Rows (arrays of strings) of one worksheet part. */
  function parseSheetXml(xml, shared) {
    var rows = [];
    var data = /<sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetData>)/.exec(xml || '');
    if (!data || !data[1]) return rows;
    var nextRow = 0;
    data[1].replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, function (m, rattrs, inner) {
      var rnum = attr(rattrs, 'r');
      var ri = rnum ? parseInt(rnum, 10) - 1 : nextRow;
      nextRow = ri + 1;
      var row = [], nextCol = 0;
      (inner || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (cm, cattrs, cinner) {
        var ref = attr(cattrs, 'r');
        var ci = ref ? colIndex(ref) : nextCol;
        nextCol = ci + 1;
        var type = attr(cattrs, 't') || 'n';
        var body = cinner || '';
        var v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        var val = v ? xmlText(v[1]) : '';
        if (type === 's') val = v ? (shared[parseInt(val, 10)] || '') : '';
        else if (type === 'inlineStr') {
          var is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
          val = is ? runText(is[1]) : '';
        } else if (type === 'b') val = val === '1' ? 'TRUE' : (val === '0' ? 'FALSE' : val);
        while (row.length < ci) row.push('');
        row[ci] = val;
        return cm;
      });
      while (rows.length < ri) rows.push([]);
      rows[ri] = row;
      return m;
    });
    return rows;
  }

  function resolvePart(target) {
    target = String(target || '');
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = ('xl/' + target).split('/'), out = [];
    parts.forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  /** [{name, rows, hidden}] for the worksheets of an .xlsx file, in workbook order. */
  function readWorkbook(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF) {
      throw new Error('this is an old-style .xls workbook. Open it in Excel and save it as .xlsx.');
    }
    var files;
    try { files = readZip(bytes); } catch (e) { throw new Error('not a readable .xlsx workbook (' + e.message + ')'); }
    var part = function (name) { return files[name] ? utf8decode(files[name]) : null; };
    var wb = part('xl/workbook.xml');
    if (!wb) throw new Error('not an Excel .xlsx workbook');
    var rels = {};
    (part('xl/_rels/workbook.xml.rels') || '').replace(/<Relationship\b([^>]*?)\/?>/g, function (m, a) {
      rels[attr(a, 'Id')] = resolvePart(attr(a, 'Target'));
      return m;
    });
    var shared = parseSharedStrings(part('xl/sharedStrings.xml'));
    var sheets = [];
    wb.replace(/<sheet\b([^>]*?)\/?>/g, function (m, a) {
      var rid = attr(a, 'r:id') || (/\bid\s*=\s*"([^"]*)"/.exec(a) || [])[1];
      var path = rels[rid];
      var xml = path ? part(path) : null;
      if (xml === null) return m;  // chart sheets and the like
      var state = attr(a, 'state');
      sheets.push({ name: attr(a, 'name'), rows: parseSheetXml(xml, shared),
                    hidden: state === 'hidden' || state === 'veryHidden' });
      return m;
    });
    return sheets;
  }

  /** Loaded-file entries for the sheets of a workbook (Instructions and
   *  empty sheets skipped). */
  function workbookEntries(fileName, bytes) {
    var entries = [];
    readWorkbook(bytes).forEach(function (sh) {
      if (sh.hidden || /^(instructions?|read ?me|help)$/i.test(sh.name.trim())) return;
      var nonBlank = sh.rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
      if (nonBlank.length < 2) return;  // empty, or headers only
      var byName = null;
      var norm = sh.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      TEMPLATES.forEach(function (t) {
        if (norm === t.id || norm === t.sheet.toLowerCase().replace(/[^a-z0-9]+/g, '_')) byName = t.id;
      });
      entries.push({ name: fileName + ' \u203a ' + sh.name, source: fileName, sheet: true,
                     detectName: byName || sh.name, rows: sh.rows, template: '' });
    });
    return entries;
  }

  // ---------------------------------------------------------------------
  // .xlsx writer: the template workbook, built in the page (no server).
  // Minimal SpreadsheetML: inline strings, one style sheet, frozen header
  // rows, text-formatted ID columns, dropdowns, and per-column input
  // messages (the tooltip Excel shows when a cell is selected).
  // ---------------------------------------------------------------------
  var WB_MAX_ROW = 2000;
  var NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  // cellXfs indexes in STYLES_XML
  var ST = { normal: 0, reqHead: 1, optHead: 2, text: 3, title: 4, heading: 5, bold: 6, wrap: 7, wrapShade: 8, boldWrap: 9 };
  var STYLES_XML = XML_HEAD +
    '<styleSheet xmlns="' + NS_MAIN + '">' +
    '<fonts count="5">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF2C2C2C"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="16"/><color rgb="FF2B5B2B"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="12"/><color rgb="FF5C3D1E"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="5">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF2B5B2B"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFC4A265"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF5F0E8"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function colLetter(i) {  // 0-based
    var s = '';
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /** A worksheet being assembled: rows of {v, s, num}, columns, validations. */
  function Sheet(name) {
    this.name = name; this.rows = []; this.cols = []; this.validations = []; this.frozen = false;
  }
  Sheet.prototype.set = function (r, c, value, style, isNumber) {
    if (value === null || value === undefined || value === '') { if (style == null) return; value = ''; }
    (this.rows[r] = this.rows[r] || [])[c] = { v: value, s: style || 0, num: !!isNumber };
  };
  Sheet.prototype.xml = function (selected) {
    var out = [XML_HEAD, '<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">'];
    out.push('<sheetViews><sheetView workbookViewId="0"' + (selected ? ' tabSelected="1"' : '') + '>');
    if (this.frozen) {
      out.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
               '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
    }
    out.push('</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>');
    if (this.cols.length) {
      out.push('<cols>');
      this.cols.forEach(function (c, i) {
        if (!c) return;
        out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + c.width + '" customWidth="1"' +
                 (c.style ? ' style="' + c.style + '"' : '') + '/>');
      });
      out.push('</cols>');
    }
    out.push('<sheetData>');
    this.rows.forEach(function (row, r) {
      if (!row) return;
      out.push('<row r="' + (r + 1) + '">');
      row.forEach(function (cell, c) {
        if (!cell) return;
        var ref = colLetter(c) + (r + 1), s = cell.s ? ' s="' + cell.s + '"' : '';
        if (cell.v === '') out.push('<c r="' + ref + '"' + s + '/>');
        else if (cell.num) out.push('<c r="' + ref + '"' + s + '><v>' + esc(cell.v) + '</v></c>');
        else {
          var text = String(cell.v);
          var space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
          out.push('<c r="' + ref + '"' + s + ' t="inlineStr"><is><t' + space + '>' + esc(text) + '</t></is></c>');
        }
      });
      out.push('</row>');
    });
    out.push('</sheetData>');
    if (this.validations.length) {
      out.push('<dataValidations count="' + this.validations.length + '">');
      this.validations.forEach(function (d) {
        var a = '';
        if (d.type) a += ' type="' + d.type + '"';
        if (d.errorStyle && d.errorStyle !== 'stop') a += ' errorStyle="' + d.errorStyle + '"';
        if (d.operator) a += ' operator="' + d.operator + '"';
        a += ' allowBlank="1"';
        if (d.prompt) a += ' showInputMessage="1"';
        if (d.error) a += ' showErrorMessage="1"';
        if (d.errorTitle) a += ' errorTitle="' + esc(clip(d.errorTitle, 32)) + '"';
        if (d.error) a += ' error="' + esc(clip(d.error, 225)) + '"';
        if (d.promptTitle) a += ' promptTitle="' + esc(clip(d.promptTitle, 32)) + '"';
        if (d.prompt) a += ' prompt="' + esc(clip(d.prompt, 255)) + '"';
        a += ' sqref="' + d.sqref + '"';
        out.push('<dataValidation' + a + '>' +
                 (d.formula1 != null ? '<formula1>' + esc(d.formula1) + '</formula1>' : '') +
                 (d.formula2 != null ? '<formula2>' + esc(d.formula2) + '</formula2>' : '') +
                 '</dataValidation>');
      });
      out.push('</dataValidations>');
    }
    out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
    out.push('</worksheet>');
    return out.join('');
  };

  function columnRule(col) {
    if (col.lookup === 'borings') {
      return { type: 'list', formula1: 'BoringIds', errorStyle: 'warning', errorTitle: 'Boring not listed',
               error: 'This boring is not on the Borings sheet. Add it there so it gets a location.' };
    }
    if (col.choices) {
      var list = '"' + col.choices.join(',') + '"';
      return col.strict === false
        ? { type: 'list', formula1: list, errorStyle: 'information', errorTitle: 'Not a usual value',
            error: 'Not one of the usual values. It will be kept as typed.' }
        : { type: 'list', formula1: list, errorTitle: 'Choose from the list',
            error: 'Pick one of: ' + col.choices.join(', ') };
    }
    if (col.min != null && col.max != null) {
      return { type: 'decimal', operator: 'between', formula1: String(col.min), formula2: String(col.max),
               errorTitle: 'Out of range', error: 'Enter a number from ' + col.min + ' to ' + col.max + '.' };
    }
    if (col.min != null) {
      return { type: 'decimal', operator: 'greaterThanOrEqual', formula1: String(col.min),
               errorTitle: 'Out of range', error: 'Enter a number of at least ' + col.min + '.' };
    }
    return {};
  }

  function isNumeric(s) { return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(String(s).trim()); }

  function tableSheet(t, examples, seedRows, sampleLookup) {
    var sh = new Sheet(t.sheet);
    sh.frozen = true;
    t.columns.forEach(function (col, i) {
      var L = colLetter(i);
      sh.set(0, i, col.name, col.required ? ST.reqHead : ST.optHead);
      sh.cols[i] = { width: Math.max(col.width || 0, col.name.length + 3, 11), style: col.text ? ST.text : 0 };
      var prompt = col.doc + (col.required ? ' Required.' : '') +
                   (col.choices ? ' Choices: ' + col.choices.join(', ') + '.' : '');
      // header note, then the data-row rule with the same note
      sh.validations.push({ sqref: L + '1', promptTitle: col.name, prompt: prompt });
      var rule = columnRule(col);
      if (sampleLookup && col.name === 'sample_id') {
        rule = { type: 'list', formula1: 'SampleIds', errorStyle: 'information', errorTitle: 'New sample',
                 error: 'This sample is not on the Samples sheet. It will be added as a new sample at the depths you give.' };
      }
      rule.sqref = L + '2:' + L + WB_MAX_ROW;
      rule.promptTitle = col.name;
      rule.prompt = prompt;
      sh.validations.push(rule);
    });
    (seedRows || (examples ? t.examples : [])).forEach(function (row, r) {
      row.forEach(function (v, i) {
        var col = t.columns[i];
        if (v === '' || !col) return;
        var num = !col.text && isNumeric(v);
        sh.set(r + 1, i, v, col.text ? ST.text : 0, num);
      });
    });
    return sh;
  }

  function projectSheet(examples, seed) {
    var sh = new Sheet(PROJECT.sheet);
    sh.frozen = true;
    ['field', 'value', 'notes'].forEach(function (h, i) { sh.set(0, i, h, i < 2 ? ST.reqHead : ST.optHead); });
    sh.cols = [{ width: 16 }, { width: 42, style: ST.text }, { width: 70 }];
    var defaults = { depth_unit: 'feet', density_unit: 'lbm/ft3' };
    PROJECT.fields.forEach(function (f, i) {
      var r = i + 1, ref = 'B' + (r + 1);
      sh.set(r, 0, f.key, ST.bold);
      var value = examples ? f.example : (defaults[f.key] || '');
      if (seed && f.key === 'project_name') value = seed.projectName || '';
      if (seed && f.key === 'depth_unit' && seed.depthUnit) value = seed.depthUnit;
      sh.set(r, 1, value, ST.text);
      sh.set(r, 2, f.label + '. ' + f.doc, ST.wrap);
      var v = { sqref: ref, promptTitle: f.label, prompt: f.doc };
      if (f.choices) {
        v.type = 'list';
        v.formula1 = '"' + f.choices.join(',') + '"';
        v.errorTitle = 'Choose from the list';
        v.error = 'Pick one of: ' + f.choices.join(', ');
      }
      sh.validations.push(v);
    });
    if (seed) {
      var r = PROJECT.fields.length + 1;
      sh.set(r, 0, 'source_file', ST.bold);
      sh.set(r, 1, seed.sourceFile, ST.text);
      sh.set(r, 2, 'The DIGGS file this workbook was prepared from. Drop that file on the page together with this workbook.', ST.wrap);
    }
    return sh;
  }

  function instructionsSheet(seed) {
    var sh = new Sheet('Instructions');
    sh.cols = [{ width: 22 }, { width: 24 }, { width: 12 }, { width: 80 }];
    var r = 0;
    sh.set(r++, 0, 'Lab Results to DIGGS: workbook template', ST.title);
    sh.set(r++, 0, 'Fill this workbook in, then drop it on the Lab Results to DIGGS page. The page reads it on your computer and writes the DIGGS XML file.');
    if (seed) {
      sh.set(r++, 0, 'Prepared from ' + seed.sourceFile + '. The borings, their locations and the listed samples come from that file: ' +
        'enter results on the test sheets, using the boring and sample IDs shown on the Borings and Samples sheets. ' +
        'Then drop this workbook and ' + seed.sourceFile + ' on the page; it adds your results to that file.', ST.bold);
    }
    r++;
    sh.set(r++, 0, 'How to use it', ST.heading);
    (seed ? [
      '1. Check the Project sheet: add your laboratory name. The project name and depth unit come from the DIGGS file.',
      '2. The Borings sheet lists the borings in the DIGGS file. Their locations are taken from that file, so you do not need to edit it.',
      '3. Enter results on the sheet for each test you ran. Pick boring_id and sample_id from the lists; a sample that is not listed is added at the depths you give.',
      '4. Rows on different sheets with the same boring_id and sample_id are the same sample.',
      '5. Save the workbook as .xlsx and drop it on the page together with the DIGGS file.'
    ] : [
      '1. Fill in the Project sheet: project name, client, laboratory and units.',
      '2. List each boring on the Borings sheet with latitude and longitude (WGS84 decimal degrees). DIGGS requires a location for every boring. Ground elevation is strongly recommended.',
      '3. Enter results on the sheet for each test you ran. Leave the other sheets empty.',
      '4. Every results row names the boring, the sample and its depth. Rows on different sheets with the same boring_id and sample_id are the same sample, so keep the IDs identical.',
      '5. Save the workbook as .xlsx and drop it on the page.'
    ]).forEach(function (line) { sh.set(r++, 0, line); });
    r++;
    sh.set(r++, 0, 'Rules', ST.heading);
    [
      'Dark green headers are required; tan headers are optional. Select a header or a cell to see its note.',
      'Do not rename the header cells. Sheet names may change: the page also recognises a sheet by its headers.',
      'Enter numbers without units. Depths and elevations use the depth unit on the Project sheet; densities use its density unit.',
      'Water content, limits, percent passing and organic content are percent. Particle sizes are mm. Resistivity is ohm-cm. Sulfate and chloride are ppm.',
      'Gradation and Compaction take one row per sieve, hydrometer reading or trial point.',
      'Percent gravel, sand, silt and clay, D-values, Cu, Cc, the USCS classification and the Proctor maximum are computed by the page unless you report them.',
      'Formulas are fine: the page reads the values Excel last calculated.'
    ].forEach(function (line) { sh.set(r++, 0, '• ' + line); });
    r++;
    sh.set(r++, 0, 'Column reference', ST.heading);
    ['Sheet', 'Column', 'Required', 'Meaning'].forEach(function (h, i) { sh.set(r, i, h, ST.reqHead); });
    r++;
    var shade = false;
    var addRow = function (sheet, col, req, doc) {
      var s = shade ? ST.wrapShade : ST.wrap;
      sh.set(r, 0, sheet, shade ? ST.wrapShade : ST.boldWrap);
      sh.set(r, 1, col, s);
      sh.set(r, 2, req ? 'yes' : '', s);
      sh.set(r, 3, doc, s);
      r++;
    };
    PROJECT.fields.forEach(function (f, i) { addRow(i ? '' : PROJECT.sheet, f.key, f.key === 'project_name', f.doc); });
    TEMPLATES.forEach(function (t) {
      if (t.isProject) return;
      shade = !shade;
      var head = t.sheet + (t.astm ? '\n' + t.astm : '');
      if (t.notes) addRow(head, '', false, t.notes);
      t.columns.forEach(function (c, i) {
        addRow(i || t.notes ? '' : head, c.name, c.required,
               c.doc + (c.choices ? ' Choices: ' + c.choices.join(', ') + '.' : ''));
      });
    });
    return sh;
  }

  /** The template workbook as .xlsx bytes: blank, with example rows, or
   *  prepared from a DIGGS file (seed from sourceSeed()). */
  function writeWorkbook(examples, seed) {
    if (seed) examples = false;
    var sampleLookup = !!(seed && seed.samples.length);
    var sheets = [instructionsSheet(seed), projectSheet(examples, seed)];
    TEMPLATES.forEach(function (t) {
      if (t.isProject) return;
      var rows = seed ? (t.id === 'borings' ? seed.borings : (t.id === 'samples' ? seed.samples : [])) : null;
      sheets.push(tableSheet(t, examples, rows, sampleLookup && t.keyed && t.id !== 'samples'));
    });
    var boringsIndex = -1;
    sheets.forEach(function (s, i) { if (s.name === TEMPLATE_BY_ID.borings.sheet) boringsIndex = i; });

    var ct = [XML_HEAD, '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'];
    var wbRels = [XML_HEAD, '<Relationships xmlns="' + NS_PKG_REL + '">'];
    var wbSheets = [];
    sheets.forEach(function (s, i) {
      var n = i + 1;
      ct.push('<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
      wbRels.push('<Relationship Id="rId' + n + '" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet' + n + '.xml"/>');
      wbSheets.push('<sheet name="' + esc(s.name) + '" sheetId="' + n + '" r:id="rId' + n + '"/>');
    });
    ct.push('</Types>');
    wbRels.push('<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + NS_REL + '/styles" Target="styles.xml"/>');
    wbRels.push('</Relationships>');
    var borings = TEMPLATE_BY_ID.borings.sheet;
    var workbook = XML_HEAD + '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
      '<bookViews><workbookView activeTab="0"/></bookViews>' +
      '<sheets>' + wbSheets.join('') + '</sheets>' +
      (boringsIndex >= 0 ? '<definedNames><definedName name="BoringIds">' +
        esc("'" + borings.replace(/'/g, "''") + "'!$A$2:$A$" + WB_MAX_ROW) + '</definedName>' +
        (sampleLookup ? '<definedName name="SampleIds">' +
          esc("'" + TEMPLATE_BY_ID.samples.sheet.replace(/'/g, "''") + "'!$B$2:$B$" + WB_MAX_ROW) + '</definedName>' : '') +
        '</definedNames>' : '') +
      '</workbook>';
    var core = XML_HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>Lab Results to DIGGS template</dc:title><dc:creator>Geosetta</dc:creator></cp:coreProperties>';
    var entries = [
      { name: '[Content_Types].xml', text: ct.join('') },
      { name: '_rels/.rels', text: XML_HEAD + '<Relationships xmlns="' + NS_PKG_REL + '">' +
        '<Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>' },
      { name: 'docProps/core.xml', text: core },
      { name: 'xl/workbook.xml', text: workbook },
      { name: 'xl/_rels/workbook.xml.rels', text: wbRels.join('') },
      { name: 'xl/styles.xml', text: STYLES_XML }
    ];
    sheets.forEach(function (s, i) {
      entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: s.xml(i === 0) });
    });
    return makeZip(entries);
  }

  return {
    TEMPLATES: TEMPLATES, TEMPLATE_BY_ID: TEMPLATE_BY_ID, KINDS: KINDS, SPECS: SPECS,
    DENSITY_UNITS: DENSITY_UNITS, USCS_SYMBOLS: USCS_SYMBOLS,
    parseCSV: parseCSV, toCSV: toCSV, templateCSV: templateCSV, detectTemplate: detectTemplate,
    normHeader: normHeader, sieveSize: sieveSize, num: num, fmt: fmt, normDate: normDate,
    dValue: dValue, passingAt: passingAt, finesSymbol: finesSymbol, uscs: uscs,
    gradationSummary: gradationSummary, compactionSummary: compactionSummary,
    parseXml: parseXml, readDiggs: readDiggs, describeSource: describeSource, sourceSeed: sourceSeed,
    mergeDiggs: mergeDiggs, nameKey: nameKey,
    buildDataset: buildDataset, generateDiggs: generateDiggs, summarize: summarize,
    testName: testName, makeZip: makeZip, crc32: crc32, PROJECT: PROJECT,
    fileRows: fileRows, projectSettings: projectSettings,
    inflateRaw: Inflate, readZip: readZip, readWorkbook: readWorkbook, workbookEntries: workbookEntries,
    parseSheetXml: parseSheetXml, parseSharedStrings: parseSharedStrings, writeWorkbook: writeWorkbook
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LabDiggs;
