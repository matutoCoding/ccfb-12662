import { useSyncExternalStore, useState } from 'react';
import { PageHeader, useToast } from '../App';
import { Card, NumberField } from '../controls';
import { scheduler } from '../../data/scheduler';
import { DEFAULT_SETTINGS, type SimSettings, type SimTask, type TaskStatus } from '../../types';
import { getDots, getActiveProject, flushSave, useStore } from '../../data/store';
import { renderLineChart } from '../../analysis/charts';
import { useEffect, useRef } from 'react';

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '运行中',
  done: '已完成',
  cancelled: '已取消',
  error: '失败',
};

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SimTasksPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeId));
  const dots = useStore((s) => s.dots);
  const tasks = useSyncExternalStore((fn) => scheduler.subscribe(fn), () => scheduler.list());
  const toast = useToast();
  const [settings, setSettings] = useState<SimSettings>({ ...DEFAULT_SETTINGS });

  const createTask = async () => {
    const p = getActiveProject();
    const d = getDots();
    if (!p || !d) {
      toast('请先选择方案并生成网点', 'bad');
      return;
    }
    await flushSave();
    const task: SimTask = {
      id: uid('sim'),
      projectId: p.id,
      name: `${p.name} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
      settings: { ...settings },
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      result: null,
      error: null,
    };
    scheduler.enqueue(task, structuredClone(p), d.serialize());
    toast('仿真任务已加入队列', 'good');
  };

  return (
    <div>
      <PageHeader title="仿真任务" sub="蒙特卡洛光线追踪在 Web Worker 中运行，界面不卡顿；固定随机种子保证同参数结果逐位可复现，运行中可查看收敛曲线并随时取消。" />
      <Card title="新建任务">
        <div className="grid-4">
          <NumberField label="光线总数" value={settings.rayCount} min={1000} step={10000} onChange={(v) => setSettings((s) => ({ ...s, rayCount: Math.round(v) }))} />
          <NumberField label="照度网格分辨率" value={settings.irradianceResolution} min={40} max={400} step={10} onChange={(v) => setSettings((s) => ({ ...s, irradianceResolution: Math.round(v) }))} />
          <NumberField label="随机种子" value={settings.seed} step={1} onChange={(v) => setSettings((s) => ({ ...s, seed: Math.round(v) }))} />
          <NumberField label="最大反弹次数" value={settings.maxBounces} min={5} max={200} step={5} onChange={(v) => setSettings((s) => ({ ...s, maxBounces: Math.round(v) }))} />
        </div>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={createTask} disabled={!project || !dots}>开始仿真（当前 {dots?.totalDots.toLocaleString() ?? 0} 网点）</button>
          <span className="muted">任务按队列串行执行；膜片参数取创建时刻的项目快照</span>
        </div>
      </Card>

      <Card title={`任务队列（${tasks.length}）`}>
        {tasks.length === 0 ? (
          <div className="muted">暂无任务</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>任务</th><th>状态</th><th style={{ width: 220 }}>进度</th><th>均匀度</th><th>种子/线数</th><th>耗时</th><th style={{ width: 200 }}>操作</th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} toast={toast} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function TaskRow({ task, toast }: { task: SimTask; toast: (t: string, k?: 'good' | 'bad' | 'info') => void }) {
  const convRef = useRef<HTMLDivElement>(null);
  const isCurrentProject = useStore((s) => s.activeId === task.projectId);

  useEffect(() => {
    if (!convRef.current || !task.result?.convergence?.length) return;
    const canvas = renderLineChart(
      [
        {
          label: '均匀度',
          color: '#5db1ff',
          points: task.result.convergence.map((c) => ({ x: c.rays, y: c.uniformity })),
        },
      ],
      { width: 260, height: 90, legend: false, xLabel: '', yLabel: '' },
    );
    canvas.style.width = '100%';
    convRef.current.innerHTML = '';
    convRef.current.appendChild(canvas);
  }, [task.result?.convergence]);

  return (
    <tr>
      <td>
        <b>{task.name}</b>
        {isCurrentProject && <span className="tag running" style={{ marginLeft: 6 }}>当前方案</span>}
        {task.error && <div className="muted" style={{ color: '#e88' }}>{task.error}</div>}
      </td>
      <td><span className={`tag ${task.status}`}>{STATUS_LABEL[task.status]}</span></td>
      <td>
        <div className="progress"><div style={{ width: `${Math.round(task.progress * 100)}%` }} /></div>
        <div className="muted" style={{ marginTop: 4 }}>{(task.progress * 100).toFixed(1)}%</div>
        <div ref={convRef} />
      </td>
      <td className="mono">{task.result?.uniformity ? task.result.uniformity.toFixed(4) : '—'}</td>
      <td className="mono muted">{task.settings.seed}<br />{task.settings.rayCount.toLocaleString()}</td>
      <td className="muted">{task.result ? `${(task.result.elapsedMs / 1000).toFixed(1)}s` : '—'}</td>
      <td>
        <span className="btn-row">
          {(task.status === 'running' || task.status === 'queued') && (
            <button className="btn danger sm" onClick={() => scheduler.cancel(task.id)}>取消</button>
          )}
          <button className="btn ghost sm" onClick={async () => { await scheduler.remove(task.id); toast('任务已删除'); }}>删除</button>
        </span>
      </td>
    </tr>
  );
}
