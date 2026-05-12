'use client';

import { AlertTriangle, Check, Edit3, Keyboard, RotateCcw, Save, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover, Toggle } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import type { KeyboardShortcutSettings, UserPreferences } from '../../types/trading';
import { cn } from '../../utils/classNames';

type ShortcutCategory = 'Navigation' | 'Chart' | 'Trade Markers' | 'Orders' | 'Bots' | 'Backtest';

type ShortcutDefinition = {
  action: string;
  category: ShortcutCategory;
  id: string;
  key: string;
  safety?: 'confirm';
  scope: string;
};

const categoryOrder: ShortcutCategory[] = ['Navigation', 'Chart', 'Trade Markers', 'Orders', 'Bots', 'Backtest'];

const defaultShortcuts: ShortcutDefinition[] = [
  { action: 'Charts', category: 'Navigation', id: 'nav-charts', key: 'C', scope: 'App' },
  { action: 'Watchlist', category: 'Navigation', id: 'nav-watchlist', key: 'W', scope: 'App' },
  { action: 'Backtest', category: 'Navigation', id: 'nav-backtest', key: 'B', scope: 'App' },
  { action: 'Strategies', category: 'Navigation', id: 'nav-strategies', key: 'S', scope: 'App' },
  { action: 'Indicators', category: 'Chart', id: 'chart-indicators', key: 'I', scope: 'Chart' },
  { action: 'Draw tool', category: 'Chart', id: 'chart-draw', key: 'D', scope: 'Chart' },
  { action: 'Save Setup', category: 'Chart', id: 'chart-save-setup', key: 'Ctrl/Cmd + S', scope: 'Chart' },
  { action: 'Entry marker', category: 'Trade Markers', id: 'marker-entry', key: 'Alt + E', scope: 'Chart' },
  { action: 'Exit marker', category: 'Trade Markers', id: 'marker-exit', key: 'Alt + X', scope: 'Chart' },
  { action: 'Stop Loss marker', category: 'Trade Markers', id: 'marker-stop-loss', key: 'Alt + L', scope: 'Chart' },
  { action: 'Take Profit marker', category: 'Trade Markers', id: 'marker-take-profit', key: 'Alt + T', scope: 'Chart' },
  { action: 'Orders', category: 'Orders', id: 'orders-open', key: 'O', scope: 'App' },
  { action: 'Close dialog', category: 'Orders', id: 'orders-close-dialog', key: 'Esc', scope: 'Modal' },
  { action: 'Confirm modal', category: 'Orders', id: 'orders-confirm-modal', key: 'Ctrl/Cmd + Enter', safety: 'confirm', scope: 'Modal' },
  { action: 'Pause bot', category: 'Bots', id: 'bots-pause', key: 'P', safety: 'confirm', scope: 'Bots' },
  { action: 'Bot logs', category: 'Bots', id: 'bots-logs', key: 'G', scope: 'Bots' },
  { action: 'Run backtest', category: 'Backtest', id: 'backtest-run', key: 'R', scope: 'Backtest' },
  { action: 'Replay play/pause', category: 'Backtest', id: 'backtest-replay', key: 'Space', scope: 'Replay' },
];

function normalizeShortcutSettings(settings: UserPreferences['keyboardShortcuts']): KeyboardShortcutSettings {
  return {
    enabled: settings?.enabled ?? true,
    shortcuts: settings?.shortcuts?.length ? settings.shortcuts : defaultShortcuts,
    updatedAt: settings?.updatedAt ?? new Date(0).toISOString(),
  };
}

type KeyboardShortcutsSettingsPageProps = {
  preferences: UserPreferences;
};

export function KeyboardShortcutsSettingsPage({ preferences }: KeyboardShortcutsSettingsPageProps) {
  const initialSettings = normalizeShortcutSettings(preferences.keyboardShortcuts);
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [shortcuts, setShortcuts] = useState(initialSettings.shortcuts);
  const [activeCategory, setActiveCategory] = useState<ShortcutCategory>('Navigation');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Ready');

  const conflicts = useMemo(() => findConflicts(shortcuts), [shortcuts]);
  const visibleShortcuts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return shortcuts.filter((shortcut) => {
      const matchesCategory = shortcut.category === activeCategory;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        shortcut.action.toLowerCase().includes(normalizedQuery) ||
        shortcut.key.toLowerCase().includes(normalizedQuery) ||
        shortcut.scope.toLowerCase().includes(normalizedQuery);

      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, query, shortcuts]);

  const tradingShortcutCount = shortcuts.filter((shortcut) => shortcut.category === 'Trade Markers' || shortcut.safety === 'confirm').length;
  const draftConflict = editingId ? hasDraftConflict(shortcuts, editingId, draftKey) : false;
  const hasConflict = conflicts.size > 0;

  function startEditing(shortcut: ShortcutDefinition) {
    setEditingId(shortcut.id);
    setDraftKey(shortcut.key);
    setStatus(`Editing ${shortcut.action}`);
  }

  function cancelEditing() {
    setEditingId(null);
    setDraftKey('');
    setStatus('Ready');
  }

  async function saveShortcut(shortcutId: string) {
    if (!draftKey.trim() || hasDraftConflict(shortcuts, shortcutId, draftKey)) {
      setStatus('Conflict');
      return;
    }

    const nextShortcuts = shortcuts.map((shortcut) => (shortcut.id === shortcutId ? { ...shortcut, key: draftKey.trim() } : shortcut));

    setShortcuts(nextShortcuts);
    setEditingId(null);
    setDraftKey('');
    await persistShortcuts(enabled, nextShortcuts, 'Saved');
  }

  async function resetShortcuts() {
    setShortcuts(defaultShortcuts);
    setEditingId(null);
    setDraftKey('');
    setQuery('');
    await persistShortcuts(enabled, defaultShortcuts, 'Reset');
  }

  async function toggleEnabled() {
    const nextEnabled = !enabled;

    setEnabled(nextEnabled);
    await persistShortcuts(nextEnabled, shortcuts, nextEnabled ? 'Enabled' : 'Disabled');
  }

  async function persistShortcuts(nextEnabled: boolean, nextShortcuts: ShortcutDefinition[], successStatus: string) {
    setStatus('Saving');

    try {
      const updatedPreferences = await patchJson<UserPreferences>('/api/preferences', {
        keyboardShortcuts: {
          enabled: nextEnabled,
          shortcuts: nextShortcuts,
          updatedAt: new Date().toISOString(),
        },
      });
      const persistedSettings = normalizeShortcutSettings(updatedPreferences.keyboardShortcuts);

      setEnabled(persistedSettings.enabled);
      setShortcuts(persistedSettings.shortcuts);
      setStatus(successStatus);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section className="keyboard-shortcuts-settings-page" aria-label="Keyboard shortcuts settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Keyboard Shortcuts</h1>
        </div>
        <div className="workspace-header__right">
          <Toggle checked={enabled} label="Enable shortcuts" onClick={() => void toggleEnabled()} />
          <Button icon={<RotateCcw size={15} />} onClick={() => void resetShortcuts()} size="sm" variant="ghost">
            Reset Shortcuts
          </Button>
          <HelpPopover
            items={[
              'Shortcuts are persisted in the Thoon local data store.',
              'Live orders and live bots always keep confirmation.',
              'Resolve conflicts before saving a shortcut.',
            ]}
            title="Shortcuts"
          />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="keyboard-shortcuts" />

        <div className="keyboard-shortcuts-workspace">
          <Card className="shortcut-summary-card">
            <ShortcutMetric label="Status" value={enabled ? 'On' : 'Off'} />
            <ShortcutMetric label="Shortcuts" value={String(shortcuts.length)} />
            <ShortcutMetric label="Trading" value={String(tradingShortcutCount)} />
            <ShortcutMetric label="Conflicts" tone={hasConflict ? 'negative' : 'positive'} value={String(conflicts.size)} />
          </Card>

          <div className="shortcut-layout">
            <Card className="shortcut-categories-card">
              <div className="shortcut-card-head">
                <h2>Categories</h2>
                <Badge tone="neutral">{categoryOrder.length}</Badge>
              </div>
              <div className="shortcut-category-list" role="tablist" aria-label="Shortcut categories">
                {categoryOrder.map((category) => {
                  const categoryCount = shortcuts.filter((shortcut) => shortcut.category === category).length;

                  return (
                    <button
                      aria-selected={activeCategory === category}
                      className={activeCategory === category ? 'is-active' : undefined}
                      key={category}
                      onClick={() => setActiveCategory(category)}
                      role="tab"
                      type="button"
                    >
                      <span>{category}</span>
                      <Badge tone={categoryHasConflict(shortcuts, category, conflicts) ? 'negative' : 'neutral'}>{categoryCount}</Badge>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card className="shortcut-table-card">
              <div className="shortcut-table-head">
                <div>
                  <h2>{activeCategory}</h2>
                  <span>{status}</span>
                </div>
                <label className="shortcut-search-field">
                  <Search size={15} />
                  <input aria-label="Search shortcuts" onChange={(event) => setQuery(event.target.value)} placeholder="Search" value={query} />
                </label>
              </div>

              <div className="shortcut-table" aria-label={`${activeCategory} shortcuts`}>
                <div className="shortcut-row shortcut-row--head">
                  <span>Action</span>
                  <span>Shortcut</span>
                  <span>Scope</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>

                {visibleShortcuts.map((shortcut) => {
                  const isEditing = editingId === shortcut.id;
                  const rowHasConflict = conflicts.has(normalizeShortcut(shortcut.key));
                  const isDraftInvalid = isEditing && (!draftKey.trim() || draftConflict);

                  return (
                    <div className={cn('shortcut-row', rowHasConflict && 'has-conflict')} key={shortcut.id}>
                      <div className="shortcut-action-cell">
                        <Keyboard size={16} />
                        <strong>{shortcut.action}</strong>
                      </div>
                      <div>
                        {isEditing ? (
                          <input
                            aria-label={`Shortcut for ${shortcut.action}`}
                            className="shortcut-edit-field"
                            onChange={(event) => setDraftKey(event.target.value)}
                            value={draftKey}
                          />
                        ) : (
                          <kbd className="shortcut-key">{shortcut.key}</kbd>
                        )}
                      </div>
                      <span>{shortcut.scope}</span>
                      <div className="shortcut-status-cell">
                        {isEditing && draftConflict ? <Badge tone="negative">Conflict</Badge> : null}
                        {!isEditing && rowHasConflict ? <Badge tone="negative">Conflict</Badge> : null}
                        {shortcut.safety === 'confirm' ? <Badge tone="warning">Confirm</Badge> : null}
                        {!rowHasConflict && shortcut.safety !== 'confirm' ? <Badge tone="positive">Ready</Badge> : null}
                      </div>
                      <div className="shortcut-actions-cell">
                        {isEditing ? (
                          <>
                            <button aria-label={`Save ${shortcut.action}`} disabled={isDraftInvalid} onClick={() => void saveShortcut(shortcut.id)} title="Save" type="button">
                              <Save size={14} />
                            </button>
                            <button aria-label={`Cancel ${shortcut.action}`} onClick={cancelEditing} title="Cancel" type="button">
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <button aria-label={`Edit ${shortcut.action}`} onClick={() => startEditing(shortcut)} title="Edit" type="button">
                            <Edit3 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={cn('shortcut-conflict-card', hasConflict || draftConflict ? 'has-conflict' : undefined)}>
                {hasConflict || draftConflict ? <AlertTriangle size={16} /> : <Check size={16} />}
                <div>
                  <strong>{hasConflict || draftConflict ? 'Conflict detected' : 'No conflicts'}</strong>
                  <span>{hasConflict || draftConflict ? 'Choose a unique shortcut before saving.' : 'All active shortcuts are unique.'}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}

function ShortcutMetric({ label, tone, value }: { label: string; tone?: 'negative' | 'positive'; value: string }) {
  return (
    <div className={cn('shortcut-metric', tone && `is-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function categoryHasConflict(shortcuts: ShortcutDefinition[], category: ShortcutCategory, conflicts: Map<string, string[]>) {
  return shortcuts.some((shortcut) => shortcut.category === category && conflicts.has(normalizeShortcut(shortcut.key)));
}

function findConflicts(shortcuts: ShortcutDefinition[]) {
  const keyOwners = new Map<string, string[]>();

  shortcuts.forEach((shortcut) => {
    const normalizedKey = normalizeShortcut(shortcut.key);

    if (!normalizedKey) {
      return;
    }

    keyOwners.set(normalizedKey, [...(keyOwners.get(normalizedKey) ?? []), shortcut.id]);
  });

  return new Map([...keyOwners.entries()].filter(([, owners]) => owners.length > 1));
}

function hasDraftConflict(shortcuts: ShortcutDefinition[], shortcutId: string, draft: string) {
  const normalizedDraft = normalizeShortcut(draft);

  if (!normalizedDraft) {
    return false;
  }

  return shortcuts.some((shortcut) => shortcut.id !== shortcutId && normalizeShortcut(shortcut.key) === normalizedDraft);
}

function normalizeShortcut(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace('command', 'cmd');
}
