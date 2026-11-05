// Görev durum makinesi ve otomatik "Hazır" hesabı. DOM bağımlılığı yoktur.

export const STATUS = Object.freeze({
  WAITING: 'Bekliyor',
  READY: 'Hazır',
  IN_PROGRESS: 'Devam Ediyor',
  DONE: 'Tamamlandı',
  BLOCKED: 'Bloke',
});

export const ALL_STATUSES = Object.values(STATUS);

/**
 * Bir görevin ön koşulları "tamam" sayılır mı?
 * Tamamlandı veya kapsam dışı (yetkili gerekçeyle) ön koşullar tamam kabul edilir.
 */
function prereqSatisfied(task) {
  return task.status === STATUS.DONE || Boolean(task.scopeOut);
}

/**
 * Tüm görevleri, ön koşullara göre hazır/bekliyor durumuna getirir.
 * Kural:
 *  - Ön koşullardan biri tamam değilse görev Bekliyor (kapsam dışı değilse).
 *  - Hepsi tamamsa ve görev henüz başlamadıysa Hazır.
 *  - Devam Ediyor, Tamamlandı, Bloke durumları korunur.
 * Değişiklikler bağlı görevlere de yayılır (kapanana kadar tekrar eder).
 *
 * @param {Array<object>} tasks  Yerinde (in-place) güncellenir ve döner.
 */
export function recomputeReadiness(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < tasks.length + 5) {
    changed = false;
    for (const t of tasks) {
      if (t.status === STATUS.DONE || t.status === STATUS.IN_PROGRESS || t.status === STATUS.BLOCKED) {
        continue;
      }
      const prereqs = (t.prerequisites || []).map((id) => byId.get(id)).filter(Boolean);
      const allOk = prereqs.every(prereqSatisfied);
      const next = allOk ? STATUS.READY : STATUS.WAITING;
      if (t.status !== next) {
        t.status = next;
        changed = true;
      }
    }
  }
  return tasks;
}

/**
 * Durum değişikliğinin geçerli olup olmadığını kontrol eder.
 * @returns {{ok:boolean, reason?:string}}
 */
export function canTransition(task, tasksById, nextStatus) {
  if (!ALL_STATUSES.includes(nextStatus)) return { ok: false, reason: 'Geçersiz durum.' };
  if (nextStatus === STATUS.DONE) {
    const blockers = (task.prerequisites || []).filter((id) => {
      const p = tasksById.get(id);
      return p && !prereqSatisfied(p);
    });
    if (blockers.length) {
      return { ok: false, reason: `Önce tamamlanmalı: ${blockers.join(', ')}` };
    }
  }
  if (nextStatus === STATUS.IN_PROGRESS || nextStatus === STATUS.DONE) {
    if (task.status === STATUS.WAITING) {
      return { ok: false, reason: 'Ön koşullar henüz sağlanmadı.' };
    }
  }
  return { ok: true };
}
