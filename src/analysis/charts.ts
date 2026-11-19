// 轻量 Canvas2D 折线图（收敛曲线、剖面对比），零第三方依赖
export interface LineSeries {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

export interface LineChartOptions {
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  yMin?: number;
  yMax?: number;
  legend?: boolean;
}

export function renderLineChart(series: LineSeries[], opts: LineChartOptions = {}): HTMLCanvasElement {
  const W = opts.width ?? 640;
  const H = opts.height ?? 300;
  const padL = 56;
  const padR = 16;
  const padT = 18;
  const padB = 42;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#12161c';
  ctx.fillRect(0, 0, W, H);

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return canvas;
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const yMin = opts.yMin ?? Math.min(...all.map((p) => p.y));
  const yMax = opts.yMax ?? Math.max(...all.map((p) => p.y));
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;

  const px = (x: number) => padL + ((x - xMin) / xSpan) * (W - padL - padR);
  const py = (y: number) => padT + (1 - (y - yMin) / ySpan) * (H - padT - padB);

  // 网格与刻度
  ctx.strokeStyle = '#2a313c';
  ctx.fillStyle = '#8b95a5';
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padT + (i / 5) * (H - padT - padB);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    const val = yMax - (i / 5) * ySpan;
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(3), padL - 6, y + 4);
  }
  for (let i = 0; i <= 5; i++) {
    const x = padL + (i / 5) * (W - padL - padR);
    const val = xMin + (i / 5) * xSpan;
    ctx.textAlign = 'center';
    ctx.fillText(val.toFixed(xSpan < 10 ? 2 : 0), x, H - padB + 16);
  }

  // 数据线
  for (const s of series) {
    if (s.points.length === 0) continue;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    s.points.forEach((p, i) => {
      const x = px(p.x);
      const y = py(p.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 轴标签
  ctx.fillStyle = '#c6ceda';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  if (opts.xLabel) ctx.fillText(opts.xLabel, (padL + W - padR) / 2, H - 6);
  ctx.save();
  ctx.translate(14, (padT + H - padB) / 2);
  ctx.rotate(-Math.PI / 2);
  if (opts.yLabel) ctx.fillText(opts.yLabel, 0, 0);
  ctx.restore();

  if (opts.legend !== false) {
    let lx = padL + 8;
    ctx.font = '12px sans-serif';
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, padT - 8, 18, 3);
      ctx.fillStyle = '#c6ceda';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 24, padT - 3);
      lx += 24 + ctx.measureText(s.label).width + 18;
    }
  }
  return canvas;
}
