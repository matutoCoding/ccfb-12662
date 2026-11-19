import { PageHeader, useToast } from '../App';
import { Card, MultiToggle, NumberField, SelectField } from '../controls';
import { regenerateDots, updateProject, useStore } from '../../data/store';
import type { DistributionType, LightEdge, PanelShape } from '../../types';
import { CurveEditor } from './CurveEditor';

const EDGE_OPTIONS: { value: LightEdge; label: string }[] = [
  { value: 'left', label: '左边' },
  { value: 'right', label: '右边' },
  { value: 'top', label: '上边' },
  { value: 'bottom', label: '下边' },
];

export function PanelPage() {
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeId));
  const dots = useStore((s) => s.dots);
  const toast = useToast();
  if (!project) return <div className="empty">请先选择方案</div>;
  const { panel, led, dot, film } = project;

  return (
    <div>
      <PageHeader title="板件参数" sub="调整板件、光源、网点生成参数与膜片配置。结构参数修改后可手动重新生成网点；膜片参数独立生效，不影响网点排布。" />

      <Card title="板件几何">
        <div className="grid-4">
          <SelectField<PanelShape>
            label="板件形状"
            value={panel.shape}
            options={[{ value: 'rectangle', label: '矩形' }, { value: 'chamfered', label: '切角异形' }]}
            onChange={(v) => updateProject((p) => (p.panel.shape = v), true)}
          />
          <NumberField label="宽度" unit="mm" value={panel.width} min={10} step={1} onChange={(v) => updateProject((p) => (p.panel.width = v), true)} />
          <NumberField label="高度" unit="mm" value={panel.height} min={10} step={1} onChange={(v) => updateProject((p) => (p.panel.height = v), true)} />
          <NumberField label="厚度" unit="mm" value={panel.thickness} min={0.2} step={0.1} onChange={(v) => updateProject((p) => (p.panel.thickness = v))} />
        </div>
        {panel.shape === 'chamfered' && (
          <div className="grid-4" style={{ marginTop: 12 }}>
            <NumberField label="左上角切角" unit="mm" value={panel.chamfer.topLeft} min={0} onChange={(v) => updateProject((p) => (p.panel.chamfer.topLeft = v), true)} />
            <NumberField label="右上角切角" unit="mm" value={panel.chamfer.topRight} min={0} onChange={(v) => updateProject((p) => (p.panel.chamfer.topRight = v), true)} />
            <NumberField label="左下角切角" unit="mm" value={panel.chamfer.bottomLeft} min={0} onChange={(v) => updateProject((p) => (p.panel.chamfer.bottomLeft = v), true)} />
            <NumberField label="右下角切角" unit="mm" value={panel.chamfer.bottomRight} min={0} onChange={(v) => updateProject((p) => (p.panel.chamfer.bottomRight = v), true)} />
          </div>
        )}
      </Card>

      <Card title="光源（LED）">
        <div style={{ marginBottom: 12 }}>
          <span className="muted" style={{ marginRight: 12 }}>入光边（支持单边/双边/四边）</span>
          <MultiToggle
            options={EDGE_OPTIONS}
            values={led.edges}
            onChange={(values) => updateProject((p) => (p.led.edges = values.length ? values : p.led.edges), true)}
          />
        </div>
        <div className="grid-4">
          <NumberField label="每边 LED 颗数" value={led.countPerEdge} min={1} step={1} onChange={(v) => updateProject((p) => (p.led.countPerEdge = Math.round(v)))} />
          <NumberField label="LED 间距" unit="mm" value={led.pitch} min={0.5} step={0.1} onChange={(v) => updateProject((p) => (p.led.pitch = v))} />
          <NumberField label="单灯光通量" unit="lm" value={led.fluxPerLed} min={0.1} step={0.5} onChange={(v) => updateProject((p) => (p.led.fluxPerLed = v))} />
          <NumberField label="色温" unit="K" value={led.colorTemp} min={2000} max={10000} step={100} onChange={(v) => updateProject((p) => (p.led.colorTemp = Math.round(v)))} />
          <NumberField label="入光耦合效率" value={led.couplingEfficiency} min={0.3} max={1} step={0.01} onChange={(v) => updateProject((p) => (p.led.couplingEfficiency = v))} />
        </div>
      </Card>

      <Card
        title="网点生成规则"
        extra={
          <span className="btn-row">
            <span className="muted">当前网点 {dots?.totalDots.toLocaleString() ?? 0} 颗</span>
            <button className="btn sm" onClick={() => { regenerateDots(); toast('已按最新参数重新生成网点', 'good'); }}>重新生成网点</button>
          </span>
        }
      >
        <div className="grid-4">
          <NumberField label="网格间距" unit="mm" value={dot.gridPitch} min={0.2} max={3} step={0.05} onChange={(v) => updateProject((p) => (p.dot.gridPitch = v), true)} />
          <NumberField label="网点直径下限" unit="mm" value={dot.minDiameter} min={0.02} step={0.01} onChange={(v) => updateProject((p) => (p.dot.minDiameter = v), true)} />
          <NumberField label="网点直径上限" unit="mm" value={dot.maxDiameter} min={0.02} step={0.01} onChange={(v) => updateProject((p) => (p.dot.maxDiameter = v), true)} />
          <NumberField label="随机抖动幅度" value={dot.jitter} min={0} max={1} step={0.05} onChange={(v) => updateProject((p) => (p.dot.jitter = v), true)} />
          <SelectField<DistributionType>
            label="分布方式"
            value={dot.distribution}
            options={[
              { value: 'linear', label: '线性（距入光边）' },
              { value: 'exponential', label: '指数（远端加速加密）' },
              { value: 'radial', label: '径向（中心对称）' },
            ]}
            onChange={(v) => updateProject((p) => (p.dot.distribution = v), true)}
          />
          <NumberField label="抖动随机种子" value={dot.seed} step={1} onChange={(v) => updateProject((p) => (p.dot.seed = Math.round(v)), true)} />
        </div>
        <div style={{ marginTop: 16 }}>
          <span className="muted">初始密度曲线</span>
          <CurveEditor value={dot.densityCurve} onChange={(curve) => updateProject((p) => (p.dot.densityCurve = curve), true)} />
        </div>
      </Card>

      <Card title="反射片 / 扩散片（独立配置，换参数无需重新生成网点）">
        <div className="grid-4">
          <NumberField label="反射片反射率" value={film.reflectorReflectance} min={0.5} max={1} step={0.01} onChange={(v) => updateProject((p) => (p.film.reflectorReflectance = v))} />
          <NumberField label="扩散片雾度" value={film.diffuserHaze} min={0} max={1} step={0.01} onChange={(v) => updateProject((p) => (p.film.diffuserHaze = v))} />
          <NumberField label="扩散距离" unit="mm" value={film.diffusionDistance} min={0} max={6} step={0.1} onChange={(v) => updateProject((p) => (p.film.diffusionDistance = v))} />
          <NumberField label="网点散射反照率" value={film.dotAlbedo} min={0.8} max={1} step={0.005} onChange={(v) => updateProject((p) => (p.film.dotAlbedo = v))} />
        </div>
      </Card>
    </div>
  );
}
