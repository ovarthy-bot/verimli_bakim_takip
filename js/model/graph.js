// Bağımlılık grafiği (DAG) yardımcıları. DOM bağımlılığı yoktur.

/**
 * @param {Array<{id:string, prerequisites:string[]}>} tasks
 * @returns {Map<string, string[]>} id -> bağımlı olduğu ön koşullar
 */
export function buildPrereqMap(tasks) {
  const map = new Map();
  for (const t of tasks) map.set(t.id, [...(t.prerequisites || [])]);
  return map;
}

/**
 * Yeni bir ön koşul kenarı eklenirse döngü oluşur mu?
 * `from` görevi `to` görevine bağımlı olacak (to -> from kenarı: to önce).
 * Ön koşul haritasında task -> prerequisite yönü kullanılır.
 */
export function wouldCreateCycle(prereqMap, taskId, newPrereqId) {
  if (taskId === newPrereqId) return true;
  // newPrereqId'den yukarı doğru (ön koşulların ön koşulları) gidilerek taskId'ye ulaşılıyor mu?
  const stack = [newPrereqId];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of prereqMap.get(cur) || []) stack.push(p);
  }
  return false;
}

/**
 * Tüm grafikte döngü var mı? Döngü varsa bulunan döngünün bir düğüm listesini döner.
 * @returns {string[]|null}
 */
export function findCycle(prereqMap) {
  const state = new Map(); // 0 ziyaret edilmedi, 1 yolda, 2 bitti
  const path = [];
  let found = null;

  function dfs(node) {
    state.set(node, 1);
    path.push(node);
    for (const p of prereqMap.get(node) || []) {
      const s = state.get(p) || 0;
      if (s === 1) {
        found = [...path.slice(path.indexOf(p)), p];
        return true;
      }
      if (s === 0 && dfs(p)) return true;
    }
    path.pop();
    state.set(node, 2);
    return false;
  }

  for (const node of prereqMap.keys()) {
    if ((state.get(node) || 0) === 0 && dfs(node)) return found;
  }
  return null;
}

/**
 * Topolojik sıra (ön koşullar önce). Döngü varsa null döner.
 * @returns {string[]|null}
 */
export function topologicalOrder(prereqMap) {
  if (findCycle(prereqMap)) return null;
  const order = [];
  const seen = new Set();
  function visit(node) {
    if (seen.has(node)) return;
    seen.add(node);
    for (const p of prereqMap.get(node) || []) visit(p);
    order.push(node);
  }
  for (const node of prereqMap.keys()) visit(node);
  return order;
}
