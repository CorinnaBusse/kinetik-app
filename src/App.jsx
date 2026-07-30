import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Tooltip,
} from "recharts";

/* ---------------------------------------------------------------------
   TOKENS — "die Ohm" Corporate Design
--------------------------------------------------------------------- */
const OHM_RED = "#C72426";
const OHM_BLUE = "#16283D";
const INK = OHM_BLUE;
const BG = "#F4F4F3";
const PANEL = "#FFFFFF";
const PANEL_BORDER = "#E0DEDC";
const GRAY = "#6B6B6B";
const CHART_BG = "#FFFFFF";
const CHART_GRID = "#E5E3E1";
const CHANNEL_COLORS = ["#16283D", "#C72426", "#5C8A9E", "#B08B2E"];
const COLORLESS = "#F1EEE4";
const YELLOW = "#F4C430";
const SANS = "'Inter', 'IBM Plex Sans', ui-sans-serif, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const R_GAS = 8.314;
const T0 = 298.15;

const SUPERSCRIPT = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (n) => String(n).split("").map((c) => SUPERSCRIPT[c] ?? c).join("");

function fmtTime(s) {
  if (!isFinite(s)) return "—";
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(2)} min`;
  return `${(s / 3600).toFixed(2)} h`;
}
function fmtK(k) {
  if (!isFinite(k) || k <= 0) return "—";
  const exp = Math.floor(Math.log10(k));
  const mant = k / Math.pow(10, exp);
  return `${mant.toFixed(2)} × 10${sup(exp)} s⁻¹`;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGaussian(rng) {
  return function () {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
function computeK(tempC, kRef, Ea) {
  const A = kRef / Math.exp(-(Ea * 1000) / (R_GAS * T0));
  const Tk = tempC + 273.15;
  return A * Math.exp(-(Ea * 1000) / (R_GAS * Tk));
}
function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return { r: parseInt(m.substring(0, 2), 16), g: parseInt(m.substring(2, 4), 16), b: parseInt(m.substring(4, 6), 16) };
}
function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function interpAt(hist, t) {
  if (!hist || !hist.length) return null;
  if (t <= hist[0].t) return hist[0].c;
  if (t >= hist[hist.length - 1].t) return hist[hist.length - 1].c;
  for (let i = 1; i < hist.length; i++) {
    if (hist[i].t >= t) {
      const t0 = hist[i - 1].t, t1 = hist[i].t, c0 = hist[i - 1].c, c1 = hist[i].c;
      const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return c0 + (c1 - c0) * frac;
    }
  }
  return hist[hist.length - 1].c;
}
const logToPos = (val, min, max) => (100 * Math.log(val / min)) / Math.log(max / min);
const posToLog = (pos, min, max) => min * Math.pow(max / min, pos / 100);

/* ---------------------------------------------------------------------
   CONTROL WIDGETS
--------------------------------------------------------------------- */
function Field({ label, value, locked, children }) {
  return (
    <div className="mb-3" style={{ opacity: locked ? 0.5 : 1 }}>
      <div className="flex items-baseline justify-between mb-1">
        <span style={{ fontFamily: SANS, fontSize: 11, letterSpacing: "0.02em", color: GRAY, fontWeight: 500 }}>
          {label}{locked ? " 🔒" : ""}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: INK, fontWeight: 700 }}>{value}</span>
      </div>
      {children}
    </div>
  );
}
function LinearSlider({ min, max, step, value, onChange, disabled }) {
  return <input className="ohm-slider" type="range" min={min} max={max} step={step} value={value} disabled={disabled}
    onChange={(e) => onChange(parseFloat(e.target.value))} />;
}
function LogSlider({ min, max, value, onChange, disabled }) {
  const pos = logToPos(value, min, max);
  return <input className="ohm-slider" type="range" min={0} max={100} step={0.1} value={pos} disabled={disabled}
    onChange={(e) => onChange(posToLog(parseFloat(e.target.value), min, max))} />;
}
function PanelBox({ title, children }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.03em", color: INK, textTransform: "uppercase", marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${OHM_RED}` }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------
   VIAL / KÜVETTE
--------------------------------------------------------------------- */
function Vial({ id, color, tempC, status, stirPhase, running, unstable }) {
  const PIPE = "#B9B7B4";
  const ringColor = status === "active" ? OHM_RED : "transparent";
  const label = status === "active" ? "AKTIV" : status === "done" ? "FERTIG" : "WARTET";
  const labelColor = status === "active" ? OHM_RED : status === "done" ? "#2E9E4F" : GRAY;
  return (
    <div className="flex flex-col items-center gap-1" style={{ flex: 1, minWidth: 70, opacity: status === "wartet" ? 0.6 : 1 }}>
      <svg viewBox="0 0 60 148" style={{ width: "100%", maxWidth: 74, height: 136 }}>
        <defs>
          <clipPath id={`vialClip-${id}`}>
            <path d="M14,8 h32 v70 a18,18 0 0 1 -32,0 z" />
          </clipPath>
        </defs>
        {ringColor !== "transparent" && (
          <rect x="4" y="1" width="52" height="94" rx="10" fill="none" stroke={ringColor} strokeWidth={2} />
        )}
        <path d="M14,8 h32 v70 a18,18 0 0 1 -32,0 z" fill="#FAFAF9" stroke={PIPE} strokeWidth={2.5} />
        <g clipPath={`url(#vialClip-${id})`}>
          <rect x="10" y="45" width="40" height="60" fill={color} />
          <ellipse cx="30" cy={68} rx="9" ry="3.2" fill="rgba(0,0,0,0.12)"
            transform={`rotate(${status === "active" && running ? stirPhase : 0} 30 68)`} />
        </g>
        <rect x="14" y="4" width="32" height="8" rx="2" fill={PIPE} />
        {unstable && <text x="30" y="112" textAnchor="middle" fontFamily={SANS} fontSize="10" fill={OHM_RED}>⚠</text>}
      </svg>
      <div style={{ fontFamily: MONO, fontSize: 11, color: INK, fontWeight: 700 }}>{tempC} °C</div>
      <div style={{ fontFamily: SANS, fontSize: 9, color: labelColor, fontWeight: 700, letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------------- */
export default function KinetikAbsorbanceSequential() {
  const nextId = useRef(4);
  const [channels, setChannels] = useState([
    { id: 1, tempC: 25, color: CHANNEL_COLORS[0] },
    { id: 2, tempC: 50, color: CHANNEL_COLORS[1] },
    { id: 3, tempC: 75, color: CHANNEL_COLORS[2] },
  ]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [A0, setA0] = useState(1.0);
  const [kRef, setKRef] = useState(0.01);
  const [Ea, setEa] = useState(60);
  const [epsilon, setEpsilon] = useState(1.0);
  const [noisePct, setNoisePct] = useState(3);
  const [sampleInterval, setSampleInterval] = useState(5);
  const [speed, setSpeed] = useState(1);
  const [eulerRatio, setEulerRatio] = useState(0.1);
  const [running, setRunning] = useState(false);
  const [locked, setLocked] = useState(false); // Ea / k0 gesperrt, sobald der erste Ansatz gestartet wurde
  const [, setTick] = useState(0);

  const paramsRef = useRef({});
  paramsRef.current = { channels, activeIndex, A0, kRef, Ea, epsilon, noisePct, sampleInterval, speed, eulerRatio };

  const elapsedRef = useRef({});
  const concRef = useRef({});
  const histRef = useRef({});
  const noisyRef = useRef({});
  const lastSampleRef = useRef({});
  const doneRef = useRef({});
  const windowWidthRef = useRef(60);
  const gaussRef = useRef(makeGaussian(mulberry32(Date.now() % 1e6)));
  const unstableRef = useRef({});
  const A0StartRef = useRef(1.0);
  const stirPhaseRef = useRef(0);

  const initChannelState = (id, A0v) => {
    elapsedRef.current[id] = 0;
    concRef.current[id] = A0v;
    histRef.current[id] = [{ t: 0, c: A0v }];
    noisyRef.current[id] = [];
    lastSampleRef.current[id] = 0;
    doneRef.current[id] = false;
  };

  const initRun = useCallback(() => {
    const p = paramsRef.current;
    A0StartRef.current = p.A0;
    p.channels.forEach((c) => initChannelState(c.id, p.A0));
    const maxT12 = Math.max(...p.channels.map((c) => Math.LN2 / computeK(c.tempC, p.kRef, p.Ea)));
    windowWidthRef.current = Math.max(30, maxT12 * 8);
    gaussRef.current = makeGaussian(mulberry32(Date.now() % 1e6));
    unstableRef.current = {};
    stirPhaseRef.current = 0;
    setActiveIndex(0);
    setTick((t) => t + 1);
  }, []);

  useEffect(() => { initRun(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!running) return;
    let raf, last = performance.now(), frame = 0;
    const step = (now) => {
      const dtReal = Math.min(now - last, 100) / 1000;
      last = now;
      const p = paramsRef.current;
      const ch = p.channels[p.activeIndex];
      if (!ch) return;
      const dtSim = dtReal * p.speed;
      const A0s = A0StartRef.current;

      elapsedRef.current[ch.id] = (elapsedRef.current[ch.id] || 0) + dtSim;
      const t = elapsedRef.current[ch.id];

      const k = computeK(ch.tempC, p.kRef, p.Ea);
      const t12 = Math.LN2 / k;
      const subDt = p.eulerRatio / k;
      const steps = Math.min(2000, Math.max(1, Math.round(dtSim / subDt)));
      const actualSubDt = dtSim / steps;
      let c = concRef.current[ch.id] ?? A0s;
      for (let i = 0; i < steps; i++) c = c - k * c * actualSubDt;
      c = Math.max(-2 * A0s, Math.min(A0s * 1.05, c));
      concRef.current[ch.id] = c;
      unstableRef.current[ch.id] = k * subDt > 2;

      const arr = histRef.current[ch.id] || (histRef.current[ch.id] = []);
      arr.push({ t, c });

      const lastS = lastSampleRef.current[ch.id] ?? 0;
      if (t - lastS >= p.sampleInterval) {
        const trueAbs = p.epsilon * (A0s - c);
        const noiseAbs = (p.noisePct / 100) * p.epsilon * A0s;
        const val = Math.max(0, trueAbs + noiseAbs * gaussRef.current());
        const narr = noisyRef.current[ch.id] || (noisyRef.current[ch.id] = []);
        narr.push({ t, value: val });
        lastSampleRef.current[ch.id] = t;
      }

      windowWidthRef.current = Math.max(windowWidthRef.current, t12 * 8);
      stirPhaseRef.current += dtReal * 70;
      frame++;
      if (frame % 3 === 0) setTick((x) => x + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const handlePlayPause = () => {
    if (!running) setLocked(true);
    setRunning((r) => !r);
  };
  const handleReset = () => { setRunning(false); setLocked(false); initRun(); };
  const handleNext = () => {
    setRunning(false);
    const cur = channels[activeIndex];
    if (cur) doneRef.current[cur.id] = true;
    const nextIdx = activeIndex + 1;
    if (nextIdx < channels.length) {
      initChannelState(channels[nextIdx].id, A0StartRef.current);
      setActiveIndex(nextIdx);
    }
    setTick((t) => t + 1);
  };
  const handleAutoSpeed = () => {
    const ch = channels[activeIndex];
    const t12 = ch ? Math.LN2 / computeK(ch.tempC, kRef, Ea) : 60;
    setSpeed(Math.max(1, Math.round((t12 * 8) / 25)));
  };
  const addChannel = () => {
    if (channels.length >= 4) return;
    const id = nextId.current++;
    const used = channels.map((c) => c.color);
    const color = CHANNEL_COLORS.find((c) => !used.includes(c)) || CHANNEL_COLORS[0];
    setChannels((cs) => [...cs, { id, tempC: 40, color }]);
    initChannelState(id, A0StartRef.current);
    const t12 = Math.LN2 / computeK(40, kRef, Ea);
    windowWidthRef.current = Math.max(windowWidthRef.current, t12 * 8);
  };
  const removeChannel = (id) => {
    if (channels.length <= 1) return;
    const idx = channels.findIndex((c) => c.id === id);
    if (idx === activeIndex) return; // aktiven Ansatz nicht mitten im Lauf entfernen
    setChannels((cs) => cs.filter((c) => c.id !== id));
    if (idx < activeIndex) setActiveIndex((a) => a - 1);
    delete concRef.current[id]; delete histRef.current[id]; delete noisyRef.current[id];
    delete lastSampleRef.current[id]; delete elapsedRef.current[id]; delete doneRef.current[id];
  };
  const setChannelTemp = (id, tempC) => setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, tempC } : c)));

  const exportCSV = () => {
    const csvNum = (x) => (x === null || x === undefined || Number.isNaN(x) ? "" : x.toFixed(4).replace(".", ","));
    const A0v = A0StartRef.current;
    const rows = [];
    channels.forEach((ch) => {
      const hist = histRef.current[ch.id] || [];
      const noisy = noisyRef.current[ch.id] || [];
      noisy.forEach((pt) => {
        const modelC = interpAt(hist, pt.t);
        const modelAbs = modelC === null ? null : epsilon * (A0v - modelC);
        rows.push({ t: pt.t, tempC: ch.tempC, id: ch.id, measured: pt.value, model: modelAbs });
      });
    });
    rows.sort((a, b) => a.id - b.id || a.t - b.t);
    const meta = [
      `# Reaktion-Monitor Messexport (sequentiell)`,
      `# c0=${A0v} mol/L; k(25C)=${kRef} 1/s; Ea=${Ea} kJ/mol; epsilon=${epsilon}; Rauschen=${noisePct}%; Messintervall=${sampleInterval}s`,
      `# Zeitpunkt: ${new Date().toLocaleString("de-DE")}`,
    ];
    const header = ["Kanal_ID", "Temperatur_C", "Zeit_s", "Absorption_gemessen", "Absorption_Modell"];
    const lines = [...meta, header.join(";"), ...rows.map((r) => [r.id, r.tempC, csvNum(r.t), csvNum(r.measured), csvNum(r.model)].join(";"))];
    const csvContent = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kinetik_messdaten_sequentiell_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const ww = windowWidthRef.current;
  const xDomain = [0, ww];
  const A0s = A0StartRef.current;
  const yMax = Math.max(0.2, epsilon * A0s * 1.05);
  const activeCh = channels[activeIndex];
  const isLastChannel = activeIndex >= channels.length - 1;

  const displayData = {};
  channels.forEach((ch) => {
    displayData[ch.id] = (histRef.current[ch.id] || []).map((pt) => ({ t: pt.t, a: epsilon * (A0s - pt.c) }));
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, padding: "6px 10px", fontFamily: MONO, fontSize: 11, color: INK, boxShadow: "0 2px 6px rgba(0,0,0,0.12)" }}>
        <div style={{ opacity: 0.6, marginBottom: 4 }}>t = {fmtTime(label)}</div>
        {payload.filter((p) => p.dataKey === "a").map((p) => (
          <div key={p.name} style={{ color: p.color, fontWeight: 700 }}>{p.name}: A = {p.value?.toFixed(3)}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full min-h-screen flex justify-center p-3 md:p-6" style={{ background: BG }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        input.ohm-slider { -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:2px; background-color:#DEDCDA; cursor:pointer; }
        input.ohm-slider::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
          background: ${OHM_RED}; border:2px solid #fff; box-shadow:0 0 0 1px ${PANEL_BORDER}, 0 1px 3px rgba(0,0,0,.25); cursor:pointer; }
        input.ohm-slider::-moz-range-thumb { width:16px; height:16px; border-radius:50%; background: ${OHM_RED}; border:2px solid #fff; cursor:pointer; }
        input.ohm-slider::-moz-range-track { background:#DEDCDA; height:4px; border-radius:2px; }
        input.ohm-slider:disabled::-webkit-slider-thumb { background: #B9B7B4; }
        input.ohm-slider:disabled::-moz-range-thumb { background: #B9B7B4; }
        input.ohm-slider:disabled { cursor: not-allowed; }
        .led { animation: pulseGlow 1.1s ease-in-out infinite; }
        @keyframes pulseGlow { 0%,100%{opacity:1} 50%{opacity:.35} }
        @media (prefers-reduced-motion: reduce) { .led { animation: none; } }
        .ohm-btn:active { transform: translateY(1px); }
        .ohm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>

      <div className="w-full flex flex-col gap-4" style={{ maxWidth: 1360, fontFamily: SANS }}>
        {/* HEADER */}
        <div className="flex items-end justify-between flex-wrap gap-3 pb-3" style={{ borderBottom: `3px solid ${OHM_RED}` }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 13, color: "#fff", background: OHM_RED, padding: "2px 8px", borderRadius: 3, letterSpacing: "0.04em" }}>
                die Ohm
              </span>
              <h1 style={{ fontFamily: SANS, fontWeight: 800, fontSize: "clamp(24px,3.4vw,34px)", color: INK, letterSpacing: "-0.01em", lineHeight: 1 }}>
                REAKTION·MONITOR
              </h1>
            </div>
            <p style={{ fontFamily: SANS, fontSize: 12, color: GRAY, marginTop: 6 }}>
              Fakultät Angewandte Chemie · Ansätze laufen nacheinander · Temperatur des aktiven Ansatzes live änderbar
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="led" style={{ width: 10, height: 10, borderRadius: "50%",
              background: running ? "#2E9E4F" : OHM_RED, boxShadow: `0 0 6px ${running ? "#2E9E4F" : OHM_RED}` }} />
            <span style={{ fontFamily: SANS, fontSize: 12, color: INK, fontWeight: 600 }}>{running ? "Läuft" : "Angehalten"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT CONTROLS */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <PanelBox title="Reaktion & Kinetik">
              <Field label="Startkonz. c₀ (Substrat)" value={`${A0.toFixed(2)} mol/L`}>
                <LinearSlider min={0.1} max={2} step={0.05} value={A0} onChange={setA0} />
              </Field>
              <Field label="k bei 25 °C" value={fmtK(kRef)} locked={locked}>
                <LogSlider min={0.0001} max={0.1} value={kRef} onChange={setKRef} disabled={locked} />
              </Field>
              <Field label="Aktivierungsenergie Eₐ" value={`${Ea.toFixed(0)} kJ/mol`} locked={locked}>
                <LinearSlider min={20} max={150} step={1} value={Ea} onChange={setEa} disabled={locked} />
              </Field>
              <div style={{ fontFamily: SANS, fontSize: 11, color: GRAY }}>
                {locked
                  ? "k(25°C) und Eₐ sind für diese Versuchsreihe gesperrt — erst nach 'Neuer Messlauf' wieder änderbar."
                  : "k(25°C) und Eₐ nur vor dem ersten Start änderbar."}
              </div>
            </PanelBox>

            <PanelBox title="Absorption">
              <Field label="Extinktionskoeffizient ε (a.u.)" value={epsilon.toFixed(2)}>
                <LogSlider min={0.2} max={5} value={epsilon} onChange={setEpsilon} />
              </Field>
              <div style={{ fontFamily: SANS, fontSize: 11, color: GRAY }}>
                A(t) = ε · (c₀ − c(t)) — Beer-Lambert, Produktbildung.
              </div>
            </PanelBox>

            <PanelBox title="Messung">
              <Field label="Messrauschen (σ)" value={`± ${noisePct.toFixed(1)} %`}>
                <LinearSlider min={0} max={15} step={0.5} value={noisePct} onChange={setNoisePct} />
              </Field>
              <Field label="Messintervall" value={fmtTime(sampleInterval)}>
                <LogSlider min={0.2} max={200} value={sampleInterval} onChange={setSampleInterval} />
              </Field>
            </PanelBox>

            <PanelBox title="Zeitraffer &amp; Integration">
              <Field label="Beschleunigung" value={`× ${speed.toFixed(0)}`}>
                <LogSlider min={1} max={5000} value={speed} onChange={setSpeed} />
              </Field>
              <button onClick={handleAutoSpeed} className="ohm-btn w-full" style={{ fontFamily: SANS, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, padding: "6px 0", color: INK, marginBottom: 12 }}>
                Auto-Zeitraffer (aktiver Ansatz)
              </button>
              <Field label="Euler-Schrittweite k·Δt" value={eulerRatio.toFixed(2)}>
                <LogSlider min={0.01} max={2.5} value={eulerRatio} onChange={setEulerRatio} />
              </Field>
              <div style={{ fontFamily: SANS, fontSize: 11, color: eulerRatio > 2 ? OHM_RED : GRAY, fontWeight: eulerRatio > 2 ? 700 : 400 }}>
                {eulerRatio > 2 ? "⚠ k·Δt > 2 — numerisch instabil." : "Kleiner = genauer/stabiler."}
              </div>
            </PanelBox>
          </div>

          {/* CENTER: CHART */}
          <div className="lg:col-span-6 flex flex-col gap-3">
            <div style={{ position: "relative", background: CHART_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)", padding: "10px 6px 4px 0" }}>
              <div style={{ width: "100%", height: 400 }}>
                <ResponsiveContainer>
                  <ComposedChart margin={{ top: 10, right: 18, bottom: 6, left: -6 }}>
                    <CartesianGrid stroke={CHART_GRID} strokeDasharray="2 4" />
                    <XAxis dataKey="t" type="number" domain={xDomain} allowDataOverflow
                      tickFormatter={(v) => fmtTime(v)} stroke={GRAY} tick={{ fontFamily: MONO, fontSize: 10, fill: GRAY }} />
                    <YAxis type="number" domain={[0, yMax]} allowDataOverflow stroke={GRAY} tick={{ fontFamily: MONO, fontSize: 10, fill: GRAY }}
                      label={{ value: "Absorption A (a.u.)", angle: -90, position: "insideLeft", fill: GRAY, fontSize: 10, fontFamily: MONO }} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={epsilon * A0s} stroke={GRAY} strokeDasharray="2 3" strokeOpacity={0.6} />
                    {channels.map((ch) => (
                      <Line key={`h-${ch.id}`} data={displayData[ch.id] || []} dataKey="a" stroke={ch.color}
                        strokeWidth={ch.id === activeCh?.id ? 2.5 : 1.75} strokeOpacity={doneRef.current[ch.id] || ch.id === activeCh?.id ? 1 : 0.35}
                        dot={false} isAnimationActive={false} name={`${ch.tempC}°C`} />
                    ))}
                    {channels.map((ch) => (
                      <Scatter key={`n-${ch.id}`} data={noisyRef.current[ch.id] || []} dataKey="value"
                        fill={ch.color} fillOpacity={0.85} isAnimationActive={false} shape="circle" r={2.6} name={`${ch.tempC}°C Messung`} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 px-1">
              {channels.map((ch, idx) => (
                <div key={ch.id} className="flex items-center gap-1.5">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: ch.color, opacity: doneRef.current[ch.id] || idx === activeIndex ? 1 : 0.35 }} />
                  <span style={{ fontFamily: SANS, fontSize: 11, color: INK, fontWeight: 500 }}>{ch.tempC} °C</span>
                </div>
              ))}
              <span style={{ fontFamily: SANS, fontSize: 11, color: GRAY }}>Blass = noch nicht dran</span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={handlePlayPause} className="ohm-btn" style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, letterSpacing: "0.02em",
                background: running ? "#fff" : OHM_RED, color: running ? OHM_RED : "#fff", border: `2px solid ${OHM_RED}`, borderRadius: 5, padding: "9px 20px" }}>
                {running ? "⏸ PAUSE" : "▶ START"}
              </button>
              <button onClick={handleNext} disabled={isLastChannel} className="ohm-btn" style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 16px", color: INK }}>
                Nächster Ansatz →
              </button>
              <button onClick={handleReset} className="ohm-btn" style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 16px", color: INK }}>
                ↺ Neuer Messlauf
              </button>
              <button onClick={exportCSV} className="ohm-btn" style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 16px", color: INK }}>
                ⤓ CSV
              </button>
              <div style={{ fontFamily: MONO, fontSize: 11, color: GRAY, marginLeft: "auto" }}>
                Ansatz {activeIndex + 1}/{channels.length} · t = {fmtTime(elapsedRef.current[activeCh?.id] || 0)}
              </div>
            </div>
          </div>

          {/* RIGHT: VIALS + PER-CHANNEL CONTROLS */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <PanelBox title="Ansätze (nacheinander)">
              <div className="flex gap-2">
                {channels.map((ch, idx) => {
                  const A0v = A0StartRef.current;
                  const c = concRef.current[ch.id] ?? A0v;
                  const frac = A0v > 0 ? Math.max(0, Math.min(1, (A0v - c) / A0v)) : 0;
                  const color = lerpColor(COLORLESS, YELLOW, frac);
                  const status = doneRef.current[ch.id] ? "done" : idx === activeIndex ? "active" : "wartet";
                  return (
                    <Vial key={ch.id} id={ch.id} color={color} tempC={ch.tempC} status={status}
                      stirPhase={stirPhaseRef.current} running={running} unstable={unstableRef.current[ch.id]} />
                  );
                })}
              </div>
            </PanelBox>

            {channels.map((ch, idx) => {
              const k = computeK(ch.tempC, kRef, Ea);
              const t12 = Math.LN2 / k;
              const isDone = doneRef.current[ch.id];
              const isActive = idx === activeIndex;
              return (
                <PanelBox key={ch.id} title={
                  <div className="flex items-center justify-between" style={{ width: "100%" }}>
                    <span className="flex items-center gap-2">
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: ch.color, display: "inline-block" }} />
                      Ansatz {idx + 1} {isActive && "(aktiv)"} {isDone && "(fertig)"}
                    </span>
                    {channels.length > 1 && !isActive && (
                      <button onClick={() => removeChannel(ch.id)} style={{ fontFamily: SANS, fontSize: 11, color: OHM_RED, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>✕</button>
                    )}
                  </div>
                }>
                  <Field label={`Temperatur${isDone ? " (abgeschlossen)" : isActive ? " (live änderbar)" : " (vor Start einstellbar)"}`} value={`${ch.tempC} °C`} locked={isDone}>
                    <LinearSlider min={0} max={130} step={1} value={ch.tempC} onChange={(v) => setChannelTemp(ch.id, v)} disabled={isDone} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2" style={{ fontFamily: MONO, fontSize: 11, color: INK }}>
                    <div>k(T): <b>{fmtK(k)}</b></div>
                    <div>t½: <b>{fmtTime(t12)}</b></div>
                  </div>
                </PanelBox>
              );
            })}

            {channels.length < 4 && (
              <button onClick={addChannel} className="ohm-btn" style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, background: "#fff", border: `1px dashed ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 0", color: INK }}>
                + Ansatz ans Ende der Reihe
              </button>
            )}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${PANEL_BORDER}`, paddingTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 22px" }}>
          <span style={{ fontFamily: SANS, fontSize: 11, color: GRAY }}>Modell: dc/dt = −k(T)·c, live Euler-integriert (nur aktiver Ansatz läuft)</span>
          <span style={{ fontFamily: SANS, fontSize: 11, color: GRAY }}>Absorption: A(t) = ε·(c₀−c(t)), Beer-Lambert</span>
          <span style={{ fontFamily: SANS, fontSize: 11, color: GRAY }}>Temperatur nur beim aktiven Ansatz live, sonst vor Start bzw. gesperrt nach Abschluss</span>
        </div>
      </div>
    </div>
  );
}
