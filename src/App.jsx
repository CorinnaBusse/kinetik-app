import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Tooltip,
} from "recharts";

/* ---------------------------------------------------------------------
   TOKENS
--------------------------------------------------------------------- */
const INK = "#2B2620";
const CHASSIS = "#EDE6D6";
const PANEL = "#E3DAC4";
const PANEL_BORDER = "#C6B996";
const METAL = "#8A8478";
const SCREEN_BG = "#07110C";
const RED = "#B33F2C";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const STENCIL = "'Big Shoulders', 'Arial Narrow', sans-serif";
const R_GAS = 8.314;
const T0 = 298.15;
const CHANNEL_COLORS = ["#6FFFB0", "#FFB454", "#6FD8FF", "#D88FE0"];
const COLORLESS = "#F1EEE4";
const YELLOW = "#F4C430";

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
const logToPos = (val, min, max) => (100 * Math.log(val / min)) / Math.log(max / min);
const posToLog = (pos, min, max) => min * Math.pow(max / min, pos / 100);
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

/* ---------------------------------------------------------------------
   CONTROL WIDGETS
--------------------------------------------------------------------- */
function Field({ label, value, children }) {
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", color: INK, opacity: 0.75, textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: INK, fontWeight: 600 }}>{value}</span>
      </div>
      {children}
    </div>
  );
}
function LinearSlider({ min, max, step, value, onChange }) {
  return <input className="knob" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />;
}
function LogSlider({ min, max, value, onChange }) {
  const pos = logToPos(value, min, max);
  return <input className="knob" type="range" min={0} max={100} step={0.1} value={pos} onChange={(e) => onChange(posToLog(parseFloat(e.target.value), min, max))} />;
}
function PanelBox({ title, children }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, borderRadius: 6, padding: "12px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 1px 2px rgba(0,0,0,0.08)" }}>
      <div style={{ fontFamily: STENCIL, fontWeight: 700, fontSize: 13, letterSpacing: "0.06em", color: INK, textTransform: "uppercase", marginBottom: 10, borderBottom: `1px dashed ${PANEL_BORDER}`, paddingBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------
   VIAL / KÜVETTE
--------------------------------------------------------------------- */
function Vial({ id, color, tempC, absorbance, stirPhase, unstable }) {
  return (
    <div className="flex flex-col items-center gap-1" style={{ flex: 1, minWidth: 70 }}>
      <svg viewBox="0 0 60 140" style={{ width: "100%", maxWidth: 74, height: 130 }}>
        <defs>
          <clipPath id={`vialClip-${id}`}>
            <path d="M14,8 h32 v70 a18,18 0 0 1 -32,0 z" />
          </clipPath>
        </defs>
        <path d="M14,8 h32 v70 a18,18 0 0 1 -32,0 z" fill="#FAFAF7" stroke={METAL} strokeWidth={2.5} />
        <g clipPath={`url(#vialClip-${id})`}>
          <rect x="10" y="45" width="40" height="60" fill={color} />
          <ellipse cx="30" cy={68} rx="9" ry="3.2" fill="rgba(0,0,0,0.12)"
            transform={`rotate(${stirPhase} 30 68)`} />
        </g>
        <rect x="14" y="4" width="32" height="8" rx="2" fill={METAL} />
        {unstable && (
          <text x="30" y="6" textAnchor="middle" fontFamily={MONO} fontSize="9" fill={RED}>⚠</text>
        )}
      </svg>
      <div style={{ fontFamily: MONO, fontSize: 11, color: INK, fontWeight: 700 }}>{tempC} °C</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: INK, opacity: 0.7 }}>A = {absorbance.toFixed(2)}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   MAIN APP
--------------------------------------------------------------------- */
export default function KinetikAbsorbance() {
  const nextId = useRef(4);
  const [channels, setChannels] = useState([
    { id: 1, tempC: 25, color: CHANNEL_COLORS[0] },
    { id: 2, tempC: 50, color: CHANNEL_COLORS[1] },
    { id: 3, tempC: 75, color: CHANNEL_COLORS[2] },
  ]);
  const [A0, setA0] = useState(1.0);
  const [kRef, setKRef] = useState(0.01);
  const [Ea, setEa] = useState(60);
  const [epsilon, setEpsilon] = useState(1.0);
  const [noisePct, setNoisePct] = useState(3);
  const [sampleInterval, setSampleInterval] = useState(5);
  const [speed, setSpeed] = useState(30);
  const [eulerRatio, setEulerRatio] = useState(0.1);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);

  const paramsRef = useRef({});
  paramsRef.current = { channels, A0, kRef, Ea, epsilon, noisePct, sampleInterval, speed, eulerRatio };

  const elapsedRef = useRef(0);
  const concRef = useRef({});
  const histRef = useRef({});
  const noisyRef = useRef({});
  const lastSampleRef = useRef({});
  const windowWidthRef = useRef(60);
  const gaussRef = useRef(makeGaussian(mulberry32(Date.now() % 1e6)));
  const unstableRef = useRef({});
  const A0StartRef = useRef(1.0);
  const stirPhaseRef = useRef(0);

  const initRun = useCallback(() => {
    const p = paramsRef.current;
    elapsedRef.current = 0;
    A0StartRef.current = p.A0;
    const conc = {}, hist = {}, noisy = {}, lastSample = {};
    p.channels.forEach((c) => {
      conc[c.id] = p.A0;
      hist[c.id] = [{ t: 0, c: p.A0 }];
      noisy[c.id] = [];
      lastSample[c.id] = 0;
    });
    concRef.current = conc; histRef.current = hist; noisyRef.current = noisy; lastSampleRef.current = lastSample;
    const maxT12 = Math.max(...p.channels.map((c) => Math.LN2 / computeK(c.tempC, p.kRef, p.Ea)));
    windowWidthRef.current = Math.max(20, maxT12 * 8);
    gaussRef.current = makeGaussian(mulberry32(Date.now() % 1e6));
    unstableRef.current = {};
    stirPhaseRef.current = 0;
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
      const dtSim = dtReal * p.speed;
      elapsedRef.current += dtSim;
      const t = elapsedRef.current;
      const A0s = A0StartRef.current;
      let maxT12 = 0;

      p.channels.forEach((ch) => {
        const k = computeK(ch.tempC, p.kRef, p.Ea);
        maxT12 = Math.max(maxT12, Math.LN2 / k);
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
        const minKeep = t - windowWidthRef.current * 1.5;
        while (arr.length > 2 && arr[0].t < minKeep) arr.shift();

        const lastS = lastSampleRef.current[ch.id] ?? 0;
        if (t - lastS >= p.sampleInterval) {
          const trueAbs = p.epsilon * (A0s - c);
          const noiseAbs = (p.noisePct / 100) * p.epsilon * A0s;
          const val = Math.max(0, trueAbs + noiseAbs * gaussRef.current());
          const narr = noisyRef.current[ch.id] || (noisyRef.current[ch.id] = []);
          narr.push({ t, value: val });
          while (narr.length > 2 && narr[0].t < minKeep) narr.shift();
          lastSampleRef.current[ch.id] = t;
        }
      });
      windowWidthRef.current = Math.max(windowWidthRef.current, maxT12 * 8);
      stirPhaseRef.current += dtReal * 70;
      frame++;
      if (frame % 3 === 0) setTick((x) => x + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const handlePlayPause = () => setRunning((r) => !r);
  const handleReset = () => { setRunning(false); initRun(); };

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
    rows.sort((a, b) => a.t - b.t || a.id - b.id);

    const meta = [
      `# Reaktion-Monitor Messexport`,
      `# c0=${A0v} mol/L; k(25C)=${kRef} 1/s; Ea=${Ea} kJ/mol; epsilon=${epsilon}; Rauschen=${noisePct}%; Messintervall=${sampleInterval}s`,
      `# Zeitpunkt: ${new Date().toLocaleString("de-DE")}`,
    ];
    const header = ["Zeit_s", "Temperatur_C", "Kanal_ID", "Absorption_gemessen", "Absorption_Modell"];
    const lines = [
      ...meta,
      header.join(";"),
      ...rows.map((r) => [csvNum(r.t), r.tempC, r.id, csvNum(r.measured), csvNum(r.model)].join(";")),
    ];
    const csvContent = "\uFEFF" + lines.join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kinetik_messdaten_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const handleAutoSpeed = () => {
    const maxT12 = Math.max(...channels.map((c) => Math.LN2 / computeK(c.tempC, kRef, Ea)));
    setSpeed(Math.max(1, Math.round((maxT12 * 8) / 25)));
  };
  const addChannel = () => {
    if (channels.length >= 4) return;
    const id = nextId.current++;
    const used = channels.map((c) => c.color);
    const color = CHANNEL_COLORS.find((c) => !used.includes(c)) || CHANNEL_COLORS[0];
    setChannels((cs) => [...cs, { id, tempC: 40, color }]);
    concRef.current[id] = A0StartRef.current;
    histRef.current[id] = [{ t: elapsedRef.current, c: A0StartRef.current }];
    noisyRef.current[id] = [];
    lastSampleRef.current[id] = elapsedRef.current;
  };
  const removeChannel = (id) => {
    if (channels.length <= 1) return;
    setChannels((cs) => cs.filter((c) => c.id !== id));
    delete concRef.current[id]; delete histRef.current[id]; delete noisyRef.current[id]; delete lastSampleRef.current[id];
  };
  const setChannelTemp = (id, tempC) => setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, tempC } : c)));

  const elapsed = elapsedRef.current;
  const ww = windowWidthRef.current;
  const xDomain = elapsed <= ww ? [0, ww] : [elapsed - ww, elapsed];
  const A0s = A0StartRef.current;
  const yMax = Math.max(0.2, epsilon * A0s * 1.05);

  const displayData = {};
  channels.forEach((ch) => {
    displayData[ch.id] = (histRef.current[ch.id] || []).map((pt) => ({ t: pt.t, a: epsilon * (A0s - pt.c) }));
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div style={{ background: SCREEN_BG, border: `1px solid ${METAL}`, borderRadius: 4, padding: "6px 10px", fontFamily: MONO, fontSize: 11, color: "#E8F0EA" }}>
        <div style={{ opacity: 0.7, marginBottom: 4 }}>t = {fmtTime(label)}</div>
        {payload.filter((p) => p.dataKey === "a").map((p) => (
          <div key={p.name} style={{ color: p.color }}>{p.name}: A = {p.value?.toFixed(3)}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="w-full min-h-screen flex justify-center p-3 md:p-6" style={{ background: CHASSIS }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@700;900&family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        input.knob { -webkit-appearance:none; appearance:none; width:100%; height:5px; border-radius:3px; background-color:#c9bc9c; cursor:pointer; }
        input.knob::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
          background: radial-gradient(circle at 32% 32%, #fff, ${METAL} 75%); border:2px solid ${INK}; box-shadow:0 1px 2px rgba(0,0,0,.45); cursor:pointer; }
        input.knob::-moz-range-thumb { width:16px; height:16px; border-radius:50%;
          background: radial-gradient(circle at 32% 32%, #fff, ${METAL} 75%); border:2px solid ${INK}; cursor:pointer; }
        input.knob::-moz-range-track { background:#c9bc9c; height:5px; border-radius:3px; }
        .led { animation: pulseGlow 1.1s ease-in-out infinite; }
        @keyframes pulseGlow { 0%,100%{opacity:1} 50%{opacity:.35} }
        @media (prefers-reduced-motion: reduce) { .led { animation: none; } }
        .rocker:active { transform: translateY(1px); }
      `}</style>

      <div className="w-full flex flex-col gap-4" style={{ maxWidth: 1360 }}>
        {/* HEADER */}
        <div className="flex items-end justify-between flex-wrap gap-3 pb-3" style={{ borderBottom: `2px solid ${INK}` }}>
          <div>
            <h1 style={{ fontFamily: STENCIL, fontWeight: 900, fontSize: "clamp(28px,4vw,42px)", color: INK, letterSpacing: "0.02em", lineHeight: 1 }}>
              REAKTION·MONITOR
            </h1>
            <p style={{ fontFamily: MONO, fontSize: 11.5, color: INK, opacity: 0.75, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>
              Farbreaktion · Absorption statt Konzentration · mehrere Ansätze parallel
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="led" style={{ width: 10, height: 10, borderRadius: "50%",
              background: running ? "#6FFFB0" : RED, boxShadow: `0 0 8px ${running ? "#6FFFB0" : RED}` }} />
            <span style={{ fontFamily: MONO, fontSize: 11, color: INK, textTransform: "uppercase" }}>{running ? "Läuft" : "Angehalten"}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT CONTROLS */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <PanelBox title="Reaktion & Kinetik">
              <Field label="Startkonz. c₀ (Substrat)" value={`${A0.toFixed(2)} mol/L`}>
                <LinearSlider min={0.1} max={2} step={0.05} value={A0} onChange={setA0} />
              </Field>
              <Field label="k bei 25 °C" value={fmtK(kRef)}>
                <LogSlider min={0.0001} max={0.1} value={kRef} onChange={setKRef} />
              </Field>
              <Field label="Aktivierungsenergie Eₐ" value={`${Ea.toFixed(0)} kJ/mol`}>
                <LinearSlider min={20} max={150} step={1} value={Ea} onChange={setEa} />
              </Field>
              <div style={{ fontFamily: MONO, fontSize: 10, color: INK, opacity: 0.55 }}>
                Substrat (farblos) → Produkt (gelb), c₀/k/Eₐ wirken sofort.
              </div>
            </PanelBox>

            <PanelBox title="Absorption">
              <Field label="Extinktionskoeffizient ε (a.u.)" value={epsilon.toFixed(2)}>
                <LogSlider min={0.2} max={5} value={epsilon} onChange={setEpsilon} />
              </Field>
              <div style={{ fontFamily: MONO, fontSize: 10, color: INK, opacity: 0.55 }}>
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

            <PanelBox title="Zeitraffer & Integration">
              <Field label="Beschleunigung" value={`× ${speed.toFixed(0)}`}>
                <LogSlider min={1} max={5000} value={speed} onChange={setSpeed} />
              </Field>
              <button onClick={handleAutoSpeed} className="rocker w-full" style={{ fontFamily: MONO, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, padding: "6px 0", color: INK, marginBottom: 12 }}>
                Auto-Zeitraffer
              </button>
              <Field label="Euler-Schrittweite k·Δt" value={eulerRatio.toFixed(2)}>
                <LogSlider min={0.01} max={2.5} value={eulerRatio} onChange={setEulerRatio} />
              </Field>
              <div style={{ fontFamily: MONO, fontSize: 10, color: eulerRatio > 2 ? RED : INK, opacity: eulerRatio > 2 ? 1 : 0.55 }}>
                {eulerRatio > 2 ? "⚠ k·Δt > 2 — numerisch instabil." : "Kleiner = genauer/stabiler."}
              </div>
            </PanelBox>
          </div>

          {/* CENTER: CHART */}
          <div className="lg:col-span-6 flex flex-col gap-3">
            <div style={{ position: "relative", background: SCREEN_BG, border: `3px solid ${METAL}`, borderRadius: 10,
              boxShadow: "inset 0 0 40px rgba(111,255,176,0.08), 0 3px 10px rgba(0,0,0,0.3)", padding: "10px 6px 4px 0", overflow: "hidden" }}>
              <div className="pointer-events-none" style={{ position: "absolute", inset: 0,
                backgroundImage: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.5) 0px, transparent 1px, transparent 3px)", opacity: 0.04, zIndex: 2 }} />
              <div style={{ width: "100%", height: 400 }}>
                <ResponsiveContainer>
                  <ComposedChart margin={{ top: 10, right: 18, bottom: 6, left: -6 }}>
                    <CartesianGrid stroke="#2A4536" strokeDasharray="2 4" />
                    <XAxis dataKey="t" type="number" domain={xDomain} allowDataOverflow
                      tickFormatter={(v) => fmtTime(v)} stroke="#7FA893" tick={{ fontFamily: MONO, fontSize: 10, fill: "#7FA893" }} />
                    <YAxis type="number" domain={[0, yMax]} allowDataOverflow stroke="#7FA893" tick={{ fontFamily: MONO, fontSize: 10, fill: "#7FA893" }}
                      label={{ value: "Absorption A (a.u.)", angle: -90, position: "insideLeft", fill: "#7FA893", fontSize: 10, fontFamily: MONO }} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={epsilon * A0s} stroke="#7FA893" strokeDasharray="2 3" strokeOpacity={0.5} />
                    {channels.map((ch) => (
                      <Line key={`h-${ch.id}`} data={displayData[ch.id] || []} dataKey="a" stroke={ch.color} strokeWidth={2}
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
              {channels.map((ch) => (
                <div key={ch.id} className="flex items-center gap-1.5">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: ch.color }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: INK }}>{ch.tempC} °C</span>
                </div>
              ))}
              <span style={{ fontFamily: MONO, fontSize: 11, color: INK, opacity: 0.6 }}>Linie = Modell, Punkte = Messung, graue Linie = A_max</span>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={handlePlayPause} className="rocker" style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, letterSpacing: "0.05em",
                background: running ? "#E7C9C0" : "#C9E7D4", border: `1px solid ${INK}`, borderRadius: 5, padding: "9px 20px", color: INK, boxShadow: "0 2px 0 rgba(0,0,0,0.15)" }}>
                {running ? "⏸ PAUSE" : "▶ START"}
              </button>
              <button onClick={handleReset} className="rocker" style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.05em", background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 16px", color: INK }}>
                ↺ Neuer Messlauf
              </button>
              <button onClick={exportCSV} className="rocker" style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.05em", background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 16px", color: INK }}>
                ⤓ CSV exportieren
              </button>
              <div style={{ fontFamily: MONO, fontSize: 11, color: INK, opacity: 0.75, marginLeft: "auto" }}>
                t = {fmtTime(elapsed)}
              </div>
            </div>
          </div>

          {/* RIGHT: VIALS + PER-CHANNEL CONTROLS */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <PanelBox title="Ansätze (live)">
              <div className="flex gap-2">
                {channels.map((ch) => {
                  const A0v = A0StartRef.current;
                  const c = concRef.current[ch.id] ?? A0v;
                  const frac = A0v > 0 ? Math.max(0, Math.min(1, (A0v - c) / A0v)) : 0;
                  const color = lerpColor(COLORLESS, YELLOW, frac);
                  const absNow = epsilon * (A0v - c);
                  return (
                    <Vial key={ch.id} id={ch.id} color={color} tempC={ch.tempC} absorbance={absNow}
                      stirPhase={stirPhaseRef.current} unstable={unstableRef.current[ch.id]} />
                  );
                })}
              </div>
            </PanelBox>

            {channels.map((ch) => {
              const k = computeK(ch.tempC, kRef, Ea);
              const t12 = Math.LN2 / k;
              return (
                <PanelBox key={ch.id} title={
                  <div className="flex items-center justify-between" style={{ width: "100%" }}>
                    <span className="flex items-center gap-2">
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: ch.color, display: "inline-block" }} />
                      Kanal {ch.tempC} °C
                    </span>
                    {channels.length > 1 && (
                      <button onClick={() => removeChannel(ch.id)} style={{ fontFamily: MONO, fontSize: 10, color: RED, background: "none", border: "none", cursor: "pointer" }}>✕</button>
                    )}
                  </div>
                }>
                  <Field label="Temperatur (live änderbar)" value={`${ch.tempC} °C`}>
                    <LinearSlider min={0} max={130} step={1} value={ch.tempC} onChange={(v) => setChannelTemp(ch.id, v)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2" style={{ fontFamily: MONO, fontSize: 11, color: INK }}>
                    <div>k(T): <b>{fmtK(k)}</b></div>
                    <div>t½: <b>{fmtTime(t12)}</b></div>
                  </div>
                </PanelBox>
              );
            })}

            {channels.length < 4 && (
              <button onClick={addChannel} className="rocker" style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.05em", background: "#fff", border: `1px dashed ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 0", color: INK }}>
                + Ansatz hinzufügen (ab jetzt)
              </button>
            )}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${PANEL_BORDER}`, paddingTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 22px" }}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: INK, opacity: 0.65 }}>Modell: dc/dt = −k(T)·c, live Euler-integriert</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: INK, opacity: 0.65 }}>Absorption: A(t) = ε·(c₀−c(t)), Beer-Lambert (Produktbildung)</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: INK, opacity: 0.65 }}>Färbung Ansatz ∝ Umsatzgrad (c₀−c)/c₀, unabhängig von ε</span>
        </div>
      </div>
    </div>
  );
}
