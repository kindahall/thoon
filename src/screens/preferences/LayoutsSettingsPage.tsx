'use client';

import { Copy, Edit3, LayoutGrid, Save, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, EmptyState, HelpPopover } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { UserPreferences, WorkspaceLayoutKind, WorkspaceLayoutSettings } from '../../types/trading';
import { cn } from '../../utils/classNames';

type SidebarBehavior = WorkspaceLayoutSettings['sidebarBehavior'];
type PanelDocking = WorkspaceLayoutSettings['panelDocking'];
type WorkspaceVisibility = WorkspaceLayoutSettings['layouts'][number]['settings'];
type SavedWorkspaceLayout = WorkspaceLayoutSettings['layouts'][number];

const baseLayouts: SavedWorkspaceLayout[] = [
  {
    default: true,
    id: 'single-chart',
    kind: 'single',
    name: 'Single Chart',
    panels: 'Chart + orders',
    settings: { alertsPanel: false, bottomPanel: true, newsFeed: false, orderPanel: true, primaryChart: true, rightPanel: true, watchlist: true },
    updatedAt: 'May 5',
  },
  {
    id: 'multi-chart',
    kind: 'multi',
    name: 'Multi-Chart',
    panels: '2 charts + watchlist',
    settings: { alertsPanel: true, bottomPanel: false, newsFeed: false, orderPanel: false, primaryChart: true, rightPanel: true, watchlist: true },
    updatedAt: 'May 4',
  },
  {
    id: 'bot-monitor',
    kind: 'bot',
    name: 'Bot Monitor',
    panels: 'Bots + logs',
    settings: { alertsPanel: true, bottomPanel: true, newsFeed: false, orderPanel: true, primaryChart: false, rightPanel: true, watchlist: false },
    updatedAt: 'May 3',
  },
  {
    id: 'backtest-lab',
    kind: 'backtest',
    name: 'Backtest Lab',
    panels: 'Inputs + report',
    settings: { alertsPanel: false, bottomPanel: true, newsFeed: false, orderPanel: false, primaryChart: true, rightPanel: false, watchlist: false },
    updatedAt: 'May 2',
  },
  {
    id: 'trade-journal',
    kind: 'journal',
    name: 'Trade Journal',
    panels: 'Journal + detail',
    settings: { alertsPanel: false, bottomPanel: true, newsFeed: false, orderPanel: false, primaryChart: false, rightPanel: true, watchlist: true },
    updatedAt: 'May 1',
  },
  {
    id: 'custom-layout',
    kind: 'custom',
    name: 'Custom Layout',
    panels: 'Saved workspace',
    settings: { alertsPanel: true, bottomPanel: true, newsFeed: true, orderPanel: true, primaryChart: true, rightPanel: true, watchlist: true },
    updatedAt: 'Apr 29',
  },
];

const visibilityControls: Array<{ key: keyof WorkspaceVisibility; label: string }> = [
  { key: 'primaryChart', label: 'Primary Chart' },
  { key: 'orderPanel', label: 'Order Panel' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'bottomPanel', label: 'Bottom Panel' },
  { key: 'rightPanel', label: 'Right Panel' },
  { key: 'alertsPanel', label: 'Alerts Panel' },
  { key: 'newsFeed', label: 'News Feed' },
];

function normalizeWorkspaceLayoutSettings(settings: UserPreferences['workspaceLayouts']): WorkspaceLayoutSettings {
  const layouts = settings?.layouts?.length ? settings.layouts : baseLayouts;
  const firstLayoutId = layouts[0]?.id ?? 'single-chart';
  const requestedActiveLayoutId = settings?.activeLayoutId;
  const requestedDefaultLayoutId = settings?.defaultLayoutId;

  return {
    activeLayoutId: requestedActiveLayoutId && layouts.some((layout) => layout.id === requestedActiveLayoutId) ? requestedActiveLayoutId : firstLayoutId,
    defaultLayoutId: requestedDefaultLayoutId && layouts.some((layout) => layout.id === requestedDefaultLayoutId) ? requestedDefaultLayoutId : firstLayoutId,
    layouts,
    panelDocking: settings?.panelDocking ?? 'right',
    sidebarBehavior: settings?.sidebarBehavior ?? 'expanded',
    updatedAt: settings?.updatedAt ?? new Date(0).toISOString(),
  };
}

type LayoutsSettingsPageProps = {
  preferences: UserPreferences;
};

export function LayoutsSettingsPage({ preferences }: LayoutsSettingsPageProps) {
  const initialSettings = normalizeWorkspaceLayoutSettings(preferences.workspaceLayouts);
  const [layouts, setLayouts] = useState(initialSettings.layouts);
  const [activeLayoutId, setActiveLayoutId] = useState(initialSettings.activeLayoutId);
  const [selectedLayoutId, setSelectedLayoutId] = useState(initialSettings.activeLayoutId);
  const [defaultLayoutId, setDefaultLayoutId] = useState(initialSettings.defaultLayoutId);
  const [sidebarBehavior, setSidebarBehavior] = useState<SidebarBehavior>(initialSettings.sidebarBehavior);
  const [panelDocking, setPanelDocking] = useState<PanelDocking>(initialSettings.panelDocking);
  const [saveStatus, setSaveStatus] = useState('Ready');
  const selectedLayout = layouts.find((layout) => layout.id === selectedLayoutId) ?? layouts[0];
  const activeLayout = layouts.find((layout) => layout.id === activeLayoutId) ?? selectedLayout;
  const [visibility, setVisibility] = useState(activeLayout.settings);

  const visibleCount = useMemo(() => Object.values(visibility).filter(Boolean).length, [visibility]);

  function applyLayout(layout: SavedWorkspaceLayout) {
    const nextSettings = layout.settings;

    setActiveLayoutId(layout.id);
    setSelectedLayoutId(layout.id);
    setVisibility(nextSettings);
    void persistLayouts({
      activeLayoutId: layout.id,
      defaultLayoutId,
      layouts,
      panelDocking,
      sidebarBehavior,
      updatedAt: new Date().toISOString(),
    }, `Applied ${layout.name}`);
  }

  function duplicateLayout(layout: SavedWorkspaceLayout) {
    const nextLayout = {
      ...layout,
      default: false,
      id: `${layout.id}-copy-${Date.now()}`,
      name: `${layout.name} Copy`,
      updatedAt: 'Now',
    };

    const nextLayouts = [nextLayout, ...layouts];

    setLayouts(nextLayouts);
    setSelectedLayoutId(nextLayout.id);
    void persistLayouts({
      activeLayoutId,
      defaultLayoutId,
      layouts: nextLayouts,
      panelDocking,
      sidebarBehavior,
      updatedAt: new Date().toISOString(),
    }, 'Duplicated');
  }

  function deleteLayout(layoutId: string) {
    if (layouts.length <= 1) {
      return;
    }

    const nextLayouts = layouts.filter((layout) => layout.id !== layoutId);
    const nextActiveLayoutId = activeLayoutId === layoutId ? nextLayouts[0].id : activeLayoutId;
    const nextDefaultLayoutId = defaultLayoutId === layoutId ? nextLayouts[0].id : defaultLayoutId;

    setLayouts(nextLayouts);
    setActiveLayoutId(nextActiveLayoutId);
    setDefaultLayoutId(nextDefaultLayoutId);
    setSelectedLayoutId(nextActiveLayoutId);
    void persistLayouts({
      activeLayoutId: nextActiveLayoutId,
      defaultLayoutId: nextDefaultLayoutId,
      layouts: nextLayouts,
      panelDocking,
      sidebarBehavior,
      updatedAt: new Date().toISOString(),
    }, 'Deleted');
  }

  function saveCurrentLayout() {
    const nextLayouts = layouts.map((layout) => (layout.id === activeLayoutId ? { ...layout, settings: visibility, updatedAt: new Date().toISOString() } : layout));

    setLayouts(nextLayouts);
    void persistLayouts({
      activeLayoutId,
      defaultLayoutId,
      layouts: nextLayouts,
      panelDocking,
      sidebarBehavior,
      updatedAt: new Date().toISOString(),
    }, 'Saved');
  }

  function resetLayout() {
    setVisibility(activeLayout.settings);
    setSaveStatus('Reset');
  }

  function toggleVisibility(key: keyof WorkspaceVisibility) {
    setVisibility((current) => ({ ...current, [key]: !current[key] }));
  }

  function updateDefaultLayout(nextDefaultLayoutId: string) {
    setDefaultLayoutId(nextDefaultLayoutId);
    void persistLayouts({
      activeLayoutId,
      defaultLayoutId: nextDefaultLayoutId,
      layouts,
      panelDocking,
      sidebarBehavior,
      updatedAt: new Date().toISOString(),
    }, 'Default saved');
  }

  function updateSidebarBehavior(nextSidebarBehavior: SidebarBehavior) {
    setSidebarBehavior(nextSidebarBehavior);
    void persistLayouts({
      activeLayoutId,
      defaultLayoutId,
      layouts,
      panelDocking,
      sidebarBehavior: nextSidebarBehavior,
      updatedAt: new Date().toISOString(),
    }, 'Sidebar saved');
  }

  function updatePanelDocking(nextPanelDocking: PanelDocking) {
    setPanelDocking(nextPanelDocking);
    void persistLayouts({
      activeLayoutId,
      defaultLayoutId,
      layouts,
      panelDocking: nextPanelDocking,
      sidebarBehavior,
      updatedAt: new Date().toISOString(),
    }, 'Docking saved');
  }

  async function persistLayouts(settings: WorkspaceLayoutSettings, successStatus: string) {
    setSaveStatus('Saving');

    try {
      const updatedPreferences = await patchJson<UserPreferences>('/api/preferences', { workspaceLayouts: settings });
      const persistedSettings = normalizeWorkspaceLayoutSettings(updatedPreferences.workspaceLayouts);

      setLayouts(persistedSettings.layouts);
      setActiveLayoutId(persistedSettings.activeLayoutId);
      setDefaultLayoutId(persistedSettings.defaultLayoutId);
      setSidebarBehavior(persistedSettings.sidebarBehavior);
      setPanelDocking(persistedSettings.panelDocking);
      setSaveStatus(successStatus);
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section className="layouts-settings-page" aria-label="Layouts and workspace settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Layouts / Workspace</h1>
          <p>Customize, save, and manage your workspace layouts.</p>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Upload size={15} />} onClick={() => setSaveStatus('Import ready')} size="sm" variant="ghost">
            Import Layout
          </Button>
          <Button icon={<Save size={15} />} onClick={saveCurrentLayout} size="sm" variant="primary">
            Save Current
          </Button>
          <HelpPopover items={['Apply changes the preview immediately.', 'Saved layouts are persisted in the Thoon local data store.']} title="Layouts" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="layouts" />

        <div className="layouts-workspace">
          <div className="layouts-grid">
            <div className="layouts-main-stack">
              <Card className="saved-layouts-card">
                <div className="layouts-card-head">
                  <h2>Saved Layouts</h2>
                  <div>
                    <Button icon={<Save size={15} />} onClick={saveCurrentLayout} size="sm" variant="primary">
                      Save Current Layout
                    </Button>
                    <Button icon={<Upload size={15} />} onClick={() => setSaveStatus('Import ready')} size="sm" variant="ghost">
                      Import Layout
                    </Button>
                  </div>
                </div>

                {layouts.length > 0 ? (
                  <div className="saved-layout-card-grid">
                    {layouts.map((layout) => (
                      <article className={cn('saved-layout-card', selectedLayoutId === layout.id && 'is-selected')} key={layout.id}>
                        <button className="saved-layout-preview-button" onClick={() => setSelectedLayoutId(layout.id)} type="button">
                          <WorkspaceMiniPreview kind={layout.kind} />
                        </button>
                        {layout.id === defaultLayoutId ? <Badge tone="positive">Default</Badge> : null}
                        <div>
                          <strong>{layout.name}</strong>
                          <small>{layoutDescription(layout.kind)}</small>
                        </div>
                        <div className="saved-layout-actions">
                          <button aria-label={`Apply ${layout.name}`} onClick={() => applyLayout(layout)} type="button">
                            Apply
                          </button>
                          <button aria-label={`Duplicate ${layout.name}`} onClick={() => duplicateLayout(layout)} title="Duplicate" type="button">
                            <Copy size={14} />
                          </button>
                          <button aria-label={`Edit ${layout.name}`} onClick={() => setSaveStatus(`Editing ${layout.name}`)} title="Edit" type="button">
                            <Edit3 size={14} />
                          </button>
                          <button aria-label={`Delete ${layout.name}`} onClick={() => deleteLayout(layout.id)} title="Delete" type="button">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState actionLabel="Save Layout" description="Save workspace layouts after arranging panels." icon={<LayoutGrid size={20} />} title="No saved layouts" />
                )}
              </Card>

              <Card className="workspace-controls-card">
                <div className="layouts-card-head">
                  <h2>Workspace Controls</h2>
                  <Badge tone="primary">{saveStatus}</Badge>
                </div>
                <div className="workspace-control-grid">
                  <label className="workspace-select-control">
                    <span>Set Default Workspace</span>
                    <select value={defaultLayoutId} onChange={(event) => updateDefaultLayout(event.target.value)}>
                      {layouts.map((layout) => (
                        <option key={layout.id} value={layout.id}>
                          {layout.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="workspace-control-row">
                    <span>Reset Layout</span>
                    <Button onClick={resetLayout} size="sm" variant="ghost">
                      Reset Now
                    </Button>
                  </div>
                  <label className="workspace-select-control">
                    <span>Sidebar Behavior</span>
                    <select value={sidebarBehavior} onChange={(event) => updateSidebarBehavior(event.target.value as SidebarBehavior)}>
                      <option value="expanded">Expanded</option>
                      <option value="compact">Compact</option>
                      <option value="auto">Auto Hide</option>
                    </select>
                  </label>
                  <label className="workspace-select-control">
                    <span>Panel Docking</span>
                    <select value={panelDocking} onChange={(event) => updatePanelDocking(event.target.value as PanelDocking)}>
                      <option value="right">Smart Docking</option>
                      <option value="bottom">Bottom Dock</option>
                      <option value="floating">Floating</option>
                    </select>
                  </label>
                  <div className="workspace-control-row">
                    <span>Widget Visibility</span>
                    <Button onClick={() => setSaveStatus(`${visibleCount} widgets visible`)} size="sm" variant="ghost">
                      Configure Widgets
                    </Button>
                  </div>
                </div>
              </Card>
            </div>

            <aside className="layouts-side-stack">
              <Card className="workspace-preview-card">
                <div className="layouts-card-head">
                  <h2>Workspace Preview</h2>
                  <select aria-label="Workspace preview layout" value={selectedLayoutId} onChange={(event) => setSelectedLayoutId(event.target.value)}>
                    {layouts.map((layout) => (
                      <option key={layout.id} value={layout.id}>
                        {layout.name}
                      </option>
                    ))}
                  </select>
                </div>
                <WorkspacePreview docking={panelDocking} settings={visibility} />

                <div className="workspace-settings-list">
                  <h2>Workspace Settings</h2>
                  {visibilityControls.map((control) => (
                    <button key={control.key} onClick={() => toggleVisibility(control.key)} type="button">
                      <span>{control.label}</span>
                      <strong>{visibility[control.key] ? 'Visible' : 'Hidden'}</strong>
                    </button>
                  ))}
                </div>

                <Button onClick={() => applyLayout(selectedLayout)} size="sm" variant="primary">
                  Apply This Layout
                </Button>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceMiniPreview({ kind }: { kind: WorkspaceLayoutKind }) {
  return (
    <div className={`workspace-mini-preview is-${kind}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <i />
    </div>
  );
}

function WorkspacePreview({ docking, settings }: { docking: PanelDocking; settings: WorkspaceVisibility }) {
  return (
    <div className={cn('workspace-preview', `is-${docking}`)}>
      <div className={cn('preview-watchlist', !settings.watchlist && 'is-hidden')}>Watchlist</div>
      <div className={cn('preview-chart', !settings.primaryChart && 'is-hidden')}>
        <span />
        <strong>Chart</strong>
      </div>
      <div className={cn('preview-right', !settings.rightPanel && 'is-hidden')}>
        <div className={!settings.orderPanel ? 'is-hidden' : undefined}>Order Panel</div>
        <div className={!settings.alertsPanel ? 'is-hidden' : undefined}>Alerts</div>
        <div className={!settings.newsFeed ? 'is-hidden' : undefined}>News</div>
      </div>
      <div className={cn('preview-bottom', !settings.bottomPanel && 'is-hidden')}>Bottom Panel</div>
    </div>
  );
}

function layoutDescription(kind: WorkspaceLayoutKind) {
  switch (kind) {
    case 'single':
      return 'Clean and focused view with a single chart and order panel.';
    case 'multi':
      return 'Multiple charts in a grid with watchlist and order panel.';
    case 'bot':
      return 'Monitor all your bots with performance and logs.';
    case 'backtest':
      return 'Backtesting workspace with results, charts, and metrics.';
    case 'journal':
      return 'Review trades, notes, and performance analytics.';
    case 'custom':
      return 'Start from a blank canvas and build your own layout.';
  }
}
