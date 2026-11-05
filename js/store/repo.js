// Veri erişim arayüzü. Uygulama yalnızca bu arayüzü kullanır; arka uç (localStorage / Supabase) değiştirilebilir.
import { recomputeReadiness } from '../model/status.js';

const STORAGE_KEY = 'bakim-takip:v1';

/** localStorage tabanlı depo. Bulut (Supabase) adaptörü aynı arayüzü uygulayacak. */
export function createLocalRepo(seedUrl = 'data/seed.json') {
  let tasks = null;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(tasks);
  }

  async function load() {
    if (tasks) return tasks;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (saved && Array.isArray(saved.tasks)) {
      tasks = saved.tasks;
    } else {
      const res = await fetch(seedUrl);
      const seed = await res.json();
      tasks = seed.tasks;
    }
    recomputeReadiness(tasks);
    return tasks;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, savedAt: new Date().toISOString() }));
    } catch {
      // Depolama dolu/engelli; oturum içinde çalışmaya devam eder.
    }
  }

  async function replaceAll(newTasks) {
    tasks = newTasks;
    recomputeReadiness(tasks);
    persist();
    notify();
    return tasks;
  }

  async function update(task) {
    const i = tasks.findIndex((t) => t.id === task.id);
    if (i === -1) throw new Error(`Görev bulunamadı: ${task.id}`);
    tasks[i] = { ...task, updatedAt: new Date().toISOString() };
    recomputeReadiness(tasks);
    persist();
    notify();
    return tasks[i];
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { load, replaceAll, update, subscribe };
}

export function exportJson(tasks) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), tasks }, null, 2);
}

export function importJson(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.tasks)) throw new Error('Geçersiz dosya: "tasks" dizisi yok.');
  for (const t of data.tasks) {
    if (!t.id || typeof t.id !== 'string') throw new Error('Her görevin bir "id" alanı olmalı.');
    t.prerequisites = Array.isArray(t.prerequisites) ? t.prerequisites : [];
  }
  return data.tasks;
}
