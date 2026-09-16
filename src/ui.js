/* Lab Results -> DIGGS: page behaviour. Logic lives in core.js (LabDiggs). */
(function () {
  'use strict';
  var L = LabDiggs;
  var API = 'https://diggs.geosetta.org/api';
  var TOOL_VERSION = '__TOOL_VERSION__';
  var SETTINGS_KEY = 'lab_diggs_builder_settings';
  var DISMISS_KEY = 'lab_diggs_builder_dismissed_version';

  var state = { files: [], borings: {}, xml: null, ds: null };
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

  // ------------------------------------------------------------------ templates
  var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
    help.appendChild(h('p', { text: 'In Excel, select a header or a cell to see its note. Header names are matched loosely, so "Boring", "Sample", "Depth", "LL" and "PL" are recognised too.' }));
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

    function zipAll(examples) {
      var entries = L.TEMPLATES.map(function (t) { return { name: t.id + '.csv', text: L.templateCSV(t.id, examples) }; });
      download(examples ? 'lab_diggs_csv_templates_examples.zip' : 'lab_diggs_csv_templates.zip',
               new Blob([L.makeZip(entries)], { type: 'application/zip' }));
    }
    $('dl-all-templates').addEventListener('click', function () { zipAll(false); });
    $('dl-all-examples').addEventListener('click', function () { zipAll(true); });

    $('load-example').addEventListener('click', function () {
      state.files = L.workbookEntries('example workbook', L.writeWorkbook(true));
      state.borings = {};
      applyProject(state.files);
      renderFiles();
      rebuild();
    });
  }

  /** Fill the project form from any Project sheet / project.csv just loaded. */
  function applyProject(entries) {
    entries.forEach(function (f) {
      var rows = L.fileRows(f);
      if (!rows.length) return;
      var id = f.template || L.detectTemplate(f.detectName || f.name, rows[0]);
      if (id !== 'project') return;
      var s = L.projectSettings(rows);
      Object.keys(s).forEach(function (k) { if ($(k)) $(k).value = s[k]; });
    });
    saveSettings();
  }

  // ------------------------------------------------------------------ settings
  var SETTING_IDS = ['projectName', 'projectNumber', 'client', 'labName', 'depthUnit', 'densityUnit'];

  function settings() {
    var s = { borings: state.borings, toolVersion: TOOL_VERSION.indexOf('__') === 0 ? '' : TOOL_VERSION };
    SETTING_IDS.forEach(function (id) { s[id] = $(id).value.trim(); });
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
  }

  // ------------------------------------------------------------------ files
  function readFiles(list) {
    var pending = Array.prototype.slice.call(list);
    var problems = [];
    var jobs = pending.map(function (f) {
      if (/\.(xls|ods|numbers)$/i.test(f.name)) {
        problems.push(f.name + ': save it as an Excel .xlsx workbook first.');
        return Promise.resolve(null);
      }
      var isWorkbook = /\.(xlsx|xlsm)$/i.test(f.name);
      return new Promise(function (resolve) {
        var r = new FileReader();
        r.onload = function () {
          if (!isWorkbook) { resolve([{ name: f.name, source: f.name, text: String(r.result), template: '' }]); return; }
          try {
            var entries = L.workbookEntries(f.name, new Uint8Array(r.result));
            if (!entries.length) problems.push(f.name + ': no filled-in sheets were found.');
            resolve(entries);
          } catch (e) {
            problems.push(f.name + ': ' + (e && e.message || e));
            resolve(null);
          }
        };
        r.onerror = function () { problems.push(f.name + ': the file could not be read.'); resolve(null); };
        if (isWorkbook) r.readAsArrayBuffer(f); else r.readAsText(f);
      });
    });
    Promise.all(jobs).then(function (loaded) {
      var added = [];
      loaded.forEach(function (entries) {
        if (!entries) return;
        // re-adding a file replaces everything that came from it
        var src = entries.length ? entries[0].source : null;
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

  function initDropzone() {
    var dz = $('dropzone'), input = $('file-input');
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { readFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer) readFiles(e.dataTransfer.files); });
    // a file dropped outside the zone should not navigate away from the page
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  // ------------------------------------------------------------------ borings
  var BORING_FIELDS = [['lat', 'e.g. 35.7802'], ['lon', 'e.g. -78.6401'], ['elev', ''], ['total', 'from samples'], ['date', 'YYYY-MM-DD']];

  function renderBorings(ds) {
    var section = $('step-borings'), tbody = $('boring-table').querySelector('tbody');
    var ids = ds ? ds.boringOrder : [];
    section.hidden = !ids.length;
    // keep focus while typing: only rebuild rows when the boring list changes
    var current = Array.prototype.map.call(tbody.rows, function (r) { return r.dataset.id; }).join('\u0000');
    var unit = $('depthUnit').value;
    var headCells = $('boring-table').querySelectorAll('th');
    headCells[3].textContent = 'Ground elev. (' + unit + ')';
    headCells[4].textContent = 'Total depth (' + unit + ')';
    if (current !== ids.join('\u0000')) {
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

  function msgBox(kind, title, items, limit) {
    limit = limit || 200;
    var ul = h('ul');
    items.slice(0, limit).forEach(function (m) { ul.appendChild(h('li', { text: m })); });
    if (items.length > limit) ul.appendChild(h('li', { text: '... and ' + (items.length - limit) + ' more' }));
    return h('div', { class: 'msgbox ' + kind, role: kind === 'error' ? 'alert' : null },
             [h('h3', { text: title }), items.length ? ul : null]);
  }

  function rebuild() {
    var summary = $('summary'), messages = $('messages');
    messages.textContent = '';
    state.xml = null;
    $('online-result').textContent = '';
    if (!state.files.length) {
      state.ds = null;
      summary.textContent = '';
      summary.appendChild(h('p', { class: 'muted', text: 'Add your filled-in workbook to begin.' }));
      if ((state.loadProblems || []).length) {
        messages.appendChild(msgBox('error', 'These files could not be used', state.loadProblems));
      }
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
    if (!st.projectName) errors.unshift('Enter a project name (step 2 or the Project sheet).');
    if ((state.loadProblems || []).length) {
      messages.appendChild(msgBox('error', 'These files were not used', state.loadProblems));
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

    if (errors.length) messages.appendChild(msgBox('error', 'Fix these before the file can be built (' + errors.length + ')', errors));
    if (ds.warnings.length) messages.appendChild(msgBox('warn', 'Warnings (' + ds.warnings.length + ')', ds.warnings));

    if (!errors.length) {
      try {
        state.xml = L.generateDiggs(ds, st);
        messages.insertBefore(msgBox('ok', 'DIGGS file ready: ' + (state.xml.length / 1024).toFixed(0) + ' KB', []),
                              messages.firstChild);
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
    if (ready) {
      var lines = state.xml.split('\n');
      pre.textContent = lines.slice(0, 400).join('\n') + (lines.length > 400 ? '\n... (' + (lines.length - 400) + ' more lines)' : '');
    } else {
      pre.textContent = '';
    }
  }

  function outName() {
    var n = ($('outName').value || 'lab_results_diggs').trim().replace(/\.xml$/i, '');
    return (n.replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'lab_results_diggs') + '.xml';
  }

  // ------------------------------------------------------------------ online
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
        var sev = (m.getElementsByTagName('severity')[0] || {}).textContent || '';
        sev = sev.trim().toUpperCase();
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
        if (b.valid) {
          box.appendChild(msgBox('ok', 'Passed: schema, codelist and business-rule checks.', []));
        } else {
          box.appendChild(msgBox('error', 'The file did not pass every check', []));
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
    if (TOOL_VERSION.indexOf('__') === 0 || location.protocol === 'about:') return;
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
    initDropzone();
    $('dl-xml').addEventListener('click', function () {
      if (state.xml) download(outName(), state.xml, 'application/xml');
    });
    $('btn-validate').addEventListener('click', validateOnline);
    $('btn-inspector').addEventListener('click', buildInspector);
    rebuild();
    checkForUpdate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
