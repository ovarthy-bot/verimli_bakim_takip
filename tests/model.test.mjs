import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrereqMap, findCycle, wouldCreateCycle, topologicalOrder } from '../js/model/graph.js';
import { recomputeReadiness, canTransition, STATUS } from '../js/model/status.js';

const mk = (id, prerequisites = [], status = STATUS.WAITING, extra = {}) => ({ id, prerequisites, status, ...extra });

test('döngü tespiti: döngü yoksa null', () => {
  const m = buildPrereqMap([mk('A'), mk('B', ['A']), mk('C', ['A', 'B'])]);
  assert.equal(findCycle(m), null);
  assert.ok(topologicalOrder(m).indexOf('A') < topologicalOrder(m).indexOf('C'));
});

test('döngü tespiti: A->B->A döngüsü bulunur', () => {
  const m = buildPrereqMap([mk('A', ['B']), mk('B', ['A'])]);
  assert.ok(findCycle(m));
  assert.equal(topologicalOrder(m), null);
});

test('wouldCreateCycle: kendi kendine ve dolaylı döngü reddedilir', () => {
  const m = buildPrereqMap([mk('A'), mk('B', ['A']), mk('C', ['B'])]);
  assert.equal(wouldCreateCycle(m, 'A', 'A'), true);
  assert.equal(wouldCreateCycle(m, 'A', 'C'), true); // A <- B <- C zaten var, A'ya C eklemek döngü
  assert.equal(wouldCreateCycle(m, 'C', 'A'), false);
});

test('çoklu ön koşul: tüm zorunlu ön koşullar bitmeden Hazır olmaz', () => {
  const tasks = [
    mk('A', [], STATUS.DONE),
    mk('B', [], STATUS.WAITING),
    mk('C', ['A', 'B']),
  ];
  recomputeReadiness(tasks);
  assert.equal(tasks.find((t) => t.id === 'C').status, STATUS.WAITING);
  tasks.find((t) => t.id === 'B').status = STATUS.DONE;
  recomputeReadiness(tasks);
  assert.equal(tasks.find((t) => t.id === 'C').status, STATUS.READY);
});

test('kapsam dışı ön koşul tamam sayılır', () => {
  const tasks = [mk('A', [], STATUS.WAITING, { scopeOut: { reason: 'Kapsam dışı', by: 'Müh.' } }), mk('B', ['A'])];
  recomputeReadiness(tasks);
  assert.equal(tasks.find((t) => t.id === 'B').status, STATUS.READY);
});

test('zincir yayılımı: A tamamlanınca B, B tamamlanınca C hazır olur', () => {
  const tasks = [mk('A', [], STATUS.DONE), mk('B', ['A']), mk('C', ['B'])];
  recomputeReadiness(tasks);
  assert.equal(tasks[1].status, STATUS.READY);
  assert.equal(tasks[2].status, STATUS.WAITING);
});

test('canTransition: ön koşulu bitmeyen görev Tamamlandı yapılamaz', () => {
  const tasks = [mk('A'), mk('B', ['A'], STATUS.READY)];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const r = canTransition(tasks[1], byId, STATUS.DONE);
  assert.equal(r.ok, false);
});

test('canTransition: Bekliyor durumundaki görev Devam Ediyor yapılamaz', () => {
  const t = mk('B', ['A'], STATUS.WAITING);
  const byId = new Map([['B', t]]);
  assert.equal(canTransition(t, byId, STATUS.IN_PROGRESS).ok, false);
});

test('seed verisinde QA-01 başta bekliyor, CAB-01 hazır', async () => {
  const { readFile } = await import('node:fs/promises');
  const seed = JSON.parse(await readFile(new URL('../data/seed.json', import.meta.url), 'utf8'));
  recomputeReadiness(seed.tasks);
  const s = Object.fromEntries(seed.tasks.map((t) => [t.id, t.status]));
  assert.equal(s['CAB-01'], STATUS.READY);
  assert.equal(s['CAB-02'], STATUS.WAITING);
  assert.equal(s['QA-01'], STATUS.WAITING);
  assert.equal(findCycle(buildPrereqMap(seed.tasks)), null);
});
