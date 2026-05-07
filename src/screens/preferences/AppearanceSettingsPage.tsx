'use client';

import { Check, ChevronDown, Eye, Monitor, Moon, Save, SlidersHorizontal, Sun } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Button, Card, HelpPopover, ThemeToggle } from '../../components/ui';
import { patchJson } from '../../services/api-client';
import { useTheme, type ThemePreference } from '../../stores/theme-store';

export function AppearanceSettingsPage() {
  const { setTheme, theme } = useTheme();
  const [accent, setAccent] = useState('blue');
  const [chartPreset, setChartPreset] = useState('terminal');
  const [density, setDensity] = useState<'compact' | 'comfortable' | 'spacious'>('comfortable');
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [sidebarBehavior, setSidebarBehavior] = useState<'Expanded' | 'Auto' | 'Collapsed'>('Expanded');
  const [animations, setAnimations] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Ready');

  async function saveAppearance() {
    setSaveStatus('Saving');

    try {
      await patchJson('/api/preferences', { accent, animations, chartPreset, density, fontSize, reduceMotion, sidebarBehavior, theme });
      setSaveStatus('Saved');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  return (
    <section className="appearance-settings-page" aria-label="Appearance settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Appearance</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={saveAppearance} size="sm" variant="primary">
            Save changes
          </Button>
          <HelpPopover items={['Theme changes apply immediately.', 'Keep compact density for trading views.']} title="Appearance" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="appearance" />

        <div className="appearance-layout">
          <div className="appearance-main-panel">
            <div className="appearance-main-panel__head">
              <div>
                <h2>Appearance</h2>
                <p>Terminal look, chart colors and workspace density.</p>
                <small>{saveStatus}</small>
              </div>
              <ThemeToggle />
            </div>

            <Card className="appearance-setting-block">
              <div className="appearance-setting-block__title">
                <span>Theme</span>
              </div>
              <div className="segmented-options segmented-options--icons">
                <ThemeOption activeTheme={theme} icon={<Sun size={17} />} label="Light" onSelect={setTheme} value="light" />
                <ThemeOption activeTheme={theme} icon={<Moon size={17} />} label="Dark" onSelect={setTheme} value="dark" />
                <ThemeOption activeTheme={theme} icon={<Monitor size={17} />} label="System" onSelect={setTheme} value="system" />
              </div>
            </Card>

            <Card className="appearance-setting-block">
              <div className="appearance-setting-block__title">
                <span>Accent color</span>
              </div>
              <div className="color-swatches color-swatches--wide">
                {['blue', 'violet', 'cyan', 'green', 'yellow', 'red', 'pink'].map((color) => (
                  <button className={`${accent === color ? 'is-active ' : ''}swatch-${color}`} aria-label={`${titleCase(color)} accent`} key={color} onClick={() => setAccent(color)} type="button">
                    {accent === color ? <Check size={16} /> : null}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="appearance-setting-block">
              <div className="appearance-setting-block__title">
                <span>Chart color preset</span>
              </div>
              <div className="chart-preset-row">
                {['terminal', 'classic', 'soft', 'contrast', 'pro'].map((preset) => (
                  <button className={chartPreset === preset ? 'is-active' : undefined} aria-label={`${titleCase(preset)} chart preset`} key={preset} onClick={() => setChartPreset(preset)} type="button">
                    <i className={`preset-bars preset-bars--${preset}`} />
                  </button>
                ))}
              </div>
            </Card>

            <Card className="appearance-setting-block">
              <div className="appearance-setting-block__title">
                <span>Density</span>
              </div>
              <div className="segmented-options">
                <button className={density === 'compact' ? 'is-active' : undefined} onClick={() => setDensity('compact')} type="button">Compact</button>
                <button className={density === 'comfortable' ? 'is-active' : undefined} onClick={() => setDensity('comfortable')} type="button">
                  Comfortable
                </button>
                <button className={density === 'spacious' ? 'is-active' : undefined} onClick={() => setDensity('spacious')} type="button">Spacious</button>
              </div>
            </Card>

            <Card className="appearance-setting-block">
              <div className="appearance-setting-block__title">
                <span>Font size</span>
              </div>
              <div className="segmented-options">
                <button className={fontSize === 'small' ? 'is-active' : undefined} onClick={() => setFontSize('small')} type="button">
                  <b>Aa</b> Small
                </button>
                <button className={fontSize === 'medium' ? 'is-active' : undefined} onClick={() => setFontSize('medium')} type="button">
                  <b>Aa</b> Medium
                </button>
                <button className={fontSize === 'large' ? 'is-active' : undefined} onClick={() => setFontSize('large')} type="button">
                  <b>Aa</b> Large
                </button>
              </div>
            </Card>

            <Card className="appearance-setting-row">
              <span>Sidebar behavior</span>
              <button
                className="select-like-button"
                onClick={() => setSidebarBehavior((current) => (current === 'Expanded' ? 'Auto' : current === 'Auto' ? 'Collapsed' : 'Expanded'))}
                type="button"
              >
                <SlidersHorizontal size={16} />
                {sidebarBehavior}
                <ChevronDown size={15} />
              </button>
            </Card>

            <Card className="appearance-setting-row appearance-setting-row--slider">
              <span>Card radius</span>
              <div className="radius-control" aria-label="Card radius">
                <i />
                <b />
                <small>4px</small>
                <small>8px</small>
                <small className="is-active">12px</small>
                <small>16px</small>
                <small>24px</small>
              </div>
            </Card>

            <Card className="appearance-toggle-row">
              <div>
                <span>Enable animations</span>
                <small>Smooth transitions throughout the app</small>
              </div>
              <button aria-label="Enable animations" className={`switch ${animations ? 'is-on' : ''}`} onClick={() => setAnimations((current) => !current)} type="button" />
            </Card>

            <Card className="appearance-toggle-row">
              <div>
                <span>Reduce motion</span>
                <small>Minimize animations for accessibility</small>
              </div>
              <button aria-label="Reduce motion" className={`switch ${reduceMotion ? 'is-on' : ''}`} onClick={() => setReduceMotion((current) => !current)} type="button" />
            </Card>
          </div>

          <Card className="appearance-preview-card">
            <div className="settings-card__header">
              <h2>Preview</h2>
              <Eye size={18} />
            </div>
            <div className="appearance-preview">
              <div className="appearance-preview__frame appearance-preview__frame--light">
                <div className="preview-toolbar">
                  <span>Light mode</span>
                  <i />
                  <i />
                  <i />
                </div>
                <div className="preview-terminal">
                  <div className="preview-rail">
                    <b />
                    <b />
                    <b />
                    <b />
                    <b />
                  </div>
                  <div className="preview-chart">
                    <div>
                      <strong>BTC/USDT</strong>
                      <em>67,347.6</em>
                      <small>+0.19%</small>
                    </div>
                    <i />
                    <span />
                  </div>
                  <div className="preview-panel">
                    <b />
                    <b />
                    <b />
                    <b />
                    <b />
                  </div>
                </div>
              </div>

              <div className="appearance-preview__frame appearance-preview__frame--dark">
                <div className="preview-toolbar">
                  <span>Dark mode</span>
                  <i />
                  <i />
                  <i />
                </div>
                <div className="preview-terminal">
                  <div className="preview-rail">
                    <b />
                    <b />
                    <b />
                    <b />
                    <b />
                  </div>
                  <div className="preview-chart">
                    <div>
                      <strong>BTC/USDT</strong>
                      <em>67,347.6</em>
                      <small>+0.19%</small>
                    </div>
                    <i />
                    <span />
                  </div>
                  <div className="preview-panel">
                    <b />
                    <b />
                    <b />
                    <b />
                    <b />
                  </div>
                </div>
              </div>
            </div>
            <p>Applied automatically</p>
          </Card>
        </div>
      </div>
    </section>
  );
}

function ThemeOption({
  activeTheme,
  icon,
  label,
  onSelect,
  value,
}: {
  activeTheme: ThemePreference;
  icon: ReactNode;
  label: string;
  onSelect: (theme: ThemePreference) => void;
  value: ThemePreference;
}) {
  return (
    <button aria-pressed={activeTheme === value} className={activeTheme === value ? 'is-active' : undefined} onClick={() => onSelect(value)} type="button">
      {icon}
      {label}
    </button>
  );
}

function titleCase(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
