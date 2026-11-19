// 仿真任务调度：单 Worker 串行队列，任务状态与进度持久化
import type { Project, SimResult, SimTask } from '../types';
import type { SerializedDotField } from '../types';
import { deleteTask, loadTasks, putTask } from './storage';
import type { WorkerDoneMsg, WorkerInMsg, WorkerOutMsg, WorkerProgressMsg } from '../sim/simWorker';
import SimWorker from '../sim/simWorker?worker';

type Listener = (tasks: SimTask[]) => void;

class Scheduler {
  private worker: Worker | null = null;
  private queue: { task: SimTask; project: Project; dots: SerializedDotField }[] = [];
  private tasks = new Map<string, SimTask>();
  private currentId: string | null = null;
  private listeners = new Set<Listener>();
  private cachedList: SimTask[] = [];

  async init(): Promise<void> {
    const stored = await loadTasks();
    for (const t of stored) {
      // 上次会话中断的运行中任务回到排队态，需手动重跑
      if (t.status === 'running' || t.status === 'queued') {
        t.status = 'queued';
        t.progress = 0;
        await putTask(t);
      }
      this.tasks.set(t.id, t);
    }
    this.rebuildCache();
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.cachedList);
    return () => this.listeners.delete(fn);
  }

  list(): SimTask[] {
    return this.cachedList;
  }

  private rebuildCache(): void {
    this.cachedList = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  private emit() {
    this.rebuildCache();
    const snapshot = this.cachedList;
    this.listeners.forEach((fn) => fn(snapshot));
  }

  private update(patch: Partial<SimTask> & { id: string }) {
    const t = this.tasks.get(patch.id);
    if (!t) return;
    Object.assign(t, patch);
    void putTask({ ...t });
    this.emit();
  }

  enqueue(task: SimTask, project: Project, dots: SerializedDotField): void {
    this.tasks.set(task.id, task);
    void putTask(task);
    this.queue.push({ task, project, dots });
    this.emit();
    this.pump();
  }

  cancel(id: string): void {
    const idx = this.queue.findIndex((q) => q.task.id === id);
    if (idx >= 0) {
      const [removed] = this.queue.splice(idx, 1);
      this.update({ id: removed.task.id, status: 'cancelled', progress: 0 });
      return;
    }
    if (this.currentId === id && this.worker) {
      const msg: WorkerInMsg = { type: 'cancel' };
      this.worker.postMessage(msg);
    }
  }

  async remove(id: string): Promise<void> {
    this.cancel(id);
    this.tasks.delete(id);
    await deleteTask(id);
    this.emit();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new SimWorker();
    this.worker = w;
    w.onmessage = (ev: MessageEvent<WorkerOutMsg>) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        const p = msg as WorkerProgressMsg;
        const t = this.tasks.get(p.taskId);
        if (!t || t.status !== 'running') return;
        if (p.checkpoint) {
          if (!t.result) t.result = makePlaceholderResult(p.checkpoint, t);
          else t.result.convergence = [...t.result.convergence, p.checkpoint];
        }
        this.update({ id: p.taskId, progress: p.progress, result: t.result });
      } else if (msg.type === 'done') {
        const d = msg as WorkerDoneMsg;
        this.finish(d.taskId, d.result);
      } else if (msg.type === 'error') {
        this.update({ id: msg.taskId, status: 'error', error: msg.message });
        this.currentId = null;
        this.pump();
      }
    };
    w.onerror = (e) => {
      if (this.currentId) {
        this.update({ id: this.currentId, status: 'error', error: e.message || 'Worker 异常' });
        this.currentId = null;
        this.pump();
      }
    };
    return w;
  }

  private finish(taskId: string, result: SimResult): void {
    const t = this.tasks.get(taskId);
    if (t) {
      t.result = result;
      t.status = result.status;
      t.progress = 1;
      void putTask({ ...t });
      this.emit();
    }
    this.currentId = null;
    this.pump();
  }

  private pump(): void {
    if (this.currentId || this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.currentId = next.task.id;
    this.update({ id: next.task.id, status: 'running', progress: 0, error: null });
    const w = this.ensureWorker();
    const start: WorkerInMsg = {
      type: 'start',
      task: { ...next.task, status: 'running' },
      project: next.project,
      serializedDots: next.dots,
    };
    w.postMessage(start);
  }
}

function makePlaceholderResult(cp: { rays: number; uniformity: number }, t: SimTask): SimResult | null {
  // 首个检查点到达时建立占位结果，收敛曲线实时可见
  return {
    taskId: t.id,
    projectId: t.projectId,
    projectSnapshot: {} as Project,
    settings: t.settings,
    status: 'running',
    irradiance: new Float32Array(0),
    gridCols: 0,
    gridRows: 0,
    cellW: 0,
    cellH: 0,
    validMask: new Uint8Array(0),
    ninePoint: [],
    uniformity: cp.uniformity,
    avgIrradiance: 0,
    minIrradiance: 0,
    maxIrradiance: 0,
    darkZones: [],
    brightBands: [],
    convergence: [cp],
    raysShot: cp.rays,
    energyAudit: { injected: 0, exited: 0, absorbed: 0, escaped: 0 },
    createdAt: Date.now(),
    elapsedMs: 0,
  };
}

export const scheduler = new Scheduler();
