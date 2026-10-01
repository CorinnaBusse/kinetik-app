# Batch Kinetik·Monitor — Kinetik-Simulator

Interaktive Live-Simulation einer Reaktion 1. Ordnung für die Lehre:
Edukt → Produkt, Geschwindigkeitskonstante über die Arrhenius-Gleichung
temperaturabhängig, Produktnachweis über das Lambert-Beersche Gesetz.
Bis zu vier Ansätze (Küvetten) laufen nacheinander bei unterschiedlichen
Temperaturen; Messwerte werden verrauscht und können als CSV exportiert
werden.

## Funktionsumfang

- **Kinetik:** dc/dt = −k(T)·c mit k(T) = k₀ · exp(−E_A / (R·T))
  (Arrhenius-Gleichung). Vorgegeben werden der präexponentielle Faktor k₀
  und die Aktivierungsenergie E_A.
- **Extinktion:** E(t) = ε · d · (c_E,0 − c_E(t)) nach dem
  Lambert-Beerschen Gesetz, mit Extinktionskoeffizient ε (L·mol⁻¹·cm⁻¹)
  und Schichtdicke d (cm).
- **Versuchsreihen-Logik:** Startkonzentration c_E,0, k₀, E_A, ε und d
  sind nur vor dem ersten Start einer Versuchsreihe änderbar und werden
  danach gesperrt (erst "Neuer Messlauf" gibt sie wieder frei).
- **Temperatur je Ansatz:** vor dem Start des jeweiligen Ansatzes frei
  wählbar, nach dessen Start fixiert.
- **Bis zu 4 Ansätze (Küvetten):** laufen nacheinander, mit Zeitraffer
  (inkl. Auto-Zeitraffer-Vorschlag) und Live-Visualisierung (Küvette
  färbt sich mit fortschreitendem Umsatz).
- **Messung:** einstellbares Messrauschen (± %) und Messintervall,
  Messpunkte werden im Diagramm als Punkte neben dem Modellverlauf
  dargestellt.
- **Diagramm:** zoombar per Ziehen mit der Maus (Rücksetzen-Button
  erscheint bei aktivem Zoom), deutsche Zahlendarstellung mit Komma.
- **CSV-Export:** Messwerte und Modellkurve pro Ansatz, inkl. Metadaten
  (Parameter, Zeitpunkt), mit Dezimalkomma für Excel (DE).

## Schnellstart

```bash
npm install
npm run dev
```

Dann die angezeigte lokale Adresse (z. B. http://localhost:5173) im Browser öffnen.

## Produktions-Build

```bash
npm run build
```

Erzeugt einen statischen `dist/`-Ordner, der auf jedem Webserver
(oder z. B. Netlify/Vercel) gehostet werden kann.

Details zur Einrichtung in VS Code und zum Deployment: siehe Chat-Anleitung.
