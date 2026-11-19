import { useRef, useState, useSyncExternalStore } from 'react';
import { PageHeader, useToast } from '../App';
import { BUILTIN_TEMPLATES } from '../../data/presets';
import {
  createProject,
  duplicateProject,
  exportBundle,
  importBundle,
  removeProject,
  renameProject,
  selectProject,
  useStore,
} from '../../data/store';
import { scheduler } from '../../data/scheduler';

export function ProjectListPage(props: { onOpen: () => void }) {
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeId);
  const tasks = useSchedulerTasks();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const fmt = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false });

  return (
    <div>
      <PageHeader title="方案列表" sub="所有方案与网点数据均保存在本机浏览器 IndexedDB，关闭页面后自动恢复；可导出 gzip 方案包发给同事。" />
      <div className="card">
        <h3>从内置模板新建（车载 / 工控实测规格）</h3>
        <div className="grid-2">
          {BUILTIN_TEMPLATES.map((t) => (
            <div key={t.id} className="stat" style={{ cursor: 'pointer' }} onClick={async () => { await createProject(t.id); toast(`已从「${t.label}」创建方案`, 'good'); props.onOpen(); }}>
              <div className="k" style={{ fontSize: 13, color: '#c6d3e6' }}>{t.label}</div>
              <div className="muted" style={{ margin: '6px 0 10px' }}>{t.desc}</div>
              <button className="btn sm">用此模板新建</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
          我的方案（{projects.length}）
          <span className="btn-row">
            <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>导入方案包</button>
            <input
              ref={fileRef}
              type="file"
              accept=".lgp.gz,.gz,.json,application/gzip"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  await importBundle(f);
                  toast('方案导入成功', 'good');
                } catch (err) {
                  toast(`导入失败：${err instanceof Error ? err.message : err}`, 'bad');
                }
              }}
            />
          </span>
        </h3>
        {projects.length === 0 ? (
          <div className="muted">还没有方案，点击上方模板开始。</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>方案名称</th><th>外形 (mm)</th><th>入光</th><th>更新时间</th><th style={{ width: 320 }}>操作</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} style={p.id === activeId ? { background: '#1d2c40' } : undefined}>
                  <td>
                    {renamingId === p.id ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => { renameProject(p.id, draftName); setRenamingId(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { renameProject(p.id, draftName); setRenamingId(null); } }}
                      />
                    ) : (
                      <b>{p.name}</b>
                    )}
                    {p.correction && <span className="tag done" style={{ marginLeft: 8 }}>含修正层</span>}
                  </td>
                  <td className="mono">{p.panel.width}×{p.panel.height}×{p.panel.thickness}</td>
                  <td>{p.led.edges.join('/')} · {p.led.countPerEdge}灯</td>
                  <td className="muted">{fmt(p.updatedAt)}</td>
                  <td>
                    <span className="btn-row">
                      <button className="btn sm" onClick={async () => { await selectProject(p.id); props.onOpen(); }}>打开</button>
                      <button className="btn ghost sm" onClick={() => { setRenamingId(p.id); setDraftName(p.name); }}>重命名</button>
                      <button className="btn ghost sm" onClick={async () => { await duplicateProject(p.id); toast('方案已复制', 'good'); }}>复制</button>
                      <button className="btn ghost sm" onClick={async () => {
                        const blob = await exportBundle(tasks);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${p.name.replace(/[\\/:*?"<>|]/g, '_')}.lgp.gz`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast('方案包已导出', 'good');
                      }}>导出</button>
                      <button className="btn danger sm" onClick={async () => {
                        if (!confirm(`确认删除方案「${p.name}」及其全部网点与任务？此操作不可恢复。`)) return;
                        await removeProject(p.id);
                        toast('方案已删除', 'info');
                      }}>删除</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function useSchedulerTasks() {
  return useSyncExternalStore(
    (fn) => scheduler.subscribe(fn),
    () => scheduler.list(),
  );
}
