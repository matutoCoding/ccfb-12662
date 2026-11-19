// IndexedDB 持久层：方案、网点场、任务全部本地存储，无任何服务端
import type { Project, SimTask } from '../types';
import type { SerializedDotField } from '../types';

const DB_NAME = 'lgp-dot-studio';
const DB_VERSION = 1;
const STORE = {
  projects: 'projects',
  dots: 'dots',
  tasks: 'tasks',
  meta: 'meta',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE.projects)) db.createObjectStore(STORE.projects, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE.dots)) db.createObjectStore(STORE.dots, { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains(STORE.tasks)) db.createObjectStore(STORE.tasks, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE.meta)) db.createObjectStore(STORE.meta);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function loadAllProjects(): Promise<Project[]> {
  return tx(STORE.projects, 'readonly', (s) => s.getAll() as IDBRequest<Project[]>);
}

export async function putProject(p: Project): Promise<void> {
  await tx(STORE.projects, 'readwrite', (s) => s.put(p));
}

export async function deleteProject(id: string): Promise<void> {
  await tx(STORE.projects, 'readwrite', (s) => s.delete(id));
  await safeDeleteDots(id);
  const tasks = await loadTasks();
  await Promise.all(tasks.filter((t) => t.projectId === id).map((t) => deleteTask(t.id)));
}

export async function saveDots(projectId: string, dots: SerializedDotField): Promise<void> {
  await tx(STORE.dots, 'readwrite', (s) => s.put({ projectId, ...dots }));
}

export async function loadDots(projectId: string): Promise<SerializedDotField | null> {
  const row = await tx(STORE.dots, 'readonly', (s) => s.get(projectId) as IDBRequest<(SerializedDotField & { projectId: string }) | undefined>);
  if (!row) return null;
  const { projectId: _omit, ...rest } = row;
  void _omit;
  return rest as SerializedDotField;
}

async function safeDeleteDots(projectId: string): Promise<void> {
  try {
    await tx(STORE.dots, 'readwrite', (s) => s.delete(projectId));
  } catch {
    /* 忽略 */
  }
}

export async function loadTasks(): Promise<SimTask[]> {
  return tx(STORE.tasks, 'readonly', (s) => s.getAll() as IDBRequest<SimTask[]>);
}

export async function putTask(t: SimTask): Promise<void> {
  await tx(STORE.tasks, 'readwrite', (s) => s.put(t));
}

export async function deleteTask(id: string): Promise<void> {
  await tx(STORE.tasks, 'readwrite', (s) => s.delete(id));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(STORE.meta, 'readwrite', (s) => s.put(value, key));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return tx(STORE.meta, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}
