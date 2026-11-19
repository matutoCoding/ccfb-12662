import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader, useToast } from '../App';
import { beginBrushEdit, getActiveProject, notifyEdit, redo, undo, useStore } from '../../data/store';
import { DotRenderer } from '../../webgl/dotRenderer';
import { pointInPanel } from '../../sim/geometry';

type BrushMode = 'add' | 'remove';

export function DotEditorPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeId));
  const dots = useStore((s) => s.dots);
  const editVersion = useStore((s) => s.editVersion);
  const undoCount = useStore((s) => s.undoStack.length);
  const redoCount = useStore((s) => s.redoStack.length);
  const toast = useToast();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DotRenderer | null>(null);
  const paintingRef = useRef(false);
  const lastStrokeRef = useRef(0);
  const [mode, setMode] = useState<BrushMode>('add');
  const [brushMm, setBrushMm] = useState(4);
  const [tip, setTip] = useState<{ x: number; y: number; sx: number; sy: number; d: number; density: number } | null>(null);
  const modeRef = useRef(mode);
  const brushRef = useRef(brushMm);
  modeRef.current = mode;
  brushRef.current = brushMm;

  // 初始化渲染器
  useEffect(() => {
    if (!canvasRef.current || !project) return;
    let renderer: DotRenderer;
    try {
      renderer = new DotRenderer(canvasRef.current, project.panel);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'WebGL2 初始化失败', 'bad');
      return;
    }
    rendererRef.current = renderer;
    renderer.resize();
    renderer.fitView();
    renderer.uploadDots(dots!);
    renderer.render();

    const onResize = () => {
      renderer.resize();
      renderer.render();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      rendererRef.current = null;
    };
    // 切换方案时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // 网点数据变化（撤销重做/重生成/刷子增删）→ 重传缓冲
  useEffect(() => {
    const r = rendererRef.current;
    if (r && dots) {
      r.uploadDots(dots);
      r.render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots, editVersion]);

  const eventToWorld = useCallback((e: React.MouseEvent) => {
    const r = rendererRef.current!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = r.screenToWorld(sx, sy);
    return { w, sx, sy };
  }, []);

  const applyBrush = useCallback(
    (wx: number, wy: number) => {
      const r = rendererRef.current;
      const p = getActiveProject();
      if (!r || !p || !dots) return;
      const radius = brushRef.current;
      const r2 = radius * radius;
      const f = dots.field;
      let changed = false;
      const c0 = Math.max(0, Math.floor((wx - radius - f.originX) / f.pitch));
      const c1 = Math.min(f.cols - 1, Math.floor((wx + radius - f.originX) / f.pitch));
      const r0 = Math.max(0, Math.floor((wy - radius - f.originY) / f.pitch));
      const r1 = Math.min(f.rows - 1, Math.floor((wy + radius - f.originY) / f.pitch));

      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const cell = cy * f.cols + cx;
          const ccx = f.originX + (cx + 0.5) * f.pitch;
          const ccy = f.originY + (cy + 0.5) * f.pitch;
          const dist2 = (ccx - wx) ** 2 + (ccy - wy) ** 2;
          if (dist2 > r2 || !pointInPanel(p.panel, ccx, ccy)) continue;
          const falloff = 1 - Math.sqrt(dist2) / radius;
          if (modeRef.current === 'add') {
            // 按笔刷压力（衰减）概率加密
            if (dots.localDensity(cell) >= 1) continue;
            if (Math.random() > 0.35 + 0.6 * falloff) continue;
            const density = (dots.localDensity(cell) + 1 / f.capacity);
            const diameter = f.diameters[f.cellOffset[cell]] || p.dot.minDiameter + (p.dot.maxDiameter - p.dot.minDiameter) * density;
            if (dots.addDot(cell, ccx, ccy, diameter)) changed = true;
          } else {
            if (dots.localDensity(cell) <= 0) continue;
            if (Math.random() > 0.35 + 0.6 * falloff) continue;
            dots.removeDot(cell);
            changed = true;
          }
        }
      }
      if (changed) {
        r.uploadDots(dots);
        r.render({ x: wx, y: wy, radiusMm: radius });
        notifyEdit();
      }
    },
    [dots],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !dots) return;
    beginBrushEdit();
    paintingRef.current = true;
    const { w } = eventToWorld(e);
    applyBrush(w.x, w.y);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const r = rendererRef.current;
    if (!r || !dots || !project) return;
    const { w, sx, sy } = eventToWorld(e);
    const probe = dots.probe(w.x, w.y);
    setTip({ x: w.x, y: w.y, sx, sy, d: probe.diameter, density: probe.density });
    r.render({ x: w.x, y: w.y, radiusMm: brushRef.current });
    if (paintingRef.current) {
      const now = performance.now();
      if (now - lastStrokeRef.current > 24) {
        lastStrokeRef.current = now;
        applyBrush(w.x, w.y);
      }
    }
  };

  const endPaint = () => {
    paintingRef.current = false;
  };

  // 平移缩放（右键/中键拖移与滚轮）
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    r.camera.scale = Math.max(0.4, Math.min(60, r.camera.scale * factor));
    r.render();
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    panRef.current = { x: e.clientX, y: e.clientY, ox: rendererRef.current!.camera.offsetX, oy: rendererRef.current!.camera.offsetY };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const pan = panRef.current;
      const r = rendererRef.current;
      if (!pan || !r) return;
      // 屏幕像素 → 世界毫米：直接除以相机 scale（相机按 CSS 像素工作）
      r.camera.offsetX = pan.ox + (e.clientX - pan.x) / r.camera.scale;
      r.camera.offsetY = pan.oy + (e.clientY - pan.y) / r.camera.scale;
      r.render();
    };
    const up = () => (panRef.current = null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  // 键盘撤销重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stats = useMemo(() => {
    if (!dots) return null;
    let occupied = 0;
    for (let i = 0; i < dots.field.counts.length; i++) if (dots.field.counts[i] > 0) occupied++;
    return { total: dots.totalDots, cells: dots.field.counts.length, occupied };
    // editVersion 变化（刷子增删）时强制重算统计
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dots, editVersion]);

  if (!project || !dots) return <div className="empty">请先选择方案</div>;

  return (
    <div>
      <PageHeader title="网点编辑" sub="左键刷动加密 / 抹稀，右键拖拽平移，滚轮缩放，Ctrl+Z 撤销、Ctrl+Y 重做。悬停查看该处网点直径与局部密度。" />
      <div className="editor-wrap">
        <div className="canvas-host" style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endPaint}
            onMouseLeave={() => {
              endPaint();
              setTip(null);
              rendererRef.current?.render();
            }}
            onWheel={onWheel}
            onContextMenu={onContextMenu}
          />
          {tip && (
            <div className="tooltip" style={{ left: Math.min(tip.sx + 16, (canvasRef.current?.clientWidth ?? 400) - 170), top: tip.sy + 12 }}>
              <div>坐标：{tip.x.toFixed(2)}, {tip.y.toFixed(2)} mm</div>
              <div>网点直径：{tip.d > 0 ? `${tip.d.toFixed(3)} mm` : '（无网点）'}</div>
              <div>局部密度：{(tip.density * 100).toFixed(0)}%</div>
            </div>
          )}
        </div>

        <div className="side-panel">
          <section className="card">
            <h3>画笔</h3>
            <div className="tool-group">
              <button className={`btn ${mode === 'add' ? '' : 'ghost'}`} onClick={() => setMode('add')}>加密刷</button>
              <button className={`btn ${mode === 'remove' ? 'danger' : 'ghost'}`} onClick={() => setMode('remove')}>抹稀刷</button>
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              <span>笔刷半径：{brushMm.toFixed(1)} mm</span>
              <input type="range" min={1} max={15} step={0.5} value={brushMm} onChange={(e) => setBrushMm(parseFloat(e.target.value))} />
            </label>
          </section>

          <section className="card">
            <h3>历史</h3>
            <div className="btn-row">
              <button className="btn ghost" disabled={undoCount === 0} onClick={undo}>撤销 ({undoCount})</button>
              <button className="btn ghost" disabled={redoCount === 0} onClick={redo}>重做 ({redoCount})</button>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>快捷键 Ctrl+Z / Ctrl+Y</div>
          </section>

          <section className="card">
            <h3>统计</h3>
            {stats && (
              <div style={{ lineHeight: 2 }} className="mono">
                <div>网点总数：<b>{stats.total.toLocaleString()}</b></div>
                <div>网格单元：{stats.cells.toLocaleString()}（占用 {stats.occupied.toLocaleString()}）</div>
                <div>网格间距：{dots.field.pitch} mm</div>
                <div>容量上限：{(stats.cells * dots.field.capacity).toLocaleString()} 颗</div>
              </div>
            )}
            <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => rendererRef.current?.fitView()}>适配视图</button>
          </section>
        </div>
      </div>
    </div>
  );
}
