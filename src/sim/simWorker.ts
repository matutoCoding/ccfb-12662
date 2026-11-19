// 仿真 Worker：接收任务消息，在线程内运行蒙特卡洛仿真，支持进度与取消
import type { Project, SimResult, SimTask, SerializedDotField } from '../types';
import { DotFieldModel } from './dotField';
import { runSimulation, summarizeResult, type SimEngineOutput } from './simulator';

export interface WorkerStartMsg {
  type: 'start';
  task: SimTask;
  project: Project;
  serializedDots: SerializedDotField;
}
export interface WorkerCancelMsg {
  type: 'cancel';
}
export type WorkerInMsg = WorkerStartMsg | WorkerCancelMsg;

export interface WorkerProgressMsg {
  type: 'progress';
  taskId: string;
  progress: number;
  checkpoint?: { rays: number; uniformity: number };
}
export interface WorkerDoneMsg {
  type: 'done';
  taskId: string;
  result: SimResult;
}
export interface WorkerErrorMsg {
  type: 'error';
  taskId: string;
  message: string;
}
export type WorkerOutMsg = WorkerProgressMsg | WorkerDoneMsg | WorkerErrorMsg;

let cancelled = false;
let running = false;

self.onmessage = (ev: MessageEvent<WorkerInMsg>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type === 'start') {
    if (running) return;
    running = true;
    cancelled = false;
    const { task, project, serializedDots } = msg;
    try {
      const dots = DotFieldModel.deserialize(serializedDots);
      const t0 = performance.now();
      const output: SimEngineOutput | null = runSimulation(project, dots, task.settings, {
        shouldCancel: () => cancelled,
        onProgress: (p) => {
          post({
            type: 'progress',
            taskId: task.id,
            progress: p.raysDone / p.totalRays,
            checkpoint: p.checkpoint,
          });
        },
      });
      const elapsed = performance.now() - t0;
      if (!output) {
        post({ type: 'error', taskId: task.id, message: '仿真未产生输出' });
      } else {
        const result = summarizeResult(output, task, project, elapsed, cancelled);
        post({ type: 'done', taskId: task.id, result });
      }
    } catch (err) {
      post({
        type: 'error',
        taskId: task.id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  }
};

function post(m: WorkerOutMsg) {
  (self as unknown as Worker).postMessage(m);
}
