import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { initStore, useStore, createCorrectedProject } from '../data/store';
import { scheduler } from '../data/scheduler';
import { ProjectListPage } from './pages/ProjectListPage';
import { PanelPage } from './pages/PanelPage';
import { DotEditorPage } from './pages/DotEditorPage';
import { SimTasksPage } from './pages/SimTasksPage';
import { AnalysisPage } from './pages/AnalysisPage';

export type Route = 'projects' | 'panel' | 'dots' | 'sim' | 'analysis';

const NAV: { route: Route; label: string; ico: string }[] = [
  { route: 'projects', label: '方案列表', ico: '▤' },
  { route: 'panel', label: '板件参数', ico: '▭' },
  { route: 'dots', label: '网点编辑', ico: '◌' },
  { route: 'sim', label: '仿真任务', ico: '▶' },
  { route: 'analysis', label: '结果分析', ico: '▦' },
];

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function App() {
  const [route, setRoute] = useState<Route>('projects');
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const activeId = useStore((s) => s.activeId);
  const dirty = useStore((s) => s.dirty);

  useEffect(() => {
    (async () => {
      await initStore();
      await scheduler.init();
      setReady(true);
    })();
    const onBefore = (e: BeforeUnloadEvent) => {
      if (useStore.length) e.preventDefault();
    };
    // 分析页发出的自动修正事件 → 落库新方案
    const onCorrection = async (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { project: import('../types').Project; dots: import('../types').SerializedDotField };
      await createCorrectedProject(detail.project, detail.dots);
    };
    window.addEventListener('beforeunload', onBefore);
    window.addEventListener('lgp:correction', onCorrection);
    return () => {
      window.removeEventListener('beforeunload', onBefore);
      window.removeEventListener('lgp:correction', onCorrection);
    };
  }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  if (!ready) {
    return <div className="empty"><h2>系统初始化中…</h2><p>正在载入本地方案库与网点数据</p></div>;
  }

  const guarded = (r: Route): void => {
    if (!activeId && r !== 'projects') {
      toast('请先在方案列表中新建或选择一个方案', 'bad');
      return;
    }
    setRoute(r);
  };

  return (
    <ToastCtx.Provider value={toast}>
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            导光板网点工作室
            <small>LGP Dot Studio · WebGL2 蒙特卡洛仿真</small>
          </div>
          <nav className="nav">
            {NAV.map((n) => (
              <button key={n.route} className={route === n.route ? 'active' : ''} onClick={() => guarded(n.route)}>
                <span className="ico">{n.ico}</span>
                {n.label}
              </button>
            ))}
          </nav>
          <div className="foot">
            数据仅存储于本机浏览器
            <br />
            {dirty ? '● 草稿待自动保存' : '○ 草稿已保存'}
          </div>
        </aside>
        <main className="main">
          {route === 'projects' && <ProjectListPage onOpen={() => setRoute('panel')} />}
          {route === 'panel' && <PanelPage />}
          {route === 'dots' && <DotEditorPage />}
          {route === 'sim' && <SimTasksPage />}
          {route === 'analysis' && <AnalysisPage />}
        </main>
      </div>
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </ToastCtx.Provider>
  );
}

export function PageHeader(props: { title: string; sub: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="page-title">{props.title}</h1>
      <p className="page-sub">{props.sub}</p>
      {props.children}
    </>
  );
}
