// HTML 仿真报告：内嵌参数、伪彩截图、九点数据与均匀度结论，单文件可直接发同事
import type { SimResult } from '../types';
import { renderHeatmap } from './heatmap';
import { renderLineChart } from './charts';

export function buildReport(result: SimResult, comparison?: { after: SimResult }): string {
  const project = result.projectSnapshot;
  const heat = renderHeatmap(result, { showNinePoint: true, showZones: true, width: 680 });
  const conv = renderLineChart(
    [
      {
        label: '九点均匀度收敛',
        color: '#5db1ff',
        points: result.convergence.map((c) => ({ x: c.rays, y: c.uniformity })),
      },
    ],
    { width: 680, height: 240, xLabel: '累计投射线数', yLabel: '均匀度 (min/avg)' },
  );

  const nineRows = result.ninePoint
    .map((v, i) => `<tr><td>${i + 1}</td><td>${(v / result.avgIrradiance).toFixed(3)}</td><td>${v.toExponential(3)}</td></tr>`)
    .join('');

  const verdict =
    result.uniformity >= 0.85
      ? '优秀（≥0.85），满足车载/工控背光常规验收要求'
      : result.uniformity >= 0.75
        ? '合格区间但有提升空间，建议执行一轮密度反推修正'
        : '偏低，暗区明显，建议调整密度曲线后重新仿真或执行自动修正';

  const cmpBlock = comparison
    ? `<h3>修正前后对比</h3>
       <table><tr><th>指标</th><th>修正前</th><th>修正后</th><th>变化</th></tr>
       <tr><td>九点均匀度</td><td>${result.uniformity.toFixed(4)}</td><td>${comparison.after.uniformity.toFixed(4)}</td>
       <td class="${comparison.after.uniformity >= result.uniformity ? 'good' : 'bad'}">${((comparison.after.uniformity - result.uniformity) * 100).toFixed(2)} 个百分点</td></tr>
       <tr><td>暗区单元数</td><td>${result.darkZones.length}</td><td>${comparison.after.darkZones.length}</td><td>${comparison.after.darkZones.length - result.darkZones.length}</td></tr></table>`
    : '';

  const p = project.panel;
  const l = project.led;
  const d = project.dot;
  const f = project.film;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>导光板仿真报告 - ${escapeHtml(project.name)}</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;max-width:860px;margin:24px auto;color:#1d2430;background:#f5f7fa;padding:0 18px}
h1{font-size:22px;border-bottom:3px solid #2b6cb0;padding-bottom:8px}
h2{font-size:17px;margin-top:26px;color:#2b6cb0}
h3{font-size:15px;margin-top:18px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13px}
th,td{border:1px solid #c9d2de;padding:7px 10px;text-align:left}
th{background:#e8eef6}
img{max-width:100%;border:1px solid #c9d2de;border-radius:6px;margin:8px 0}
.good{color:#1a7f37;font-weight:600}.bad{color:#c0392b;font-weight:600}
.meta{color:#667;font-size:12px}.box{background:#fff;border:1px solid #d6dde7;border-radius:8px;padding:14px 18px;margin:12px 0}
</style></head><body>
<h1>导光板出光仿真报告</h1>
<p class="meta">方案：${escapeHtml(project.name)} ｜ 任务：${result.taskId} ｜ 生成时间：${new Date(result.createdAt).toLocaleString('zh-CN')} ｜ 随机种子：${result.settings.seed} ｜ 投射线数：${result.raysShot.toLocaleString()}</p>

<div class="box"><h2 style="margin-top:0">结论</h2>
<p><b>九点均匀度（最小照度 / 平均照度）= ${result.uniformity.toFixed(4)}（${(result.uniformity * 100).toFixed(2)}%）</b></p>
<p>${verdict}</p>
<p class="meta">平均相对照度 ${result.avgIrradiance.toExponential(3)}，最小 ${result.minIrradiance.toExponential(3)}，最大 ${result.maxIrradiance.toExponential(3)}；暗区 ${result.darkZones.length} 格，入光亮带 ${result.brightBands.length} 格。</p>
</div>

<h2>照度伪彩图（九点编号 + 暗区遮罩 + 亮带红框）</h2>
<img src="${heat.toDataURL('image/png')}" alt="heatmap">

<h2>收敛曲线</h2>
<img src="${conv.toDataURL('image/png')}" alt="convergence">

<h2>九点照度</h2>
<table><tr><th>点位</th><th>相对照度 (E/Eavg)</th><th>照度值</th></tr>${nineRows}</table>

${cmpBlock}

<h2>参数快照</h2>
<table>
<tr><th>板件</th><td>${p.shape === 'chamfered' ? '切角异形' : '矩形'} ${p.width}×${p.height}×${p.thickness}mm，切角 TL${p.chamfer.topLeft}/TR${p.chamfer.topRight}/BL${p.chamfer.bottomLeft}/BR${p.chamfer.bottomRight}</td></tr>
<tr><th>光源</th><td>${l.edges.join('、')} 入光，每边 ${l.countPerEdge} 颗，间距 ${l.pitch}mm，单灯 ${l.fluxPerLed}lm，色温 ${l.colorTemp}K，耦合效率 ${(l.couplingEfficiency * 100).toFixed(1)}%</td></tr>
<tr><th>网点</th><td>网格 ${d.gridPitch}mm，直径 ${d.minDiameter}~${d.maxDiameter}mm，${d.distribution} 分布，抖动 ${d.jitter}，种子 ${d.seed}${project.correction ? '，含一轮自动修正层' : ''}</td></tr>
<tr><th>膜片</th><td>反射率 ${(f.reflectorReflectance * 100).toFixed(1)}%，雾度 ${(f.diffuserHaze * 100).toFixed(1)}%，扩散距离 ${f.diffusionDistance}mm，网点反照率 ${(f.dotAlbedo * 100).toFixed(1)}%</td></tr>
<tr><th>能量审计</th><td>注入 ${result.energyAudit.injected.toExponential(3)}，顶面出光 ${result.energyAudit.exited.toExponential(3)}，吸收 ${result.energyAudit.absorbed.toExponential(3)}，边界逃逸 ${result.energyAudit.escaped.toExponential(3)}（守恒偏差 ${energyBalance(result).toFixed(2)}%）</td></tr>
</table>
<p class="meta">本报告由导光板网点设计与仿真系统生成，仿真为固定种子蒙特卡洛光线追踪，同参数结果可复现。</p>
</body></html>`;
}

function energyBalance(r: SimResult): number {
  const a = r.energyAudit;
  const sum = a.exited + a.absorbed + a.escaped;
  return a.injected > 0 ? (Math.abs(sum - a.injected) / a.injected) * 100 : 100;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function downloadReport(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
