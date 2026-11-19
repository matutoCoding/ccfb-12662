import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PageHeader, useToast } from '../App';
import { Card } from '../controls';
import { scheduler } from '../../data/scheduler';
import type { Project, SimResult } from '../../types';
import { downloadCanvasPng, downloadText, irradianceToCsv, renderColorBar, renderHeatmap, sampleProfile } from '../../analysis/heatmap';
import { renderLineChart } from '../../analysis/charts';
import { buildReport, downloadReport } from '../../analysis/report';
import { computeCorrection } from '../../sim/correction';
import { generateField } from '../../sim/dotField';
import { useStore } from '../../data/store';
import { ninePointPositions } from '../../sim/geometry';

interface ProfileLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function AnalysisPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeId));
  const dots = useStore((s) => s.dots);
  const tasks = useSyncExternalStore((fn) => scheduler.subscribe(fn), () => scheduler.list());
  const toast = useToast();

  // 纳入当前方案及其修正血缘（原方案 / 修正版）的全部有效结果，支撑修正前后并排对比
  const lineageIds = useMemo(() => {
    const ids = new Set<string>([project?.id].filter(Boolean) as string[]);
    if (project?.correction) {
      // 修正版：通过修正层的来源任务反查原方案
      const sourceTaskId = project.correction.sourceTaskId;
      const sourceTask = tasks.find((t) => t.id === sourceTaskId);
      if (sourceTask) ids.add(sourceTask.projectId);
    }
    // 原方案：把由它衍生的修正版也纳入（修正版名带「修正版」且同尺寸）
    for (const t of tasks) {
      if (t.result?.projectSnapshot?.correction?.sourceTaskId) {
        const src = tasks.find((x) => x.id === t.result!.projectSnapshot.correction!.sourceTaskId);
        if (src && src.projectId === project?.id) ids.add(t.projectId);
      }
    }
    return ids;
  }, [project, tasks]);

  const projectTasks = useMemo(
    () => tasks.filter((t) => lineageIds.has(t.projectId) && t.result && t.result.gridCols > 0),
    [tasks, lineageIds],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [showZones, setShowZones] = useState(true);
  const [showNine, setShowNine] = useState(true);
  const [profile, setProfile] = useState<ProfileLine | null>(null);
  const [drawing, setDrawing] = useState(false);
  const heatHostRef = useRef<HTMLDivElement>(null);
  const profileHostRef = useRef<HTMLDivElement>(null);

  const selected = projectTasks.find((t) => t.id === selectedId)?.result
    ?? projectTasks[0]?.result
    ?? null;
  const compare = projectTasks.find((t) => t.id === compareId)?.result ?? null;

  // 伪彩图渲染
  useEffect(() => {
    if (!selected || !heatHostRef.current) return;
    const canvas = renderHeatmap(selected, {
      showNinePoint: showNine,
      showZones,
      profile,
      width: 720,
    });
    canvas.style.width = '100%';
    canvas.style.cursor = 'crosshair';
    heatHostRef.current.innerHTML = '';
    heatHostRef.current.appendChild(canvas);
  }, [selected, showZones, showNine, profile]);

  // 剖面图渲染
  useEffect(() => {
    if (!selected || !profileHostRef.current || !profile) return;
    const line = profile;
    const base = sampleProfile(selected, line.x1, line.y1, line.x2, line.y2);
    const series: import('../../analysis/charts').LineSeries[] = [
      { label: '修正前/当前', color: '#5db1ff', points: base.map((p) => ({ x: p.d, y: p.v })) },
    ];
    if (compare) {
      const cmp = sampleProfile(compare, line.x1, line.y1, line.x2, line.y2);
      series.push({ label: '对比方案', color: '#ffb84d', points: cmp.map((p) => ({ x: p.d, y: p.v })), dashed: true });
    }
    const chart = renderLineChart(series, { width: 720, height: 240, xLabel: '沿剖面距离 (mm)', yLabel: '相对照度' });
    chart.style.width = '100%';
    profileHostRef.current.innerHTML = '';
    profileHostRef.current.appendChild(chart);
  }, [selected, compare, profile]);

  if (!project) return <div className="empty">请先选择方案</div>;

  const panel = project.panel;

  const heatEventToWorld = (e: React.MouseEvent): { x: number; y: number } => {
    const host = heatHostRef.current!;
    const rect = host.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width;
    const sy = (e.clientY - rect.top) / rect.height;
    return { x: sx * panel.width, y: (1 - sy) * panel.height };
  };

  const runCorrection = () => {
    if (!selected || !dots) return;
    const out = computeCorrection(project, dots, selected);
    // 生成修正后新项目（保留并排对比）
    const correctedProject: Project = structuredClone(project);
    correctedProject.id = `prj-corr-${Date.now().toString(36)}`;
    correctedProject.name = `${project.name}（修正版）`;
    correctedProject.correction = { factors: out.factors, createdAt: Date.now(), sourceTaskId: selected.taskId };
    correctedProject.updatedAt = Date.now();
    correctedProject.createdAt = Date.now();
    const correctedDots = generateField(correctedProject);
    // 挂到 window 供任务页通过 store 使用：先写入 store 更合适——通过自定义事件交给 App 级处理器
    window.dispatchEvent(
      new CustomEvent('lgp:correction', {
        detail: { project: correctedProject, dots: correctedDots.serialize(), sourceResult: selected, stats: out.stats },
      }),
    );
    toast(`已生成修正版方案：${out.stats.changed} 个单元调整，平均倍率 ${out.stats.meanFactor.toFixed(3)}`, 'good');
  };

  return (
    <div>
      <PageHeader title="结果分析" sub="九点均匀度按行业常规取最小九点照度 / 九点平均照度；支持任意剖面线、暗区/亮带自动标注、一轮密度反推修正与修正前后并排对比。" />

      {projectTasks.length === 0 ? (
        <div className="empty">
          <h2>还没有可用的仿真结果</h2>
          <p>请先到「仿真任务」页运行一次仿真</p>
        </div>
      ) : (
        <>
          <Card title="结果选择">
            <div className="grid-2">
              <label className="field">
                <span>主结果</span>
                <select value={selected?.taskId ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
                  {projectTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}（均匀度 {t.result!.uniformity.toFixed(4)}）</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>对比结果（可选）</span>
                <select value={compareId ?? ''} onChange={(e) => setCompareId(e.target.value || null)}>
                  <option value="">不对比</option>
                  {projectTasks.filter((t) => t.result !== selected).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}（均匀度 {t.result!.uniformity.toFixed(4)}）</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <label className="check-row"><input type="checkbox" checked={showNine} onChange={(e) => setShowNine(e.target.checked)} />九点标注</label>
              <label className="check-row"><input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />暗区/亮带标注</label>
              <button className="btn ghost sm" onClick={() => setProfile({ x1: 0, y1: panel.height / 2, x2: panel.width, y2: panel.height / 2 })}>水平中线剖面</button>
              <button className="btn ghost sm" onClick={() => setProfile({ x1: panel.width / 2, y1: 0, x2: panel.width / 2, y2: panel.height })}>垂直中线剖面</button>
              <button className="btn ghost sm" onClick={() => setProfile(null)}>清除剖面</button>
            </div>
          </Card>

          {selected && (
            <>
              <div className="grid-4">
                <div className="stat"><div className="k">九点均匀度 (min/avg)</div><div className={`v ${uniformityClass(selected.uniformity)}`}>{(selected.uniformity * 100).toFixed(2)}%</div></div>
                <div className="stat"><div className="k">平均相对照度</div><div className="v">{selected.avgIrradiance.toExponential(2)}</div></div>
                <div className="stat"><div className="k">暗区 / 亮带格数</div><div className="v">{selected.darkZones.length} / {selected.brightBands.length}</div></div>
                <div className="stat"><div className="k">能量守恒偏差</div><div className="v">{energyBalancePct(selected).toFixed(2)}%</div></div>
              </div>

              <div className="compare-grid">
                <Card title="照度伪彩图">
                  <div
                    ref={heatHostRef}
                    className="heatmap-box"
                    onMouseDown={(e) => {
                      const w = heatEventToWorld(e);
                      setProfile({ x1: w.x, y1: w.y, x2: w.x, y2: w.y });
                      setDrawing(true);
                    }}
                    onMouseMove={(e) => {
                      if (!drawing) return;
                      const w = heatEventToWorld(e);
                      setProfile((p) => (p ? { ...p, x2: w.x, y2: w.y } : p));
                    }}
                    onMouseUp={() => setDrawing(false)}
                  />
                  <div className="colorbar" style={{ marginTop: 10 }}>
                    <ColorBar />
                    <div className="legend-labels">
                      <span>1.6×均值</span><span>均值</span><span>低</span>
                    </div>
                  </div>
                  <div className="muted" style={{ marginTop: 8 }}>在伪彩图上按住拖拽可画任意剖面线</div>
                </Card>

                <Card title="九点照度（编号对应左图）">
                  <NinePointTable result={selected} />
                </Card>
              </div>

              {profile && (
                <Card title="剖面亮度曲线">
                  <div ref={profileHostRef} />
                  <div className="muted" style={{ marginTop: 6 }}>
                    剖面：({profile.x1.toFixed(1)}, {profile.y1.toFixed(1)}) → ({profile.x2.toFixed(1)}, {profile.y2.toFixed(1)}) mm
                  </div>
                </Card>
              )}

              <Card title="自动密度反推修正">
                <p className="muted">
                  以「目标均值 / 局部照度」构造误差图，经松弛（0.6）与 3×3 邻域平滑后乘性更新网点密度因子，生成一个带修正层的新方案；
                  在新方案上重新跑仿真后，可在本页选择两个结果并排对比。
                </p>
                <div className="btn-row">
                  <button className="btn" onClick={runCorrection}>生成一轮修正版方案</button>
                  {compare && (
                    <span>
                      均匀度变化：
                      <b className={compare.uniformity >= selected.uniformity ? 'good' : 'bad'} style={{ color: compare.uniformity >= selected.uniformity ? 'var(--good)' : 'var(--bad)' }}>
                        {' '}{selected.uniformity.toFixed(4)} → {compare.uniformity.toFixed(4)}
                        （{((compare.uniformity - selected.uniformity) * 100).toFixed(2)} 个百分点）
                      </b>
                    </span>
                  )}
                </div>
              </Card>

              <Card title="导出">
                <div className="btn-row">
                  <button className="btn ghost" onClick={() => {
                    const cv = renderHeatmap(selected, { showNinePoint: showNine, showZones, profile, width: 1200 });
                    downloadCanvasPng(cv, `heatmap_${selected.taskId}.png`);
                  }}>导出伪彩图 PNG</button>
                  <button className="btn ghost" onClick={() => downloadText(irradianceToCsv(selected), `irradiance_${selected.taskId}.csv`)}>导出照度 CSV</button>
                  {profile && (
                    <button className="btn ghost" onClick={() => {
                      const rows = sampleProfile(selected, profile.x1, profile.y1, profile.x2, profile.y2);
                      const csv = 'distance_mm,relative_irradiance\n' + rows.map((r) => `${r.d.toFixed(3)},${r.v.toExponential(5)}`).join('\n');
                      downloadText(csv, `profile_${selected.taskId}.csv`);
                    }}>导出剖面 CSV</button>
                  )}
                  <button className="btn" onClick={() => {
                    const html = buildReport(selected, compare ? { after: compare } : undefined);
                    downloadReport(html, `report_${selected.taskId}.html`);
                    toast('HTML 报告已生成并下载', 'good');
                  }}>导出仿真报告 (HTML)</button>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function uniformityClass(u: number): string {
  return u >= 0.85 ? 'good' : u >= 0.75 ? 'warn' : 'bad';
}

function energyBalancePct(r: SimResult): number {
  const a = r.energyAudit;
  const sum = a.exited + a.absorbed + a.escaped;
  return a.injected > 0 ? (Math.abs(sum - a.injected) / a.injected) * 100 : 100;
}

function ColorBar() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = renderColorBar(220, 16);
    if (ref.current) {
      ref.current.innerHTML = '';
      ref.current.appendChild(c);
    }
  }, []);
  return <div ref={ref} />;
}

function NinePointTable({ result }: { result: SimResult }) {
  const pts = ninePointPositions(result.projectSnapshot.panel);
  return (
    <table className="data">
      <thead><tr><th>#</th><th>位置 (mm)</th><th>E/Eavg</th><th>照度</th></tr></thead>
      <tbody>
        {result.ninePoint.map((v, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td className="mono muted">{pts[i] ? `${pts[i].x.toFixed(1)}, ${pts[i].y.toFixed(1)}` : '切角外'}</td>
            <td className="mono" style={{ color: v / result.avgIrradiance === Math.min(...result.ninePoint) / result.avgIrradiance ? 'var(--warn)' : undefined }}>
              {(v / result.avgIrradiance).toFixed(3)}
            </td>
            <td className="mono muted">{v.toExponential(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
