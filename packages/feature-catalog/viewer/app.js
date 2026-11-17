// Interaktive Ansicht des Feature-Katalogs. Daten: <script id="catalog-data"> (erzeugt aus catalog/*.yaml).
'use strict';
(function () {
  const data = JSON.parse(document.getElementById('catalog-data').textContent);
  const $ = (id) => document.getElementById(id);

  const CHANNELS = { leitstand: 'Leitstand', scanner: 'Scanner', api: 'API', 'node-red': 'Node-RED', mqtt: 'MQTT' };
  const ROLES = ['admin', 'leitstand', 'lager', 'anlage', 'lesen'];
  const PROOF = {
    nachgewiesen: ['ok', 'nachgewiesen', 'Alle Nachweise haben im letzten Testlauf bestanden'],
    statisch: ['warn', 'Nachweis vorhanden', 'Tests und Szenarien existieren; ohne Testbericht erzeugt, daher nicht als bestanden bestätigt'],
    'nicht-nachgewiesen': ['bad', 'nicht nachgewiesen', 'Mindestens ein Nachweis fehlt, ist fehlgeschlagen oder lief nicht'],
  };
  const RESULT = { bestanden: ['ok', 'bestanden'], fehlgeschlagen: ['bad', 'fehlgeschlagen'], uebersprungen: ['warn', 'übersprungen'], 'nicht-ausgefuehrt': ['bad', 'nicht ausgeführt'] };
  const REVIEW_STATE = { unvollstaendig: 'unvollständig', deaktiviert: 'deaktiviert', 'nicht-nachgewiesen': 'nicht nachgewiesen' };
  const EVIDENCE_KIND = { scenario: 'Node-RED-Szenario', integration: 'Integrationstest', unit: 'Unit-Test', 'web-e2e': 'Browser-Test' };

  const state = { tab: 'katalog', area: null, group: null, query: '', roles: new Set(), channels: new Set(), proof: '', open: new Set() };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  /** Kleines Markdown: `code`, **fett**, Absätze. */
  const md = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, ' ')}</p>`)
      .join('');
  const inline = (s) => md(s).replace(/^<p>|<\/p>$/g, '');
  const badge = (cls, text, title) => `<span class="badge ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
  const areaById = Object.fromEntries(data.areas.map((a) => [a.id, a]));
  const groupById = Object.fromEntries(data.areas.flatMap((a) => a.groups.map((g) => [g.id, g])));
  const titleOf = Object.fromEntries([...data.features, ...data.review].map((f) => [f.id, f.title]));

  function haystack(f) {
    const t = f.technical;
    return [
      f.id, f.title, f.summary, f.description, f.reason, ...f.usage.map((u) => u.text), ...f.rules, ...f.settings.map((s) => `${s.name} ${s.description}`),
      ...t.components, ...t.endpoints.map((e) => `${e.ref} ${e.summary}`), ...t.events.emits, ...t.events.consumes, ...t.uiRoutes, ...t.nodeRedNodes, ...t.notes,
    ].join(' ').toLowerCase();
  }

  function matches(f) {
    if (state.area && f.area !== state.area) return false;
    if (state.group && f.group !== state.group) return false;
    if (state.roles.size && ![...state.roles].some((r) => f.roles.includes(r))) return false;
    if (state.channels.size && ![...state.channels].some((c) => f.channels.includes(c))) return false;
    if (state.proof && f.proof !== state.proof) return false;
    if (state.query) return state.query.toLowerCase().split(/\s+/).every((w) => haystack(f).includes(w));
    return true;
  }

  // --- Navigation ------------------------------------------------------------------
  function renderNav() {
    const list = state.tab === 'pruefbestand' ? data.review : data.features;
    let html = `<div class="area"><button data-area="" class="${!state.area ? 'active' : ''}">Alle Bereiche <span class="count">${list.length}</span></button></div>`;
    for (const a of data.areas) {
      const n = list.filter((f) => f.area === a.id).length;
      const open = a.status === 'offen';
      html += `<div class="area ${open ? 'open-area' : ''}"><button data-area="${a.id}" class="${state.area === a.id && !state.group ? 'active' : ''}" title="${esc(a.summary)}">${esc(a.title)} <span class="count">${open ? 'offen' : n}</span></button>`;
      if (state.area === a.id) {
        for (const g of a.groups) {
          const gn = list.filter((f) => f.group === g.id).length;
          html += `<div class="group"><button data-area="${a.id}" data-group="${g.id}" class="${state.group === g.id ? 'active' : ''}" title="${esc(g.summary)}">${esc(g.title)} <span class="count">${gn}</span></button></div>`;
        }
      }
      html += '</div>';
    }
    $('nav').innerHTML = html;
  }

  // --- Karten ----------------------------------------------------------------------
  function evidenceRow(e) {
    const what = e.kind === 'scenario' ? `<code>${esc(e.id)}</code>` : `${esc(e.test)}<br><span class="muted">${esc(e.file)}</span>`;
    const result = !e.exists ? badge('bad', 'fehlt') : e.result ? badge(...RESULT[e.result]) : badge('', 'nicht im Bericht');
    return `<tr><td>${esc(EVIDENCE_KIND[e.kind])}</td><td>${what}${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ''}</td><td>${result}</td></tr>`;
  }

  function technical(f) {
    const t = f.technical;
    const access = (a) => (a.kind === 'public' ? 'ohne Anmeldung' : a.kind === 'authenticated' ? 'jede angemeldete Rolle' : a.roles.join(', '));
    let html = '';
    if (t.endpoints.length) {
      html += `<h4>API-Endpunkte</h4><div class="table-wrap"><table><thead><tr><th>Endpunkt</th><th>Zweck</th><th>Berechtigung</th><th>Aufgerufen in</th></tr></thead><tbody>`;
      for (const e of t.endpoints) {
        const [method, path] = e.ref.split(' ');
        html += `<tr><td><span class="method">${esc(method)}</span> <code>${esc(path)}</code></td><td>${esc(e.summary)}</td><td>${esc(access(e.access))}</td><td>${
          e.calledBy.length ? e.calledBy.map((c) => `<code>${esc(c.split('/').pop())}</code>`).join(' ') : badge('warn', 'kein Test erkannt')
        }</td></tr>`;
      }
      html += '</tbody></table></div><p class="muted">Berechtigung aus der Rechtetabelle der API; „Aufgerufen in“ ist eine statische Erkennung in Tests und Szenarien.</p>';
    }
    const list = (title, items, fmt = (x) => `<code>${esc(x)}</code>`) => (items.length ? `<h4>${title}</h4><ul>${items.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>` : '');
    html += list('Ereignisse (sendet)', t.events.emits);
    html += list('Ereignisse (empfängt)', t.events.consumes);
    html += list('Oberfläche', t.uiRoutes, (r) => `Route <code>${esc(r)}</code>`);
    html += list('Node-RED-Nodes', t.nodeRedNodes);
    html += list('Komponenten im Quellcode', t.components);
    html += list('Hinweise für Entwickler', t.notes, inline);
    if (f.evidence.length) {
      html += `<h4>Nachweise</h4><div class="table-wrap"><table><thead><tr><th>Art</th><th>Test / Szenario</th><th>Ergebnis</th></tr></thead><tbody>${f.evidence.map(evidenceRow).join('')}</tbody></table></div>`;
    }
    html += `<p class="muted">Kennung <code>${esc(f.id)}</code> · Quelle <code>catalog/${esc(f.source)}</code></p>`;
    return html;
  }

  function card(f) {
    const isOpen = state.open.has(f.id);
    const proof = PROOF[f.proof];
    const tags = [
      ...(f.state ? [badge('warn', REVIEW_STATE[f.state])] : [badge(proof[0], proof[1], proof[2])]),
      ...f.channels.map((c) => badge('channel', CHANNELS[c] || c)),
      ...(f.roles.length ? [badge('', `Rollen: ${f.roles.length === ROLES.length ? 'alle' : f.roles.join(', ')}`, 'Wer die Funktion ausführen darf (aus der Rechtetabelle der API)')] : []),
    ].join(' ');
    let body = '';
    if (isOpen) {
      const link = (id) => `<a href="#${esc(id)}" data-goto="${esc(id)}">${esc(titleOf[id] || id)}</a>`;
      body = `<div class="body">
        ${f.reason ? `<h4>Warum im Prüfbestand</h4>${md(f.reason)}` : ''}
        <h4>Was es leistet</h4>${md(f.description)}
        ${f.usage.length ? `<h4>So wird es verwendet</h4><ul>${f.usage.map((u) => `<li><strong>${esc(CHANNELS[u.channel])}:</strong> ${inline(u.text)}</li>`).join('')}</ul>` : ''}
        ${f.rules.length ? `<h4>Regeln und Grenzen</h4><ul>${f.rules.map((r) => `<li>${inline(r)}</li>`).join('')}</ul>` : ''}
        ${f.settings.length ? `<h4>Einstellbar</h4><ul>${f.settings.map((s) => `<li><strong>${esc(s.name)}</strong> – ${inline(s.description)}${s.where ? ` <span class="muted">(${inline(s.where)})</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${f.dependsOn.length ? `<h4>Setzt voraus</h4><ul>${f.dependsOn.map((d) => `<li>${link(d)}</li>`).join('')}</ul>` : ''}
        ${f.usedBy.length ? `<h4>Grundlage für</h4><ul>${f.usedBy.map((d) => `<li>${link(d)}</li>`).join('')}</ul>` : ''}
        <details class="tech"><summary>Technische Details</summary><div>${technical(f)}</div></details>
      </div>`;
    }
    return `<article class="card" id="${esc(f.id)}"><div class="head" data-toggle="${esc(f.id)}" role="button" tabindex="0" aria-expanded="${isOpen}">
      <h3>${esc(f.title)}</h3><span class="muted">${isOpen ? '▾' : '▸'}</span>
      <p class="sum">${esc(f.summary)}</p><div class="tags">${tags}</div></div>${body}</article>`;
  }

  // --- Ansichten -------------------------------------------------------------------
  function filters() {
    const chips = (kind, values, labels) =>
      values.map((v) => `<button class="chip ${state[kind].has(v) ? 'on' : ''}" data-filter="${kind}" data-value="${v}" aria-pressed="${state[kind].has(v)}">${esc(labels ? labels[v] : v)}</button>`).join('');
    const proofSelect =
      state.tab === 'katalog'
        ? `<span class="label">Nachweis</span><select id="proof" aria-label="Nachweis filtern"><option value="">alle</option>${Object.entries(PROOF)
            .map(([k, v]) => `<option value="${k}" ${state.proof === k ? 'selected' : ''}>${v[1]}</option>`)
            .join('')}</select>`
        : '';
    return `<div class="filters"><span class="label">Rolle</span>${chips('roles', ROLES)}<span class="label">Bedienweg</span>${chips('channels', Object.keys(CHANNELS), CHANNELS)}${proofSelect}</div>`;
  }

  function listView(list) {
    const area = state.area ? areaById[state.area] : null;
    let html = '';
    if (area) {
      html += `<div class="intro"><h2>${esc(state.group ? groupById[state.group].title : area.title)}</h2><p>${esc(state.group ? groupById[state.group].summary : area.summary)}</p>${
        area.status === 'offen' ? `<p><strong>Noch nicht katalogisiert:</strong> ${area.coverage.open.length} von ${area.coverage.total} erkannten Bestandteilen sind keinem Eintrag zugeordnet.</p>` : ''
      }</div>`;
    }
    html += filters();
    const shown = list.filter(matches);
    if (!shown.length) return `${html}<p class="empty">${list.length ? 'Keine Einträge für diese Auswahl.' : 'Noch keine Einträge.'}</p>`;
    const byGroup = new Map();
    for (const f of shown) byGroup.set(f.group, [...(byGroup.get(f.group) || []), f]);
    for (const a of data.areas) {
      for (const g of a.groups) {
        const items = byGroup.get(g.id);
        if (!items) continue;
        html += `<h2 class="group-title">${state.area ? '' : `${esc(a.title)} · `}${esc(g.title)}</h2>${items.map(card).join('')}`;
      }
    }
    return html;
  }

  function coverageView() {
    let html = `<div class="intro"><h2>Zuordnung</h2><p>Automatisch erkannte Bestandteile (Endpunkte, Ereignisse, Routen, Node-RED-Nodes) je Bereich und wie viele davon einem Katalog- oder Prüfbestand-Eintrag zugeordnet sind. Die Prüfung legt keine Features an – sie meldet nur Lücken.</p></div><div class="cov">`;
    for (const a of data.areas) {
      const c = a.coverage;
      const done = c.assigned + c.excluded;
      const pct = c.total ? Math.round((done / c.total) * 100) : 100;
      html += `<div class="row"><div><strong>${esc(a.title)}</strong><br><span class="muted">${a.status === 'katalogisiert' ? 'katalogisiert' : 'offen'}</span></div><div class="bar" title="${pct} %"><span style="width:${pct}%"></span></div><div>${done} / ${c.total}</div></div>`;
      if (state.area === a.id && c.open.length) {
        html += `<div class="intro"><ul>${c.open.map((i) => `<li>${esc(data.itemLabels[i.kind])} <code>${esc(i.ref)}</code></li>`).join('')}</ul></div>`;
      }
    }
    html += '</div>';
    if (data.unowned.length) html += `<h2 class="group-title">Keinem Bereich zugeordnet</h2><ul>${data.unowned.map((i) => `<li>${esc(data.itemLabels[i.kind])} <code>${esc(i.ref)}</code></li>`).join('')}</ul>`;
    if (data.findings.length) html += `<h2 class="group-title">Befunde der Prüfung</h2>${data.findings.map((f) => `<div class="finding ${f.level}"><strong>${esc(f.code)}</strong> ${esc(f.subject)} – ${esc(f.message)}</div>`).join('')}`;
    return html;
  }

  function render() {
    renderNav();
    const tabs = [
      ['katalog', `Katalog (${data.features.length})`],
      ['pruefbestand', `Prüfbestand (${data.review.length})`],
      ['zuordnung', 'Zuordnung'],
    ];
    const tabHtml = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${state.tab === k ? 'active' : ''}" aria-selected="${state.tab === k}">${l}</button>`).join('')}</div>`;
    const content = state.tab === 'katalog' ? listView(data.features) : state.tab === 'pruefbestand' ? listView(data.review) : coverageView();
    $('main').innerHTML = `${tabHtml}${content}<footer>Erzeugt ${new Date(data.generatedAt).toLocaleString('de-DE')}${data.commit ? ` aus Commit ${esc(data.commit)}` : ''}. Testberichte: ${
      data.reportedKinds.length ? data.reportedKinds.map((k) => EVIDENCE_KIND[k]).join(', ') : 'keine (nur statische Prüfung)'
    }. Quelle: catalog/*.yaml</footer>`;
    const proof = $('proof');
    if (proof) proof.onchange = () => ((state.proof = proof.value), render());
  }

  const proven = data.features.filter((f) => f.proof === 'nachgewiesen').length;
  const catalogued = data.areas.filter((a) => a.status === 'katalogisiert').length;
  $('stats').textContent = `${data.features.length} Features · ${proven} im Testlauf nachgewiesen · ${data.review.length} im Prüfbestand · ${catalogued} von ${data.areas.length} Bereichen katalogisiert`;

  function goto(id) {
    const inReview = data.review.some((f) => f.id === id);
    state.tab = inReview ? 'pruefbestand' : 'katalog';
    state.area = null;
    state.group = null;
    state.open.add(id);
    render();
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-area],[data-tab],[data-toggle],[data-filter],[data-goto]');
    if (!el) return;
    if (el.dataset.goto) {
      ev.preventDefault();
      history.replaceState(null, '', `#${el.dataset.goto}`);
      return goto(el.dataset.goto);
    }
    if (el.dataset.tab) state.tab = el.dataset.tab;
    else if (el.dataset.area !== undefined) {
      state.area = el.dataset.area || null;
      state.group = el.dataset.group || null;
    } else if (el.dataset.toggle) {
      const id = el.dataset.toggle;
      state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      history.replaceState(null, '', state.open.has(id) ? `#${id}` : '#');
    } else if (el.dataset.filter) {
      const set = state[el.dataset.filter];
      set.has(el.dataset.value) ? set.delete(el.dataset.value) : set.add(el.dataset.value);
    }
    render();
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.dataset && ev.target.dataset.toggle) {
      ev.preventDefault();
      ev.target.click();
    }
  });
  $('search').addEventListener('input', (ev) => {
    state.query = ev.target.value.trim();
    if (state.tab === 'zuordnung') state.tab = 'katalog';
    render();
  });
  $('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
  });

  const initial = decodeURIComponent(location.hash.slice(1));
  if (initial && titleOf[initial]) goto(initial);
  else render();
})();
