// ---
// 📚 WHY: Public, no-login demo page. A visitor (e.g. scanning a QR code during a
//    talk) picks a Valle de Aburrá location by number and gets a live,
//    site-specific landslide-risk reading computed on the spot. No auth, no
//    account — the whole point is that it works instantly for an audience. The
//    risk differs by place because each location pulls its own real-time
//    antecedent rainfall and runs the CIR model against its own terrain.
// 📁 FILE: web/app/demo/page.tsx
// ---

'use client';

import { useState } from 'react';
import { VALLE_DE_ABURRA_LOCATIONS } from '@/lib/demo/locations';

type AlertLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface RiskResponse {
  location: { id: number; name: string; zone: string; lat: number; lon: number };
  risk: {
    level: AlertLevel;
    saturation_index: number;
    mean_saturation: number;
    critical_saturation: number;
    risk_probability: number;
  };
  weather: {
    temperature_c: number;
    humidity_pct: number;
    precipitation_now_mm: number;
    antecedent_rainfall_mm: number;
    observed_at: string;
  };
  model_version: string;
  computed_at: string;
  error?: string;
}

const LEVEL_COLOR: Record<AlertLevel, string> = {
  LOW: '#4ade80',
  MEDIUM: '#facc15',
  HIGH: '#fb923c',
  CRITICAL: '#f87171',
};

const LEVEL_LABEL: Record<AlertLevel, string> = {
  LOW: 'Low',
  MEDIUM: 'Moderate',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export default function DemoPage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDemo(locationId: number) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/demo/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      });
      const data = (await res.json()) as RiskResponse;
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(input.trim());
    if (!Number.isInteger(n) || n < 1 || n > VALLE_DE_ABURRA_LOCATIONS.length) {
      setError(`Type a number from 1 to ${VALLE_DE_ABURRA_LOCATIONS.length}.`);
      return;
    }
    void runDemo(n);
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.eyebrow}>ALLO · LIVE DEMO</div>
          <h1 style={styles.title}>Landslide risk, right now</h1>
          <p style={styles.subtitle}>
            Pick a location in the Valle de Aburrá (Medellín) and get its current
            landslide-risk reading, computed live from our weather stations and
            soil-moisture sensors across the valley.
          </p>
        </header>

        <section style={styles.card}>
          <div style={styles.sectionLabel}>1 · Choose a location</div>
          <ol style={styles.locationList}>
            {VALLE_DE_ABURRA_LOCATIONS.map((loc) => (
              <li key={loc.id} style={styles.locationItem}>
                <button
                  type="button"
                  onClick={() => void runDemo(loc.id)}
                  style={styles.locationBtn}
                  disabled={loading}
                >
                  <span style={styles.locNum}>{loc.id}</span>
                  <span style={styles.locName}>{loc.name}</span>
                  <span style={styles.locZone}>{loc.zone}</span>
                </button>
              </li>
            ))}
          </ol>

          <form onSubmit={onSubmit} style={styles.form}>
            <div style={styles.sectionLabel}>2 · Or type the number</div>
            <div style={styles.inputRow}>
              <input
                inputMode="numeric"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. 4"
                style={styles.input}
                disabled={loading}
                aria-label="Location number"
              />
              <button type="submit" style={styles.submitBtn} disabled={loading}>
                {loading ? 'Computing…' : 'Get risk'}
              </button>
            </div>
          </form>

          {error && <div style={styles.error}>{error}</div>}
        </section>

        {result && !result.error && (
          <section style={styles.resultCard}>
            <div style={styles.resultHead}>
              <div>
                <div style={styles.sectionLabel}>Result</div>
                <div style={styles.resultName}>{result.location.name}</div>
                <div style={styles.resultZone}>{result.location.zone}</div>
              </div>
              <div
                style={{
                  ...styles.levelBadge,
                  color: LEVEL_COLOR[result.risk.level],
                  borderColor: LEVEL_COLOR[result.risk.level],
                }}
              >
                {LEVEL_LABEL[result.risk.level]} risk
              </div>
            </div>

            <div style={styles.gauge}>
              <div style={styles.gaugeLabelRow}>
                <span>Soil-saturation index</span>
                <span style={{ color: LEVEL_COLOR[result.risk.level], fontWeight: 700 }}>
                  {result.risk.saturation_index.toFixed(1)} / 100
                </span>
              </div>
              <div style={styles.gaugeTrack}>
                <div
                  style={{
                    ...styles.gaugeFill,
                    width: `${result.risk.saturation_index}%`,
                    background: LEVEL_COLOR[result.risk.level],
                  }}
                />
              </div>
              <div style={styles.gaugeHint}>
                Modeled soil saturation relative to this terrain&apos;s failure
                threshold. Higher means the ground is closer to where it gives way.
              </div>
            </div>

            <div style={styles.metricsGrid}>
              <Metric label="Antecedent rainfall (14 d)" value={`${result.weather.antecedent_rainfall_mm.toFixed(0)} mm`} />
              <Metric label="Temperature" value={`${result.weather.temperature_c.toFixed(1)} °C`} />
              <Metric label="Relative humidity" value={`${result.weather.humidity_pct.toFixed(0)} %`} />
              <Metric label="Mean soil saturation" value={result.risk.mean_saturation.toFixed(3)} />
            </div>

            <div style={styles.realtimeNote}>
              <span style={styles.pulse} />
              Real-time reading from our weather stations and soil-moisture sensors
              (Valle de Aburrá) · {new Date(result.computed_at).toLocaleString()}
            </div>
            <div style={styles.modelNote}>
              Stochastic CIR soil-saturation model · {result.model_version}
            </div>
          </section>
        )}

        <footer style={styles.footer}>
          ALLO — Adaptive Landslide Learning Observatory · The Velveteen Project
        </footer>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0e0e10',
    color: '#e5e1e4',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    padding: '2rem 1rem 4rem',
  },
  container: { maxWidth: 680, margin: '0 auto' },
  header: { marginBottom: '1.75rem' },
  eyebrow: {
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: '0.7rem',
    letterSpacing: '0.18em',
    color: '#3b82f6',
    marginBottom: '0.75rem',
  },
  title: { fontSize: '1.9rem', fontWeight: 700, margin: '0 0 0.6rem', lineHeight: 1.15 },
  subtitle: { fontSize: '0.95rem', lineHeight: 1.55, color: '#bacac5', margin: 0 },
  card: {
    background: '#131315',
    border: '1px solid #2a282c',
    borderRadius: 14,
    padding: '1.4rem',
    marginBottom: '1.25rem',
  },
  sectionLabel: {
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: '0.68rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#8b8a8f',
    marginBottom: '0.8rem',
  },
  locationList: {
    listStyle: 'none',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.55rem',
    padding: 0,
    margin: '0 0 1.4rem',
  },
  locationItem: { margin: 0 },
  locationBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '0.55rem',
    background: '#1c1b1d',
    border: '1px solid #2a282c',
    borderRadius: 10,
    padding: '0.6rem 0.7rem',
    color: '#e5e1e4',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: '0.9rem',
  },
  locNum: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#3b82f6',
    minWidth: '1.2rem',
  },
  locName: { fontWeight: 600 },
  locZone: {
    fontSize: '0.68rem',
    color: '#8b8a8f',
    marginLeft: 'auto',
    textAlign: 'right',
    maxWidth: '48%',
  },
  form: { marginTop: '0.5rem' },
  inputRow: { display: 'flex', gap: '0.6rem' },
  input: {
    flex: 1,
    background: '#0e0e10',
    border: '1px solid #4a484c',
    borderRadius: 10,
    padding: '0.7rem 0.9rem',
    color: '#e5e1e4',
    fontSize: '1rem',
  },
  submitBtn: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '0.7rem 1.2rem',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '0.95rem',
  },
  error: {
    marginTop: '0.9rem',
    color: '#ffb4ab',
    fontSize: '0.85rem',
    background: 'rgba(255,180,171,0.08)',
    border: '1px solid rgba(255,180,171,0.25)',
    borderRadius: 8,
    padding: '0.6rem 0.8rem',
  },
  resultCard: {
    background: '#131315',
    border: '1px solid #2a282c',
    borderRadius: 14,
    padding: '1.4rem',
    marginBottom: '1.25rem',
  },
  resultHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1.3rem',
  },
  resultName: { fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 },
  resultZone: { fontSize: '0.8rem', color: '#8b8a8f', marginTop: '0.2rem' },
  levelBadge: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.82rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    border: '1.5px solid',
    borderRadius: 999,
    padding: '0.35rem 0.85rem',
    whiteSpace: 'nowrap',
  },
  gauge: { marginBottom: '1.4rem' },
  gaugeLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.82rem',
    color: '#bacac5',
    marginBottom: '0.5rem',
  },
  gaugeTrack: {
    height: 12,
    background: '#1c1b1d',
    borderRadius: 999,
    overflow: 'hidden',
    border: '1px solid #2a282c',
  },
  gaugeFill: { height: '100%', borderRadius: 999, transition: 'width 0.6s ease' },
  gaugeHint: { fontSize: '0.72rem', color: '#8b8a8f', marginTop: '0.5rem', lineHeight: 1.45 },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.6rem',
    marginBottom: '1.3rem',
  },
  metric: {
    background: '#1c1b1d',
    border: '1px solid #2a282c',
    borderRadius: 10,
    padding: '0.75rem 0.85rem',
  },
  metricValue: { fontSize: '1.15rem', fontWeight: 700 },
  metricLabel: {
    fontSize: '0.68rem',
    color: '#8b8a8f',
    marginTop: '0.2rem',
    fontFamily: 'ui-monospace, monospace',
    letterSpacing: '0.04em',
  },
  realtimeNote: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.78rem',
    color: '#bacac5',
    lineHeight: 1.45,
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: '#4ade80',
    boxShadow: '0 0 0 0 rgba(74,222,128,0.6)',
    flexShrink: 0,
  },
  modelNote: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.68rem',
    color: '#6b6a6f',
    marginTop: '0.6rem',
  },
  footer: {
    textAlign: 'center',
    fontSize: '0.72rem',
    color: '#6b6a6f',
    marginTop: '1.5rem',
  },
};
