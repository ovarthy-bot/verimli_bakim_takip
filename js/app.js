import { STATUS, ALL_STATUSES, canTransition, recomputeReadiness } from './model/status.js';
import { buildPrereqMap, wouldCreateCycle, findCycle } from './model/graph.js';
import { createLocalRepo, exportJson, importJson } from './store/repo.js';

const LEVELS = [
  { key: 'genel', label: 'Genel', match: () => true },
  { key: 'kabin-ici', label: 'Kabin içi', match: (t) => t.level === 'kabin-ici' },
  { key: 'kabin-disi', label: 'Kabin dışı', match: (t) => t.level === 'kabin-disi' },
  { key: 'kontrol', label: 'Kontrol', match: (t) => t.level === 'kontrol' },
];

const COLORS = {
  [STATUS.WAITING]: '#9ca3af',
  [STATUS.READY]: '#2563eb',
  [STATUS.IN_PROGRESS]: '#f59e0b',
  [STATUS.DONE]: '#16a34a',
  [STATUS.BLOCKED]: '#dc2626',
};

const $ = (sel) => document.querySelector(sel);
const repo = createLocalRepo('data/seed.json');
let tasks = [];
let cy = null;
let selectedId = null;
let level = 'genel';

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2600);
}

function byId() {
  return new Map(tasks.map((t) => [t.id, t]));
}

/* ---------- Diyagram ---------- */
function initCy() {
  cy = cytoscape({
    container: $('#cy'),
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'text-wrap': 'wrap',
          'text-max-width': 120,
          'font-size': 11,
          'text-valign': 'center',
          color: '#fff',
          'background-color': 'data(color)',
          width: 150,
          height: 52,
          shape: 'round-rectangle',
          'border-width': 3,
          'border-color': '#fff',
        },
      },
      { selector: 'node:selected', style: { 'border-color': '#111', 'border-width': 4 } },
      {
        selector: 'edge',
        style: {
          width: 2,
          'line-color': '#94a3b8',
          'target-arrow-color': '#94a3b8',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
        },
      },
    ],
    layout: { name: 'preset' },
    wheelSensitivity: 0.2,
  });
  cy.on('tap', 'node', (evt) => selectTask(evt.target.id()));
}

function renderDiagram() {
  const visible = tasks.filter(LEVELS.find((l) => l.key === level).match);
  const ids = new Set(visible.map((t) => t.id));
  const elements = [];
  for (const t of visible) {
    elements.push({
      data: { id: t.id, label: `${t.id}\n${t.title}`, color: COLORS[t.status] || COLORS[STATUS.WAITING] },
    });
  }
  for (const t of visible) {
    for (const p of t.prerequisites) {
      // Seviye dışındaki ön koşulları kesik "dış bağımlılık" olarak göster
      if (ids.has(p)) {
        elements.push({ data: { id: `${p}->${t.id}`, source: p, target: t.id } });
      } else {
        elements.push({ data: { id: `${p}->${t.id}`, source: p, target: t.id } });
        elements.push({ data: { id: `ext-${p}`, label: '' } });
      }
    }
  }
  cy.elements().remove();
  // Dış bağımlılık düğümlerini (seviye dışı) kaldır: sadece görünen kenarlar kalsın
  const finalEls = elements.filter((e) => !e.data.id.startsWith('ext-'));
  const edges = finalEls.filter((e) => e.data.source);
  const nodes = finalEls.filter((e) => !e.data.source);
  cy.add(nodes.filter((n) => ids.has(n.data.id)));
  cy.add(edges.filter((e) => ids.has(e.data.source) && ids.has(e.data.target)));
  cy.layout({ name: 'breadthfirst', directed: true, padding: 20, spacingFactor: 1.2, grid: true }).run();
  cy.fit(undefined, 20);
}

/* ---------- Görev paneli ---------- */
function selectTask(id) {
  selectedId = id;
  renderPanel();
  cy?.getElementById(id)?.select();
}

function renderPanel() {
  const panel = $('#panel');
  const t = byId().get(selectedId);
  if (!t) {
    panel.innerHTML = '<p class="muted">Diyagramda bir göreve dokunun.</p>';
    return;
  }
  const map = byId();
  const prereqs = t.prerequisites.map((p) => `${p} (${map.get(p)?.status ?? '?'})`).join(', ') || 'Yok';
  panel.innerHTML = `
    <h2>${t.id} — ${escapeHtml(t.title)}</h2>
    <div class="muted">${escapeHtml(t.zone)} · ${escapeHtml(t.team)} · Ref: ${escapeHtml(t.reference || '-')}</div>
    <div class="muted">Ön koşullar: ${escapeHtml(prereqs)}</div>
    <label>Durum
      <select id="f-status">${ALL_STATUSES.map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </label>
    <label>Bloke / not
      <textarea id="f-note" rows="2">${escapeHtml(t.note || '')}</textarea>
    </label>
    <label>Ön koşullar (virgülle ID)
      <input id="f-prereq" value="${escapeHtml(t.prerequisites.join(', '))}">
    </label>
    <div class="row">
      <button id="btn-save" type="button">Kaydet</button>
    </div>
    <div id="err" class="err" role="alert"></div>`;
  $('#btn-save').onclick = () => saveSelected(t.id);
}

async function saveSelected(id) {
  const t = byId().get(id);
  const err = $('#err');
  err.textContent = '';
  const next = $('#f-status').value;
  const note = $('#f-note').value.trim();
  const prereqs = $('#f-prereq').value.split(',').map((s) => s.trim()).filter(Boolean);

  const map = buildPrereqMap(tasks);
  const known = byId();
  for (const p of prereqs) {
    if (!known.has(p)) return (err.textContent = `Bilinmeyen ön koşul: ${p}`);
    if (wouldCreateCycle(map, id, p)) return (err.textContent = `Döngü oluşturur: ${id} ← ${p}`);
  }
  const candidate = { ...t, prerequisites: prereqs, note, status: t.status };
  const trial = new Map(known);
  trial.set(id, candidate);
  if (next !== t.status) {
    const r = canTransition({ ...candidate }, trial, next);
    if (!r.ok) return (err.textContent = r.reason);
    candidate.status = next;
  }
  if (findCycle(buildPrereqMap(tasks.map((x) => (x.id === id ? candidate : x))))) {
    return (err.textContent = 'Döngü tespit edildi.');
  }
  await repo.update(candidate);
  toast(`${id} güncellendi`);
  render();
}

/* ---------- Liste ve ilerleme ---------- */
function renderList() {
  $('#task-list').innerHTML = tasks
    .map(
      (t) => `<li><span><strong>${t.id}</strong> ${escapeHtml(t.title)}</span>
        <button type="button" data-id="${t.id}" aria-label="${t.id} seç">${t.status}</button></li>`
    )
    .join('');
  for (const b of $('#task-list').querySelectorAll('button')) {
    b.onclick = () => selectTask(b.dataset.id);
  }
}

function renderProgress() {
  const total = tasks.length || 1;
  const count = (s) => tasks.filter((t) => t.status === s).length;
  const segs = ALL_STATUSES.map((s) => `<span style="width:${(count(s) / total) * 100}%;background:${COLORS[s]}"></span>`).join('');
  const done = count(STATUS.DONE);
  $('#progress').innerHTML = `
    <h2>İlerleme: ${done}/${tasks.length} tamamlandı (%${Math.round((done / total) * 100)})</h2>
    <div class="bar">${segs}</div>
    <div class="stats">
      ${ALL_STATUSES.map((s) => `<div><strong>${count(s)}</strong> ${s}</div>`).join('')}
    </div>`;
}

function renderLevels() {
  $('#levels').innerHTML = LEVELS.map(
    (l) => `<button type="button" data-level="${l.key}" aria-pressed="${l.key === level}">${l.label}</button>`
  ).join('');
  for (const b of $('#levels').querySelectorAll('button')) {
    b.onclick = () => {
      location.hash = `#/${b.dataset.level}`;
    };
  }
}

function render() {
  recomputeReadiness(tasks);
  renderLevels();
  renderDiagram();
  renderList();
  renderProgress();
  renderPanel();
}

/* ---------- Dışa aktarma / içe aktarma ---------- */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'title', 'zone', 'team', 'level', 'status', 'prerequisites', 'reference', 'note'];
  return [header.join(',')]
    .concat(rows.map((t) => [t.id, t.title, t.zone, t.team, t.level, t.status, t.prerequisites.join(' '), t.reference, t.note].map(esc).join(',')))
    .join('\n');
}

function wireActions() {
  $('#btn-export').onclick = () => download('bakim-takip.json', exportJson(tasks), 'application/json');
  $('#btn-csv').onclick = () => download('bakim-raporu.csv', '﻿' + toCsv(tasks), 'text/csv;charset=utf-8');
  $('#file-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const imported = importJson(await file.text());
      await repo.replaceAll(imported);
      tasks = await repo.load();
      toast('İçe aktarıldı');
      render();
    } catch (err) {
      toast(`Hata: ${err.message}`);
    }
    e.target.value = '';
  };
  $('#btn-reset').onclick = async () => {
    if (!confirm('Tüm değişiklikler silinip demo verisi yüklensin mi?')) return;
    localStorage.removeItem('bakim-takip:v1');
    location.reload();
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function readLevelFromHash() {
  const key = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
  level = LEVELS.some((l) => l.key === key) ? key : 'genel';
}

async function main() {
  tasks = await repo.load();
  initCy();
  wireActions();
  readLevelFromHash();
  window.addEventListener('hashchange', () => {
    readLevelFromHash();
    renderDiagram();
    renderLevels();
  });
  render();
}

main().catch((err) => {
  document.body.insertAdjacentHTML('afterbegin', `<p class="err">Yüklenemedi: ${escapeHtml(err.message)}</p>`);
});
