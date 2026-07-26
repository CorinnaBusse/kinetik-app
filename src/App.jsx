import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceDot, ReferenceLine, Tooltip,
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
const TRACE = "#6FFFB0";
const MONO = "'JetBrains Mono', ui-monospace, monospace";
const STENCIL = "'Big Shoulders', 'Arial Narrow', sans-serif";
const R_GAS = 8.314; // J/(mol K)
const T0 = 298.15; // K, reference temperature for k_ref

const SUPERSCRIPT = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const sup = (n) => String(n).split("").map((c) => SUPERSCRIPT[c] ?? c).join("");

function fmtTime(s) {
  if (!isFinite(s)) return "—";
  const sign = s < 0 ? "-" : "";
  s = Math.abs(s);
  if (s < 60) return `${sign}${s.toFixed(1)} s`;
  if (s < 3600) return `${sign}${(s / 60).toFixed(2)} min`;
  if (s < 86400) return `${sign}${(s / 3600).toFixed(2)} h`;
  return `${sign}${(s / 86400).toFixed(2)} d`;
}
function fmtK(k) {
  if (!isFinite(k) || k <= 0) return "—";
  const exp = Math.floor(Math.log10(k));
  const mant = k / Math.pow(10, exp);
  return `${mant.toFixed(2)} × 10${sup(exp)} s⁻¹`;
}
function fmtHMS(s) {
  if (!isFinite(s)) return "—:—:—";
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
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
const logToPos = (val, min, max) => (100 * Math.log(val / min)) / Math.log(max / min);
const posToLog = (pos, min, max) => min * Math.pow(max / min, pos / 100);

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
   MAIN APP
--------------------------------------------------------------------- */
export default function KinetikSimulator() {
  const [tempC, setTempC] = useState(50);
  const [A0, setA0] = useState(1.0);
  const [kRef, setKRef] = useState(0.01);
  const [Ea, setEa] = useState(60);
  const [noisePct, setNoisePct] = useState(4);
  const [sampleInterval, setSampleInterval] = useState(5);
  const [speed, setSpeed] = useState(50);
  const [eulerRatio, setEulerRatio] = useState(0.1);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);

  const paramsRef = useRef({});
  paramsRef.current = { tempC, A0, kRef, Ea, noisePct, sampleInterval, speed, eulerRatio };

  const elapsedRef = useRef(0);
  const concRef = useRef(A0);
  const histRef = useRef([{ t: 0, c: A0 }]);
  const noisyRef = useRef([]);
  const lastSampleRef = useRef(0);
  const windowWidthRef = useRef(60);
  const gaussRef = useRef(makeGaussian(mulberry32(Date.now() % 1e6)));
  const unstableRef = useRef(false);

  const initRun = useCallback(() => {
    const p = paramsRef.current;
    elapsedRef.current = 0;
    concRef.current = p.A0;
    histRef.current = [{ t: 0, c: p.A0 }];
    noisyRef.current = [];
    lastSampleRef.current = 0;
    const k = computeK(p.tempC, p.kRef, p.Ea);
    windowWidthRef.current = Math.max(20, (Math.LN2 / k) * 8);
    gaussRef.current = makeGaussian(mulberry32(Date.now() % 1e6));
    unstableRef.current = false;
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

      const k = computeK(p.tempC, p.kRef, p.Ea);
      const t12 = Math.LN2 / k;
      const subDt = p.eulerRatio / k;
      const steps = Math.min(2000, Math.max(1, Math.round(dtSim / subDt)));
      const actualSubDt = dtSim / steps;
      let c = concRef.current;
      for (let i = 0; i < steps; i++) c = c - k * c * actualSubDt;
      c = Math.max(-5 * p.A0, Math.min(5 * p.A0, c));
      concRef.current = c;
      unstableRef.current = k * subDt > 2;

      const arr = histRef.current;
      arr.push({ t, c });
      const minKeep = t - windowWidthRef.current * 1.5;
      while (arr.length > 2 && arr[0].t < minKeep) arr.shift();

      if (t - lastSampleRef.current >= p.sampleInterval) {
        const noiseAbs = (p.noisePct / 100) * p.A0;
        const val = c + noiseAbs * gaussRef.current();
        const narr = noisyRef.current;
        narr.push({ t, value: val });
        while (narr.length > 2 && narr[0].t < minKeep) narr.shift();
        lastSampleRef.current = t;
      }

      windowWidthRef.current = Math.max(windowWidthRef.current, t12 * 8);
      frame++;
      if (frame % 3 === 0) setTick((x) => x + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const handlePlayPause = () => setRunning((r) => !r);
  const handleReset = () => { setRunning(false); initRun(); };
  const handleAutoSpeed = () => {
    const k = computeK(tempC, kRef, Ea);
    const t12 = Math.LN2 / k;
    setSpeed(Math.max(1, Math.round((t12 * 8) / 25)));
  };

  const elapsed = elapsedRef.current;
  const ww = windowWidthRef.current;
  const xDomain = elapsed <= ww ? [0, ww] : [elapsed - ww, elapsed];

  let yMin = 0, yMax = A0;
  histRef.current.forEach((pt) => {
    if (pt.t >= xDomain[0]) { if (pt.c > yMax) yMax = pt.c; if (pt.c < yMin) yMin = pt.c; }
  });
  const yDomain = [Math.min(0, yMin * 1.15), Math.max(A0 * 1.05, yMax * 1.1)];

  const k = computeK(tempC, kRef, Ea);
  const t12 = Math.LN2 / k;
  const c = concRef.current;
  const pctRemaining = A0 > 0 ? (c / A0) * 100 : 0;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const row = payload.find((p) => p.dataKey === "c");
    return (
      <div style={{ background: SCREEN_BG, border: `1px solid ${METAL}`, borderRadius: 4, padding: "6px 10px", fontFamily: MONO, fontSize: 11, color: "#E8F0EA" }}>
        <div style={{ opacity: 0.7, marginBottom: 4 }}>t = {fmtTime(label)}</div>
        {row && <div style={{ color: TRACE }}>c = {row.value?.toFixed(3)} mol/L</div>}
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

      <div className="w-full flex flex-col gap-4" style={{ maxWidth: 1100 }}>
        {/* HEADER */}
        <div className="flex items-end justify-between flex-wrap gap-3 pb-3" style={{ borderBottom: `2px solid ${INK}` }}>
          <div>
            <h1 style={{ fontFamily: STENCIL, fontWeight: 900, fontSize: "clamp(28px,4vw,42px)", color: INK, letterSpacing: "0.02em", lineHeight: 1 }}>
              REAKTION·MONITOR
            </h1>
            <p style={{ fontFamily: MONO, fontSize: 11.5, color: INK, opacity: 0.75, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>
              Live-Integration · Arrhenius · Temperatur während des Laufs änderbar
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
          <div className="lg:col-span-4 flex flex-col gap-4">
            <PanelBox title="Reaktor">
              <Field label="Temperatur (live änderbar)" value={`${tempC} °C`}>
                <LinearSlider min={0} max={130} step={1} value={tempC} onChange={setTempC} />
              </Field>
              <Field label="Startkonz. c₀" value={`${A0.toFixed(2)} mol/L`}>
                <LinearSlider min={0.1} max={2} step={0.05} value={A0} onChange={setA0} />
              </Field>
              <Field label="k bei 25 °C" value={fmtK(kRef)}>
                <LogSlider min={0.0001} max={0.1} value={kRef} onChange={setKRef} />
              </Field>
              <Field label="Aktivierungsenergie Eₐ" value={`${Ea.toFixed(0)} kJ/mol`}>
                <LinearSlider min={20} max={150} step={1} value={Ea} onChange={setEa} />
              </Field>
              <div style={{ fontFamily: MONO, fontSize: 10, color: INK, opacity: 0.55 }}>
                Alle Regler wirken sofort — auch während der Lauf läuft.
              </div>
            </PanelBox>

            <PanelBox title="Messung">
              <Field label="Messrauschen (σ)" value={`± ${noisePct.toFixed(1)} % c₀`}>
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
                {eulerRatio > 2 ? "⚠ k·Δt > 2 — numerisch instabil, Kurve schwingt auf." : "Kleiner = genauer/stabiler. Werte > 2 zeigen Instabilität."}
              </div>
            </PanelBox>
          </div>

          {/* CENTER SCREEN + READOUTS */}
          <div className="lg:col-span-8 flex flex-col gap-3">
            <div style={{ position: "relative", background: SCREEN_BG, border: `3px solid ${METAL}`, borderRadius: 10,
              boxShadow: "inset 0 0 40px rgba(111,255,176,0.08), 0 3px 10px rgba(0,0,0,0.3)", padding: "10px 6px 4px 0", overflow: "hidden" }}>
              <div className="pointer-events-none" style={{ position: "absolute", inset: 0,
                backgroundImage: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.5) 0px, transparent 1px, transparent 3px)", opacity: 0.04, zIndex: 2 }} />
              <div style={{ width: "100%", height: 380 }}>
                <ResponsiveContainer>
                  <ComposedChart margin={{ top: 10, right: 18, bottom: 6, left: -6 }}>
                    <CartesianGrid stroke="#2A4536" strokeDasharray="2 4" />
                    <XAxis dataKey="t" type="number" domain={xDomain} allowDataOverflow
                      tickFormatter={(v) => fmtTime(v)} stroke="#7FA893" tick={{ fontFamily: MONO, fontSize: 10, fill: "#7FA893" }} />
                    <YAxis type="number" domain={yDomain} allowDataOverflow stroke="#7FA893" tick={{ fontFamily: MONO, fontSize: 10, fill: "#7FA893" }}
                      label={{ value: "c / (mol·L⁻¹)", angle: -90, position: "insideLeft", fill: "#7FA893", fontSize: 10, fontFamily: MONO }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line data={histRef.current} dataKey="c" stroke={TRACE} strokeWidth={2} dot={false} isAnimationActive={false} name="Modell" />
                    <Scatter data={noisyRef.current} dataKey="value" fill={TRACE} fillOpacity={0.85} isAnimationActive={false} shape="circle" r={2.6} name="Messung" />
                    {running && <ReferenceLine x={elapsed} stroke="#E8F0EA" strokeOpacity={0.25} />}
                    <ReferenceDot x={elapsed} y={c} r={4.5} fill={TRACE} stroke="#0A1410" strokeWidth={1} isFront />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={handlePlayPause} className="rocker" style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, letterSpacing: "0.05em",
                background: running ? "#E7C9C0" : "#C9E7D4", border: `1px solid ${INK}`, borderRadius: 5, padding: "9px 20px", color: INK, boxShadow: "0 2px 0 rgba(0,0,0,0.15)" }}>
                {running ? "⏸ PAUSE" : "▶ START"}
              </button>
              <button onClick={handleReset} className="rocker" style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.05em", background: "#fff", border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, padding: "9px 16px", color: INK }}>
                ↺ Neuer Messlauf
              </button>
              <div style={{ fontFamily: MONO, fontSize: 11, color: INK, opacity: 0.75, marginLeft: "auto" }}>
                Fenster: {fmtTime(ww)} · Realzeit/Fenster: {fmtHMS(ww / speed)}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <PanelBox title="Uhr">
                <div style={{ fontFamily: MONO, fontSize: 18, color: INK }}>{fmtTime(elapsed)}</div>
              </PanelBox>
              <PanelBox title="k(T)">
                <div style={{ fontFamily: MONO, fontSize: 14, color: INK }}>{fmtK(k)}</div>
                {unstableRef.current && <div style={{ fontFamily: MONO, fontSize: 10, color: RED, marginTop: 4 }}>⚠ instabil</div>}
              </PanelBox>
              <PanelBox title="t½">
                <div style={{ fontFamily: MONO, fontSize: 14, color: INK }}>{fmtTime(t12)}</div>
              </PanelBox>
              <PanelBox title="c(t) / Rest">
                <div style={{ fontFamily: MONO, fontSize: 14, color: INK }}>{c.toFixed(3)} mol/L</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: INK, opacity: 0.7 }}>{pctRemaining.toFixed(1)} %</div>
              </PanelBox>
            </div>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${PANEL_BORDER}`, paddingTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 22px" }}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: INK, opacity: 0.65 }}>Modell: dc/dt = −k(T)·c, live integriert (explizites Euler)</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: INK, opacity: 0.65 }}>Arrhenius: k(T) = A·exp(−Eₐ/(R·T)), jeden Frame neu ausgewertet</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: INK, opacity: 0.65 }}>Messrauschen: additiv, Gauß-verteilt, σ = {noisePct}% von c₀</span>
        </div>
      </div>
    </div>
  );
}
