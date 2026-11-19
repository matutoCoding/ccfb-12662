// 全局应用 store：方案 CRUD、网点编辑撤销/重做、草稿自动保存、方案导入导出
import { useSyncExternalStore } from 'react';
import type { ExportBundle, Project, SimTask, SerializedDotField } from '../types';
import { DotFieldModel, generateField } from '../sim/dotField';
import {
  deleteProject,
  getMeta,
  loadAllProjects,
  loadDots,
  putProject,
  saveDots,
  setMeta,
} from './storage';
import { BUILTIN_TEMPLATES } from './presets';

const HISTORY_LIMIT = 30;
const AUTOSAVE_DELAY = 600;

interface AppState {
  ready: boolean;
  projects: Project[];
  activeId: string | null;
  dots: DotFieldModel | null;
  undoStack: DotFieldModel[];
  redoStack: DotFieldModel[];
  dirty: boolean;
  /** 网点就地变更的版本号，驱动依赖网点统计的组件重渲染 */
  editVersion: number;
}

const state: AppState = {
  ready: false,
  projects: [],
  activeId: null,
  dots: null,
  undoStack: [],
  redoStack: [],
  dirty: false,
  editVersion: 0,
};

const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  state.dirty = true;
  listeners.forEach((fn) => fn());
  scheduleSave();
}

function emitNoDirty() {
  listeners.forEach((fn) => fn());
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistActive, AUTOSAVE_DELAY);
}

let persisting = false;
async function persistActive() {
  if (persisting || !state.activeId || !state.dots) return;
  persisting = true;
  const project = state.projects.find((p) => p.id === state.activeId);
  try {
    if (project) {
      project.updatedAt = Date.now();
      await putProject(project);
      await saveDots(project.id, state.dots.serialize());
      await setMeta('lastProjectId', project.id);
      state.dirty = false;
    }
  } catch (err) {
    console.error('自动保存失败', err);
  } finally {
    persisting = false;
  }
}

export async function flushSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  await persistActive();
}

export async function initStore(): Promise<void> {
  const projects = await loadAllProjects();
  state.projects = projects.sort((a, b) => b.updatedAt - a.updatedAt);
  const lastId = await getMeta<string>('lastProjectId');
  const target = projects.find((p) => p.id === lastId) ?? state.projects[0];
  if (target) {
    state.activeId = target.id;
    const serialized = await loadDots(target.id);
    state.dots = serialized ? DotFieldModel.deserialize(serialized) : generateField(target);
  }
  state.ready = true;
  state.undoStack = [];
  state.redoStack = [];
  emitNoDirty();
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getActiveProject(): Project | null {
  return state.projects.find((p) => p.id === state.activeId) ?? null;
}

export function getDots(): DotFieldModel | null {
  return state.dots;
}

export function canUndo(): boolean {
  return state.undoStack.length > 0;
}
export function canRedo(): boolean {
  return state.redoStack.length > 0;
}

// ---------- 方案管理 ----------

export async function createProject(templateId?: string): Promise<string> {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === templateId) ?? BUILTIN_TEMPLATES[0];
  const now = Date.now();
  const project: Project = structuredClone(tpl.project);
  project.id = uid('prj');
  project.createdAt = now;
  project.updatedAt = now;
  state.projects.unshift(project);
  await putProject(project);
  await selectProject(project.id);
  emitNoDirty();
  return project.id;
}

export async function selectProject(id: string): Promise<void> {
  await flushSave();
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  state.activeId = id;
  const serialized = await loadDots(id);
  state.dots = serialized ? DotFieldModel.deserialize(serialized) : generateField(project);
  state.undoStack = [];
  state.redoStack = [];
  state.editVersion = 0;
  await setMeta('lastProjectId', id);
  emitNoDirty();
}

export async function duplicateProject(id: string): Promise<string> {
  await flushSave();
  const src = state.projects.find((p) => p.id === id);
  if (!src) throw new Error('源方案不存在');
  const now = Date.now();
  const copy: Project = structuredClone(src);
  copy.id = uid('prj');
  copy.name = `${src.name} 副本`;
  copy.createdAt = now;
  copy.updatedAt = now;
  state.projects.unshift(copy);
  await putProject(copy);
  const srcDots = state.activeId === id && state.dots ? state.dots : await loadDots(id).then((s) => (s ? DotFieldModel.deserialize(s) : generateField(src)));
  await saveDots(copy.id, srcDots.serialize());
  await selectProject(copy.id);
  emitNoDirty();
  return copy.id;
}

export async function removeProject(id: string): Promise<void> {
  await deleteProject(id);
  state.projects = state.projects.filter((p) => p.id !== id);
  if (state.activeId === id) {
    const next = state.projects[0];
    if (next) await selectProject(next.id);
    else {
      state.activeId = null;
      state.dots = null;
      state.undoStack = [];
      state.redoStack = [];
      await setMeta('lastProjectId', null);
    }
  }
  emitNoDirty();
}

export function renameProject(id: string, name: string): void {
  const p = state.projects.find((x) => x.id === id);
  if (!p || !name.trim()) return;
  p.name = name.trim();
  emit();
}

/** 更新项目参数；若结构参数变化则重新生成网点（膜片参数变化不重生成） */
export function updateProject(mutator: (p: Project) => void, regenerateDots = false): void {
  const p = getActiveProject();
  if (!p) return;
  pushHistory();
  mutator(p);
  if (regenerateDots && state.dots) {
    state.dots = generateField(p);
  }
  emit();
}

export function regenerateDots(): void {
  const p = getActiveProject();
  if (!p) return;
  pushHistory();
  state.dots = generateField(p);
  emit();
}

// ---------- 撤销 / 重做 ----------

function pushHistory() {
  if (!state.dots) return;
  state.undoStack.push(cloneDots(state.dots));
  if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}

function cloneDots(m: DotFieldModel): DotFieldModel {
  const f = m.field;
  return new DotFieldModel({
    ...f,
    counts: new Uint32Array(f.counts),
    xs: new Float32Array(f.xs),
    ys: new Float32Array(f.ys),
    diameters: new Float32Array(f.diameters),
    nextFree: new Int32Array(f.nextFree),
    cellOffset: new Uint32Array(f.cellOffset),
  });
}

export function undo(): void {
  if (!state.dots || state.undoStack.length === 0) return;
  state.redoStack.push(cloneDots(state.dots));
  state.dots = state.undoStack.pop()!;
  emit();
}

export function redo(): void {
  if (!state.dots || state.redoStack.length === 0) return;
  state.undoStack.push(cloneDots(state.dots));
  state.dots = state.redoStack.pop()!;
  emit();
}

/** 开始一次刷子编辑会话（按下时记录历史） */
export function beginBrushEdit(): void {
  pushHistory();
}

export function notifyEdit(): void {
  state.editVersion++;
  emit();
}

// ---------- 导入 / 导出 ----------

export async function exportBundle(tasks: SimTask[]): Promise<Blob> {
  await flushSave();
  const p = getActiveProject();
  if (!p || !state.dots) throw new Error('没有可导出的方案');
  const bundle: ExportBundle = {
    format: 'lgp-studio-bundle',
    version: 1,
    exportedAt: Date.now(),
    project: structuredClone(p),
    dotField: state.dots.serialize(),
    tasks: tasks.filter((t) => t.projectId === p.id).map((t) => structuredClone(t)),
  };
  const json = JSON.stringify(bundle, (_k, v) => (v instanceof Float32Array ? Array.from(v) : v));
  return gzipEncode(json);
}

export async function importBundle(file: File): Promise<string> {
  const json = await gzipDecode(file);
  const bundle = JSON.parse(json) as ExportBundle;
  if (bundle.format !== 'lgp-studio-bundle') throw new Error('文件格式不识别');
  const project: Project = bundle.project;
  project.id = uid('prj');
  project.name = `${project.name}（导入）`;
  state.projects.unshift(project);
  await putProject(project);
  if (bundle.dotField) {
    const dots = DotFieldModel.deserialize(bundle.dotField);
    await saveDots(project.id, dots.serialize());
  }
  await selectProject(project.id);
  emitNoDirty();
  return project.id;
}

async function gzipEncode(text: string): Promise<Blob> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
  }
  return new Blob([text], { type: 'application/json' });
}

async function gzipDecode(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // gzip 魔数 1f 8b
  if (new Uint8Array(buf)[0] === 0x1f && new Uint8Array(buf)[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

// ---------- 自动修正落库 ----------

/** 由误差反推结果创建带修正层的新方案并保存网点，返回新方案 id */
export async function createCorrectedProject(project: Project, serializedDots: SerializedDotField): Promise<string> {
  await flushSave();
  const copy: Project = structuredClone(project);
  copy.id = uid('prj');
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  state.projects.unshift(copy);
  await putProject(copy);
  const dots = DotFieldModel.deserialize(serializedDots);
  await saveDots(copy.id, dots.serialize());
  await selectProject(copy.id);
  emitNoDirty();
  return copy.id;
}

// ---------- React 订阅 ----------

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => selector(state),
    () => selector(state),
  );
}

export function snapshotState(): AppState {
  return state;
}
