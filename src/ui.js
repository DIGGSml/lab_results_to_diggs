/* Lab Results -> DIGGS: page behaviour. Logic lives in core.js (LabDiggs). */
(function () {
  'use strict';
  var L = LabDiggs;
  var API = 'https://diggs.geosetta.org/api';
  var TOOL_VERSION = '__TOOL_VERSION__';
  var SETTINGS_KEY = 'lab_diggs_builder_settings';
  var DISMISS_KEY = 'lab_diggs_builder_dismissed_version';
  var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // source: the project DIGGS file (readDiggs result) or null
  var state = { files: [], borings: {}, xml: null, ds: null, source: null, sourceProblem: null,
                loadProblems: [], workbookDepthUnit: null, workbookSourceFile: null };
  var $ = function (id) { return document.getElementById(id); };

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
  function recall(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function stem(name) {
    return String(name || '').replace(/^.*[\\/]/, '').replace(/(\.diggs)?\.(xml|diggs|xlsx|xlsm|csv)$/i, '');
  }
  function safeName(name) { return String(name).replace(/[^\w.\-]+/g, '_').slice(0, 100); }

  function msgBox(kind, title, items, limit) {
    limit = limit || 200;
    var ul = h('ul');
    (items || []).slice(0, limit).forEach(function (m) { ul.appendChild(h('li', { text: m })); });
    if (items && items.length > limit) ul.appendChild(h('li', { text: '... and ' + (items.length - limit) + ' more' }));
    return h('div', { class: 'msgbox ' + kind, role: kind === 'error' ? 'alert' : null },
             [h('h3', { text: title }), items && items.length ? ul : null]);
  }

  function wireDropzone(zone, input, onFiles) {
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { onFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      e.stopPropagation();
      if (e.dataTransfer) onFiles(e.dataTransfer.files);
    });
  }

  function readAs(file, kind) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('the file could not be read')); };
      if (kind === 'bytes') r.readAsArrayBuffer(file); else r.readAsText(file);
    });
  }

  // ------------------------------------------------------------------ source DIGGS file
  function setSource(text, name) {
    try {
      state.source = L.readDiggs(text, name);
      state.sourceProblem = null;
    } catch (e) {
      state.source = null;
      state.sourceProblem = name + ': ' + (e && e.message || e);
    }
    state.borings = {};
    if (state.source) {
      var radio = document.querySelector('input[name=boringStatus][value="' +
        (state.source.allConstructed ? 'as drilled' : 'proposed') + '"]');
      if (radio) radio.checked = true;
      $('outName').value = safeName(stem(name) + '_with_lab_results');
    }
    renderSource();
    rebuild();
  }

  function readSourceFiles(list) {
    var f = list && list[0];
    if (!f) return;
    readAs(f, 'text').then(function (text) { setSource(text, f.name); },
      function (e) { state.source = null; state.sourceProblem = f.name + ': ' + e.message; renderSource(); });
  }

  function renderSource() {
    var info = state.source, box = $('source-info'), msgs = $('source-messages');
    document.body.classList.toggle('merge-mode', !!info);
    $('source-drop').hidden = !!info;
    box.hidden = !info && !state.sourceProblem;
    msgs.textContent = '';
    $('depthUnit').disabled = !!(info && info.depthUnit);
    $('project-note').textContent = info
      ? 'The project comes from ' + info.fileName + '. Add your laboratory name; it is recorded with your results.'
      : "Filled in from the workbook's Project sheet when you add it. You can change them here.";
    $('files-note').textContent = info
      ? 'Use the workbook downloaded in step 1 (or any workbook that uses the boring and sample IDs from ' + info.fileName + ').'
      : '';
    if (!info) {
      $('source-name').textContent = '';
      $('source-project').textContent = '';
      $('source-stats').textContent = '';
      $('source-borings').textContent = '';
      $('dl-seeded').disabled = true;
      $('dl-seeded').parentNode.hidden = true;
      Array.prototype.forEach.call(document.querySelectorAll('#source-info fieldset'), function (f) { f.hidden = true; });
      if (state.sourceProblem) {
        $('source-drop').hidden = false;
        msgs.appendChild(msgBox('error', 'This file cannot be used as the starting DIGGS file', [state.sourceProblem]));
      }
      return;
    }
    if (info.depthUnit) $('depthUnit').value = info.depthUnit;
    var d = L.describeSource(info);
    $('dl-seeded').disabled = false;
    $('dl-seeded').parentNode.hidden = false;
    document.querySelector('#source-info fieldset.choice').hidden = false;
    $('previous-lab').hidden = !d.labTests;
    $('source-name').textContent = info.fileName;
    $('source-project').textContent = 'Project: ' + (d.project || '(no name)') +
      (d.depthUnit ? '  |  depths in ' + (d.depthUnit === 'm' ? 'meters' : 'feet') : '');
    var stats = $('source-stats');
    stats.textContent = '';
    [[d.borings, 'borings'], [d.located, 'with locations'], [d.samples, 'samples']].forEach(function (p) {
      stats.appendChild(h('div', { class: 'stat' }, [h('b', { text: String(p[0]) }), p[1]]));
    });
    if (d.labTests) stats.appendChild(h('div', { class: 'stat' }, [h('b', { text: String(d.labTests) }), 'tests from this tool']));
    $('source-borings').textContent = d.names.length
      ? 'Borings: ' + (d.names.length > 30 ? d.names.slice(0, 30).join(', ') + ', ...' : d.names.join(', '))
      : '';
    var problems = [];
    if (!d.borings) problems.push('The file has no borings or test pits, so results cannot be added to it.');
    if (d.borings && d.located < d.borings) {
      problems.push((d.borings - d.located) + ' boring(s) in the file have no location. The file will not pass DIGGS validation until they do.');
    }
    if (!d.depthUnit && d.borings) problems.push('The borings in this file do not share one recognised depth unit (feet or meters).');
    if (d.unusable.length) problems.push('Not used for lab samples: ' + d.unusable.join(', ') + '.');
    if (problems.length) msgs.appendChild(msgBox('warn', 'About this file', problems));
  }

  // ------------------------------------------------------------------ templates
  function renderTemplates() {
    var tbody = $('template-table').querySelector('tbody');
    var sheetRows = [L.TEMPLATE_BY_ID.project].concat(L.TEMPLATES.filter(function (t) { return !t.isProject; }));
    sheetRows.forEach(function (t) {
      var cols = t.isProject
        ? L.PROJECT.fields.map(function (f) { return f.key; }).join(', ')
        : t.columns.map(function (c) { return c.name + (c.required ? '*' : ''); }).join(', ');
      tbody.appendChild(h('tr', {}, [
        h('td', {}, [t.sheet, t.optional && !t.isProject ? h('span', { class: 'tag', text: 'optional' }) : null]),
        h('td', { text: t.astm }),
        h('td', { class: 'cols', text: cols })
      ]));
    });

    var help = h('div', { class: 'colhelp' });
    help.appendChild(h('p', { text: 'In Excel, select a header or a cell to see its note. Header names are matched loosely, so "Boring", "Sample", "Depth", "LL" and "PL" are recognised too. When you start from a DIGGS file, the Borings sheet is only a list: locations come from the file.' }));
    help.appendChild(h('h4', { text: L.PROJECT.sheet }));
    var pdl = h('dl');
    L.PROJECT.fields.forEach(function (f) {
      pdl.appendChild(h('dt', { text: f.key }));
      pdl.appendChild(h('dd', { text: f.doc }));
    });
    help.appendChild(pdl);
    L.TEMPLATES.forEach(function (t) {
      if (t.isProject) return;
      help.appendChild(h('h4', { text: t.sheet + (t.astm ? ' (' + t.astm + ')' : '') }));
      if (t.notes) help.appendChild(h('p', { text: t.notes }));
      var dl = h('dl');
      t.columns.forEach(function (c) {
        dl.appendChild(h('dt', { text: c.name + (c.required ? ' *' : '') }));
        dl.appendChild(h('dd', { text: c.doc }));
      });
      help.appendChild(dl);
    });
    $('column-help').appendChild(help);

    function workbook(examples) {
      download(examples ? 'lab_results_to_diggs_example.xlsx' : 'lab_results_to_diggs_template.xlsx',
               new Blob([L.writeWorkbook(examples)], { type: XLSX_TYPE }));
    }
    $('dl-workbook').addEventListener('click', function () { workbook(false); });
    $('dl-workbook-example').addEventListener('click', function () { workbook(true); });
    $('dl-seeded').addEventListener('click', function () {
      if (!state.source) return;
      download(safeName(stem(state.source.fileName) + '_lab_workbook') + '.xlsx',
               new Blob([L.writeWorkbook(false, L.sourceSeed(state.source))], { type: XLSX_TYPE }));
    });

    function zipAll(examples) {
      var entries = L.TEMPLATES.map(function (t) { return { name: t.id + '.csv', text: L.templateCSV(t.id, examples) }; });
      download(examples ? 'lab_diggs_csv_templates_examples.zip' : 'lab_diggs_csv_templates.zip',
               new Blob([L.makeZip(entries)], { type: 'application/zip' }));
    }
    $('dl-all-templates').addEventListener('click', function () { zipAll(false); });
    $('dl-all-examples').addEventListener('click', function () { zipAll(true); });

    $('load-example').addEventListener('click', loadExample);
  }

  /** Example of the recommended flow: a project DIGGS file with borings and
   *  samples (made from the example workbook), plus the example results. */
  function loadExample() {
    var entries = L.workbookEntries('example workbook', L.writeWorkbook(true));
    var project = L.projectSettings(L.fileRows(entries[0]));
    var sitework = entries.filter(function (e) { return e.detectName === 'borings' || e.detectName === 'samples'; });
    var siteDs = L.buildDataset(sitework, { depthUnit: project.depthUnit });
    var example = L.generateDiggs(siteDs, { projectName: 'Example project (borings as drilled)',
                                            client: 'Example Engineering, Inc.' });
    state.files = entries.filter(function (e) { return e.detectName !== 'borings'; });
    state.loadProblems = [];
    $('labName').value = project.labName || '';
    $('densityUnit').value = project.densityUnit || 'lbm/ft3';
    state.workbookDepthUnit = project.depthUnit || null;
    state.workbookSourceFile = null;
    saveSettings();
    renderFiles();
    setSource(example, 'example_project.xml');
  }

  /** Fill the form from any Project sheet / project.csv just loaded. */
  function applyProject(entries) {
    entries.forEach(function (f) {
      var rows = L.fileRows(f);
      if (!rows.length) return;
      var id = f.template || L.detectTemplate(f.detectName || f.name, rows[0]);
      if (id !== 'project') return;
      var s = L.projectSettings(rows);
      state.workbookDepthUnit = s.depthUnit || null;
      state.workbookSourceFile = s.sourceFile || null;
      Object.keys(s).forEach(function (k) {
        if (!$(k)) return;
        if (state.source && ['projectName', 'projectNumber', 'client', 'depthUnit'].indexOf(k) >= 0) return;
        $(k).value = s[k];
      });
    });
    saveSettings();
  }

  // ------------------------------------------------------------------ settings
  var SETTING_IDS = ['projectName', 'projectNumber', 'client', 'labName', 'depthUnit', 'densityUnit'];

  function radioValue(name, fallback) {
    var el = document.querySelector('input[name=' + name + ']:checked');
    return el ? el.value : fallback;
  }

  function settings() {
    var s = { borings: state.borings, toolVersion: TOOL_VERSION.indexOf('__') === 0 ? '' : TOOL_VERSION };
    SETTING_IDS.forEach(function (id) { s[id] = $(id).value.trim(); });
    if (state.source) {
      s.source = state.source;
      s.boringStatus = radioValue('boringStatus', 'as drilled');
      s.previousLab = radioValue('previousLab', 'replace');
      s.workbookDepthUnit = state.workbookDepthUnit;
      s.projectName = state.source.projectName;
    }
    return s;
  }

  function saveSettings() {
    var s = {};
    SETTING_IDS.forEach(function (id) { s[id] = $(id).value; });
    store(SETTINGS_KEY, JSON.stringify(s));
  }

  function initSettings() {
    var sel = $('densityUnit');
    Object.keys(L.DENSITY_UNITS).forEach(function (u) {
      sel.appendChild(h('option', { value: u, text: L.DENSITY_UNITS[u] }));
    });
    try {
      var saved = JSON.parse(recall(SETTINGS_KEY) || '{}');
      SETTING_IDS.forEach(function (id) { if (saved[id] != null) $(id).value = saved[id]; });
    } catch (e) { /* ignore */ }
    SETTING_IDS.forEach(function (id) {
      $(id).addEventListener('input', function () { saveSettings(); scheduleRebuild(); });
      $(id).addEventListener('change', function () { saveSettings(); scheduleRebuild(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=boringStatus], input[name=previousLab]'), function (r) {
      r.addEventListener('change', scheduleRebuild);
    });
  }

  // ------------------------------------------------------------------ result files
  function readFiles(list) {
    var pending = Array.prototype.slice.call(list);
    var problems = [];
    // a DIGGS file dropped here is the starting file
    var xml = pending.filter(function (f) { return /\.(xml|diggs)$/i.test(f.name); });
    pending = pending.filter(function (f) { return !/\.(xml|diggs)$/i.test(f.name); });
    if (xml.length) readSourceFiles(xml);
    var jobs = pending.map(function (f) {
      if (/\.(xls|ods|numbers)$/i.test(f.name)) {
        problems.push(f.name + ': save it as an Excel .xlsx workbook first.');
        return Promise.resolve(null);
      }
      var isWorkbook = /\.(xlsx|xlsm)$/i.test(f.name);
      return readAs(f, isWorkbook ? 'bytes' : 'text').then(function (data) {
        if (!isWorkbook) return [{ name: f.name, source: f.name, text: String(data), template: '' }];
        var entries = L.workbookEntries(f.name, new Uint8Array(data));
        if (!entries.length) problems.push(f.name + ': no filled-in sheets were found.');
        return entries;
      }).catch(function (e) {
        problems.push(f.name + ': ' + (e && e.message || e));
        return null;
      });
    });
    if (!jobs.length) return;
    Promise.all(jobs).then(function (loaded) {
      var added = [];
      loaded.forEach(function (entries) {
        if (!entries || !entries.length) return;
        // re-adding a file replaces everything that came from it
        var src = entries[0].source;
        state.files = state.files.filter(function (x) { return x.source !== src; });
        entries.forEach(function (e) { state.files.push(e); added.push(e); });
      });
      if (added.length) applyProject(added);
      state.loadProblems = problems;
      renderFiles();
      rebuild();
    });
  }

  function renderFiles() {
    var table = $('file-table'), tbody = table.querySelector('tbody');
    tbody.textContent = '';
    table.hidden = !state.files.length;
    state.files.forEach(function (f, i) {
      var rows = L.fileRows(f);
      var detected = rows.length ? L.detectTemplate(f.detectName || f.name, rows[0]) : null;
      var sel = h('select', { 'aria-label': 'Template for ' + f.name, onchange: function () {
        f.template = sel.value; rebuild();
      } }, [h('option', { value: '', text: detected ? 'Auto: ' + L.TEMPLATE_BY_ID[detected].title : 'Not recognised: choose' })]
        .concat(L.TEMPLATES.map(function (t) { return h('option', { value: t.id, text: t.title }); })));
      sel.value = f.template || '';
      tbody.appendChild(h('tr', {}, [
        h('td', { text: f.name }),
        h('td', {}, [sel]),
        h('td', { text: String(Math.max(rows.length - 1, 0)) }),
        h('td', {}, [h('button', { type: 'button', class: 'linkbtn', text: 'Remove', 'aria-label': 'Remove ' + f.name,
          onclick: function () { state.files.splice(i, 1); state.loadProblems = []; renderFiles(); rebuild(); } })])
      ]));
    });
  }

  // ------------------------------------------------------------------ borings (no starting file)
  var BORING_FIELDS = [['lat', 'e.g. 35.7802'], ['lon', 'e.g. -78.6401'], ['elev', ''], ['total', 'from samples'], ['date', 'YYYY-MM-DD']];

  function renderBorings(ds) {
    var section = $('step-borings'), tbody = $('boring-table').querySelector('tbody');
    var ids = ds && !ds.merge ? ds.boringOrder : [];
    section.hidden = !ids.length;
    // keep focus while typing: only rebuild rows when the boring list changes
    var current = JSON.stringify(Array.prototype.map.call(tbody.rows, function (r) { return r.dataset.id; }));
    var unit = $('depthUnit').value;
    var headCells = $('boring-table').querySelectorAll('th');
    headCells[3].textContent = 'Ground elev. (' + unit + ')';
    headCells[4].textContent = 'Total depth (' + unit + ')';
    if (current !== JSON.stringify(ids)) {
      tbody.textContent = '';
      ids.forEach(function (id) {
        var tr = h('tr', {}, [h('td', { text: id })]);
        tr.dataset.id = id;
        BORING_FIELDS.forEach(function (f) {
          var input = h('input', { type: 'text', inputmode: f[0] === 'date' ? 'text' : 'decimal',
            placeholder: f[1], 'aria-label': id + ' ' + f[0] });
          input.dataset.field = f[0];
          input.addEventListener('input', function () {
            var o = state.borings[id] = state.borings[id] || {};
            o[f[0]] = input.value;
            scheduleRebuild();
          });
          tr.appendChild(h('td', {}, [input]));
        });
        tbody.appendChild(tr);
      });
    }
    Array.prototype.forEach.call(tbody.rows, function (tr) {
      var b = ds.borings[tr.dataset.id];
      var typed = state.borings[tr.dataset.id] || {};
      Array.prototype.forEach.call(tr.querySelectorAll('input'), function (input) {
        var k = input.dataset.field;
        if (document.activeElement !== input && typed[k] === undefined) {
          var v = b[k];
          input.value = v == null ? '' : (typeof v === 'number' ? L.fmt(v) : v);
          if (k === 'total' && b.totalComputed) { input.value = ''; input.placeholder = L.fmt(b.total) + ' (deepest sample)'; }
        }
        input.classList.toggle('missing', (k === 'lat' || k === 'lon') && b[k] == null);
      });
    });
  }

  // ------------------------------------------------------------------ build
  var timer = null;
  function scheduleRebuild() { clearTimeout(timer); timer = setTimeout(rebuild, 250); }

  function rebuild() {
    var summary = $('summary'), messages = $('messages');
    messages.textContent = '';
    state.xml = null;
    $('online-result').textContent = '';
    if ((state.loadProblems || []).length) {
      messages.appendChild(msgBox('error', 'These files were not used', state.loadProblems));
    }
    if (!state.files.length) {
      state.ds = null;
      summary.textContent = '';
      summary.appendChild(h('p', { class: 'muted', text: state.source
        ? 'Add the filled-in workbook (step 3) to add results to ' + state.source.fileName + '.'
        : 'Add your filled-in workbook to begin.' }));
      renderBorings(null);
      setOutputs();
      return;
    }
    var st = settings();
    var ds;
    try {
      ds = L.buildDataset(state.files, st);
    } catch (e) {
      messages.appendChild(msgBox('error', 'Something went wrong reading the files', [String(e && e.message || e)]));
      setOutputs();
      return;
    }
    state.ds = ds;
    renderFiles();
    renderBorings(ds);
    var errors = ds.errors.slice();
    var warnings = ds.warnings.slice();
    if (!st.source && !st.projectName) errors.unshift('Enter a project name (step 2 or the Project sheet), or start from the project DIGGS file (step 1).');
    if (st.source && state.workbookSourceFile && stem(state.workbookSourceFile) !== stem(st.source.fileName)) {
      warnings.unshift('The workbook was prepared from ' + state.workbookSourceFile + ', but the starting file is ' +
                       st.source.fileName + '. Check that they belong to the same project.');
    }
    if (!st.source && state.workbookSourceFile) {
      warnings.unshift('The workbook was prepared from ' + state.workbookSourceFile + '. Add that file in step 1 so the results are added to it.');
    }
    if (st.source && st.boringStatus === 'proposed') {
      warnings.push('The boring locations are marked as proposed. This is noted in the file; when the as-drilled DIGGS file is available, add the same workbook to it.');
    }

    var s = L.summarize(ds);
    summary.textContent = '';
    summary.appendChild(h('div', { class: 'stats' }, [
      h('div', { class: 'stat' }, [h('b', { text: String(s.borings) }), 'borings']),
      h('div', { class: 'stat' }, [h('b', { text: String(s.samples) }), 'samples']),
      h('div', { class: 'stat' }, [h('b', { text: String(s.tests) }), 'tests'])
    ]));
    var kinds = Object.keys(s.byKind).map(function (k) { return k + ': ' + s.byKind[k]; });
    if (kinds.length) summary.appendChild(h('p', { class: 'kinds', text: kinds.join('  ·  ') }));
    if (st.source) {
      var matched = ds.sampleOrder.filter(function (k) { return ds.samples[k].sourceId; }).length;
      summary.appendChild(h('p', { class: 'kinds', text: matched + ' of ' + s.samples + ' samples found in ' +
        st.source.fileName + '; ' + (s.samples - matched) + ' will be added.' }));
    }

    if (errors.length) messages.appendChild(msgBox('error', 'Fix these before the file can be built (' + errors.length + ')', errors));
    if (warnings.length) messages.appendChild(msgBox('warn', 'Warnings (' + warnings.length + ')', warnings));

    if (!errors.length) {
      try {
        state.xml = st.source ? L.mergeDiggs(st.source, ds, st) : L.generateDiggs(ds, st);
        messages.insertBefore(msgBox('ok', st.source
          ? 'Ready: ' + s.tests + ' tests added to ' + st.source.fileName + ' (' + (state.xml.length / 1024).toFixed(0) + ' KB)'
          : 'DIGGS file ready: ' + (state.xml.length / 1024).toFixed(0) + ' KB', []), messages.firstChild);
      } catch (e) {
        messages.appendChild(msgBox('error', 'Could not build the file', [String(e && e.message || e)]));
      }
    }
    setOutputs();
  }

  function setOutputs() {
    var ready = !!state.xml;
    $('dl-xml').disabled = !ready;
    $('btn-validate').disabled = !ready;
    $('btn-inspector').disabled = !ready;
    $('preview-wrap').hidden = !ready;
    var pre = $('preview');
    if (!ready) { pre.textContent = ''; return; }
    var text = state.xml;
    if (state.source) {
      // show the added records, not the whole project file
      var added = text.match(/<(samplingActivity|sample|measurement|auditTrail) xmlns="http:\/\/diggsml\.org\/schemas\/3"[\s\S]*?<\/\1>/g) || [];
      text = added.join('\n');
    }
    var lines = text.split('\n');
    pre.textContent = lines.slice(0, 400).join('\n') + (lines.length > 400 ? '\n... (' + (lines.length - 400) + ' more lines)' : '');
  }

  function outName() {
    var n = ($('outName').value || 'lab_results_diggs').trim().replace(/\.xml$/i, '');
    return (safeName(n) || 'lab_results_diggs') + '.xml';
  }

  // ------------------------------------------------------------------ online (optional)
  function xmlBlob() { return new Blob([state.xml], { type: 'application/xml' }); }

  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.classList.add('busy'); btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.classList.remove('busy'); btn.disabled = !state.xml; }
  }

  function networkMessage(e) {
    return 'Could not reach diggs.geosetta.org (' + (e && e.message || e) + '). Check your internet connection and try again.';
  }

  function reportMessages(xmlText) {
    var out = [];
    try {
      var doc = new DOMParser().parseFromString(xmlText || '', 'application/xml');
      Array.prototype.forEach.call(doc.getElementsByTagName('message'), function (m) {
        var sev = ((m.getElementsByTagName('severity')[0] || {}).textContent || '').trim().toUpperCase();
        if (sev !== 'ERROR' && sev !== 'WARNING') return;
        var text = ((m.getElementsByTagName('text')[0] || {}).textContent || '').replace(/\s+/g, ' ').trim();
        var path = ((m.getElementsByTagName('elementPath')[0] || {}).textContent || '').trim();
        out.push({ sev: sev, text: text + (path ? '  [' + path + ']' : '') });
      });
    } catch (e) { /* ignore */ }
    return out;
  }

  function validateOnline() {
    var btn = $('btn-validate'), box = $('online-result');
    box.textContent = '';
    var fd = new FormData();
    fd.append('file', xmlBlob(), outName());
    busy(btn, true, 'Checking...');
    fetch(API + '/diggs/validate?profile=cert', { method: 'POST', body: fd })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      })
      .then(function (res) {
        if (!res.ok) {
          box.appendChild(msgBox('error', 'The check failed (' + res.status + ')', [String(res.body && res.body.detail || '')]));
          return;
        }
        var b = res.body;
        var msgs = reportMessages(b.xml_report);
        var errs = msgs.filter(function (m) { return m.sev === 'ERROR'; }).map(function (m) { return m.text; });
        var warns = msgs.filter(function (m) { return m.sev === 'WARNING'; }).map(function (m) { return m.text; });
        var cl = b.codelist || {};
        var clErrs = (cl.errors || []).map(function (e) { return typeof e === 'string' ? e : (e.message || JSON.stringify(e)); });
        box.appendChild(b.valid
          ? msgBox('ok', 'Passed: schema, codelist and business-rule checks.', [])
          : msgBox('error', 'The file did not pass every check', []));
        if (state.source && !b.valid) {
          box.appendChild(msgBox('warn', 'Some of these may come from ' + state.source.fileName +
            ' itself rather than from the lab results. Check the starting file on its own to compare.', []));
        }
        if (b.validation_mode === 'xsd_only') {
          box.appendChild(msgBox('warn', String(b.message || 'Large file: only the schema was checked.'), []));
        }
        if (clErrs.length) box.appendChild(msgBox('error', 'Codelist errors (' + clErrs.length + ')', clErrs));
        if (errs.length) box.appendChild(msgBox('error', 'Schema / business-rule errors (' + errs.length + ')', errs));
        if (warns.length) box.appendChild(msgBox('warn', 'Business-rule warnings (' + warns.length + ')', warns));
      })
      .catch(function (e) { box.appendChild(msgBox('error', networkMessage(e), [])); })
      .then(function () { busy(btn, false); });
  }

  function buildInspector() {
    var btn = $('btn-inspector'), box = $('online-result');
    box.textContent = '';
    var fd = new FormData();
    fd.append('file', xmlBlob(), outName());
    fd.append('tool', 'inspector');
    busy(btn, true, 'Building...');
    fetch(API + '/viewer/wrap', { method: 'POST', body: fd })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var detail = t;
            try { detail = JSON.parse(t).detail || t; } catch (e) { /* not JSON */ }
            throw new Error('(' + r.status + ') ' + detail);
          });
        }
        return r.blob();
      })
      .then(function (blob) {
        var name = outName().replace(/\.xml$/, '') + '_inspector.html';
        download(name, blob, 'text/html');
        box.appendChild(msgBox('ok', 'Downloaded ' + name + '. Open it in your browser; it works offline.', []));
      })
      .catch(function (e) {
        var msg = /\(\d{3}\)/.test(String(e && e.message)) ? 'The inspector could not be built ' + e.message : networkMessage(e);
        box.appendChild(msgBox('error', msg, []));
      })
      .then(function () { busy(btn, false); });
  }

  // ------------------------------------------------------------------ update check
  function checkForUpdate() {
    if (TOOL_VERSION.indexOf('__') === 0) return;
    fetch(API + '/lab-diggs-builder/version', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.version || d.version === TOOL_VERSION) return;
        if (recall(DISMISS_KEY) === d.version) return;
        var banner = $('update-banner');
        banner.hidden = false;
        $('update-dismiss').addEventListener('click', function () {
          banner.hidden = true;
          store(DISMISS_KEY, d.version);
        });
      })
      .catch(function () { /* offline: fine */ });
  }

  // ------------------------------------------------------------------ init
  function init() {
    if (TOOL_VERSION.indexOf('__') === 0) $('tool-version').textContent = 'development';
    renderTemplates();
    initSettings();
    wireDropzone($('source-drop'), $('source-input'), readSourceFiles);
    wireDropzone($('dropzone'), $('file-input'), readFiles);
    // a file dropped outside the zones should not navigate away from the page
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    $('source-remove').addEventListener('click', function () {
      state.source = null;
      state.sourceProblem = null;
      renderSource();
      rebuild();
    });
    $('dl-xml').addEventListener('click', function () {
      if (state.xml) download(outName(), state.xml, 'application/xml');
    });
    $('btn-validate').addEventListener('click', validateOnline);
    $('btn-inspector').addEventListener('click', buildInspector);
    renderSource();
    rebuild();
    checkForUpdate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
