# GPS Location Search - Täielik Arendusplaan

## Ülevaade

GPS Location Search on Assembly Inspector Pro tööriist ehitusplatsil olevate detailide tuvastamiseks ja jälgimiseks GPS abil. Süsteem võimaldab:

1. **Projekti kalibreerimine** - Seostab mudeli koordinaadid GPS koordinaatidega mitme referentspunkti abil
2. **Detailide otsimine** - Otsib paigaldamata detaile cast unit marki järgi
3. **GPS asukoha fikseerimine** - Salvestab detaili füüsilise asukoha platsil
4. **Markerite lisamine** - Lisab asukohapõhised markerid 3D mudelile
5. **Asukoha visualiseerimine** - Näitab detailide asukohti kaardil

---

## 1. Andmebaasi struktuur

### 1.1 Uus tabel: `project_coordinate_settings`

Projekti koordinaatsüsteemi seaded ja kalibreerimispunktid.

```sql
-- Projekti koordinaatsüsteemi seaded
CREATE TABLE IF NOT EXISTS project_coordinate_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL UNIQUE,
  
  -- Koordinaatsüsteemi tüüp
  coordinate_system TEXT NOT NULL DEFAULT 'local',
  -- Valikud:
  -- 'local' - Kohalik süsteem (vajab kalibreerimist)
  -- 'belgian_lambert_72' - EPSG:31370 (Belgia)
  -- 'estonian_lest97' - EPSG:3301 (Eesti)
  -- 'swedish_sweref99' - EPSG:3006 (Rootsi)  
  -- 'finnish_etrs_tm35fin' - EPSG:3067 (Soome)
  -- 'utm_zone_31n' - EPSG:32631 (UTM Zone 31N)
  -- 'utm_zone_32n' - EPSG:32632 (UTM Zone 32N)
  -- 'utm_zone_33n' - EPSG:32633 (UTM Zone 33N)
  -- 'utm_zone_34n' - EPSG:32634 (UTM Zone 34N)
  -- 'utm_zone_35n' - EPSG:32635 (UTM Zone 35N)
  
  -- Riik (UI jaoks)
  country TEXT DEFAULT 'EE',
  -- Valikud: 'EE', 'BE', 'SE', 'FI', 'NL', 'DE', 'FR', 'OTHER'
  
  -- Kalibreerimise staatus
  is_calibrated BOOLEAN DEFAULT FALSE,
  calibration_accuracy DOUBLE PRECISION, -- Arvutatud keskmine viga meetrites
  calibration_points_count INTEGER DEFAULT 0,
  
  -- Transformatsiooni maatriks (arvutatakse kalibreerimispunktide põhjal)
  -- Affine transformation: 6 parameetrit (2D) või 12 parameetrit (3D)
  transform_matrix JSONB,
  -- Struktuur: { 
  --   "type": "affine_2d" | "affine_3d" | "helmert",
  --   "params": { "a": 1, "b": 0, "c": 0, "d": 0, "e": 1, "f": 0, "tx": 0, "ty": 0 },
  --   "rotation_deg": 0,
  --   "scale": 1
  -- }
  
  -- Metadata
  calibrated_at TIMESTAMPTZ,
  calibrated_by TEXT,
  calibrated_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_coord_settings_project ON project_coordinate_settings(trimble_project_id);

-- RLS
ALTER TABLE project_coordinate_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for coordinate_settings" ON project_coordinate_settings
  FOR ALL USING (true) WITH CHECK (true);
```

### 1.2 Uus tabel: `project_calibration_points`

Kalibreerimispunktid - mudeli ja GPS koordinaatide paarid.

```sql
-- Kalibreerimispunktid
CREATE TABLE IF NOT EXISTS project_calibration_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  
  -- Mudeli koordinaadid (millimeters/meters - sõltub mudelist)
  model_x DOUBLE PRECISION NOT NULL,
  model_y DOUBLE PRECISION NOT NULL,
  model_z DOUBLE PRECISION,
  
  -- GPS koordinaadid (WGS84)
  gps_latitude DOUBLE PRECISION NOT NULL,
  gps_longitude DOUBLE PRECISION NOT NULL,
  gps_altitude DOUBLE PRECISION,
  gps_accuracy DOUBLE PRECISION,
  
  -- Viide objektile mudelis (valikuline)
  reference_guid TEXT,
  reference_assembly_mark TEXT,
  reference_description TEXT, -- nt "Hoone NW nurk, post P-001"
  
  -- Arvutatud viga (pärast kalibreerimist)
  calculated_error_m DOUBLE PRECISION,
  
  -- Metadata
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  captured_by TEXT,
  captured_by_name TEXT,
  is_active BOOLEAN DEFAULT TRUE, -- Saab välja lülitada ilma kustutamata
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_calib_points_project ON project_calibration_points(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_calib_points_active ON project_calibration_points(trimble_project_id, is_active);

-- RLS
ALTER TABLE project_calibration_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for calibration_points" ON project_calibration_points
  FOR ALL USING (true) WITH CHECK (true);
```

### 1.3 Uuenda tabelit: `detail_positions`

Lisa uued väljad olemasolevale tabelile.

```sql
-- Lisa uued veerud detail_positions tabelile
ALTER TABLE detail_positions 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS model_x DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS model_y DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS model_z DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS transform_applied BOOLEAN DEFAULT FALSE;

-- source väärtused: 'manual', 'gps_search', 'qr_scan', 'import'

COMMENT ON COLUMN detail_positions.source IS 'Asukoha allikas: manual, gps_search, qr_scan, import';
COMMENT ON COLUMN detail_positions.model_x IS 'Arvutatud mudeli X koordinaat (transformeeritud GPS-ist)';
COMMENT ON COLUMN detail_positions.model_y IS 'Arvutatud mudeli Y koordinaat (transformeeritud GPS-ist)';
COMMENT ON COLUMN detail_positions.model_z IS 'Arvutatud mudeli Z koordinaat (kui saadaval)';
```

### 1.4 Uuenda tabelit: `trimble_ex_users`

Lisa GPS Search õigus.

```sql
-- Lisa GPS search õigus kasutajate tabelisse
ALTER TABLE trimble_ex_users 
  ADD COLUMN IF NOT EXISTS can_access_gps_search BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN trimble_ex_users.can_access_gps_search IS 'Kas kasutaja näeb GPS Location Search tööriista';
```

---

## 2. Koordinaatsüsteemid ja teisendused

### 2.1 Fail: `src/utils/coordinateUtils.ts`

Laienda olemasolevat faili uute koordinaatsüsteemidega.

```typescript
/**
 * Coordinate conversion utilities
 * Supports multiple European coordinate systems
 */

import proj4 from 'proj4';

// ============================================
// KOORDINAATSÜSTEEMIDE DEFINITSIOONID
// ============================================

// Belgian Lambert 72 (EPSG:31370) - Belgia
proj4.defs('EPSG:31370', '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 +lon_0=4.367486666666666 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs');

// Estonian L-EST97 (EPSG:3301) - Eesti
proj4.defs('EPSG:3301', '+proj=lcc +lat_1=59.33333333333334 +lat_2=58 +lat_0=57.51755393055556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// Swedish SWEREF99 TM (EPSG:3006) - Rootsi
proj4.defs('EPSG:3006', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// Finnish ETRS-TM35FIN (EPSG:3067) - Soome
proj4.defs('EPSG:3067', '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// UTM Zones for Central/Western Europe
proj4.defs('EPSG:32631', '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs'); // UTM 31N
proj4.defs('EPSG:32632', '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs'); // UTM 32N
proj4.defs('EPSG:32633', '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs'); // UTM 33N
proj4.defs('EPSG:32634', '+proj=utm +zone=34 +datum=WGS84 +units=m +no_defs'); // UTM 34N
proj4.defs('EPSG:32635', '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs'); // UTM 35N

// Koordinaatsüsteemide kaardistus
export const COORDINATE_SYSTEMS: Record<string, { 
  epsg: string; 
  name: string; 
  country: string;
  description: string;
}> = {
  'belgian_lambert_72': { epsg: 'EPSG:31370', name: 'Belgian Lambert 72', country: 'BE', description: 'Belgia riiklik süsteem' },
  'estonian_lest97': { epsg: 'EPSG:3301', name: 'L-EST97', country: 'EE', description: 'Eesti riiklik süsteem' },
  'swedish_sweref99': { epsg: 'EPSG:3006', name: 'SWEREF99 TM', country: 'SE', description: 'Rootsi riiklik süsteem' },
  'finnish_etrs_tm35fin': { epsg: 'EPSG:3067', name: 'ETRS-TM35FIN', country: 'FI', description: 'Soome riiklik süsteem' },
  'utm_zone_31n': { epsg: 'EPSG:32631', name: 'UTM Zone 31N', country: 'OTHER', description: 'Lääne-Euroopa (3°E - 9°E)' },
  'utm_zone_32n': { epsg: 'EPSG:32632', name: 'UTM Zone 32N', country: 'OTHER', description: 'Kesk-Euroopa (6°E - 12°E)' },
  'utm_zone_33n': { epsg: 'EPSG:32633', name: 'UTM Zone 33N', country: 'OTHER', description: 'Kesk-Euroopa (12°E - 18°E)' },
  'utm_zone_34n': { epsg: 'EPSG:32634', name: 'UTM Zone 34N', country: 'OTHER', description: 'Ida-Euroopa (18°E - 24°E)' },
  'utm_zone_35n': { epsg: 'EPSG:32635', name: 'UTM Zone 35N', country: 'OTHER', description: 'Ida-Euroopa (24°E - 30°E)' },
  'local': { epsg: '', name: 'Kohalik süsteem', country: 'OTHER', description: 'Vajab kalibreerimist' }
};

// Riikide valikud
export const COUNTRIES = [
  { code: 'EE', name: 'Eesti', defaultSystem: 'estonian_lest97' },
  { code: 'BE', name: 'Belgia', defaultSystem: 'belgian_lambert_72' },
  { code: 'SE', name: 'Rootsi', defaultSystem: 'swedish_sweref99' },
  { code: 'FI', name: 'Soome', defaultSystem: 'finnish_etrs_tm35fin' },
  { code: 'NL', name: 'Holland', defaultSystem: 'utm_zone_31n' },
  { code: 'DE', name: 'Saksamaa', defaultSystem: 'utm_zone_32n' },
  { code: 'FR', name: 'Prantsusmaa', defaultSystem: 'utm_zone_31n' },
  { code: 'OTHER', name: 'Muu', defaultSystem: 'local' }
];

// ============================================
// TEISENDUSTE FUNKTSIOONID
// ============================================

export interface GPSCoordinate {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface ModelCoordinate {
  x: number;
  y: number;
  z?: number;
}

/**
 * Teisenda GPS koordinaadid mudeli koordinaatideks
 * Kasutab projekti koordinaatsüsteemi seadeid
 */
export function gpsToModel(
  gps: GPSCoordinate,
  coordinateSystem: string,
  transformMatrix?: AffineTransform
): ModelCoordinate {
  // Kui kohalik süsteem kalibreerimisega
  if (coordinateSystem === 'local' && transformMatrix) {
    return applyInverseTransform(gps, transformMatrix);
  }
  
  // Kui tuntud koordinaatsüsteem
  const system = COORDINATE_SYSTEMS[coordinateSystem];
  if (system && system.epsg) {
    const [x, y] = proj4('WGS84', system.epsg, [gps.longitude, gps.latitude]);
    return { x, y, z: gps.altitude };
  }
  
  throw new Error(`Unknown coordinate system: ${coordinateSystem}`);
}

/**
 * Teisenda mudeli koordinaadid GPS koordinaatideks
 */
export function modelToGps(
  model: ModelCoordinate,
  coordinateSystem: string,
  transformMatrix?: AffineTransform
): GPSCoordinate {
  // Kui kohalik süsteem kalibreerimisega
  if (coordinateSystem === 'local' && transformMatrix) {
    return applyTransform(model, transformMatrix);
  }
  
  // Kui tuntud koordinaatsüsteem
  const system = COORDINATE_SYSTEMS[coordinateSystem];
  if (system && system.epsg) {
    const [longitude, latitude] = proj4(system.epsg, 'WGS84', [model.x, model.y]);
    return { latitude, longitude, altitude: model.z };
  }
  
  throw new Error(`Unknown coordinate system: ${coordinateSystem}`);
}

// ============================================
// AFFINE TRANSFORMATSIOON (KALIBREERIMINE)
// ============================================

export interface AffineTransform {
  type: 'affine_2d' | 'helmert';
  // Affine: [a, b, tx, c, d, ty] -> x' = ax + by + tx, y' = cx + dy + ty
  // Helmert: translation + rotation + scale
  params: {
    a: number;  // scale_x * cos(rotation)
    b: number;  // -scale_x * sin(rotation)
    c: number;  // scale_y * sin(rotation)
    d: number;  // scale_y * cos(rotation)
    tx: number; // translation x
    ty: number; // translation y
  };
  rotation_deg: number;
  scale: number;
  origin: { x: number; y: number }; // Transformatsiooni keskpunkt
}

/**
 * Arvuta affine transformatsioon kalibreerimispunktide põhjal
 * Kasutab vähimruutude meetodit (Least Squares)
 * 
 * @param points Array of { model: ModelCoordinate, gps: GPSCoordinate }
 * @returns AffineTransform or null if not enough points
 */
export function calculateAffineTransform(
  points: Array<{ model: ModelCoordinate; gps: GPSCoordinate }>
): AffineTransform | null {
  if (points.length < 2) {
    return null; // Vaja vähemalt 2 punkti
  }
  
  // Teisenda GPS koordinaadid meetriteks (kasutame UTM zone 31 ajutiselt)
  const gpsInMeters = points.map(p => {
    const [x, y] = proj4('WGS84', 'EPSG:32631', [p.gps.longitude, p.gps.latitude]);
    return { x, y };
  });
  
  // Arvuta keskpunktid
  const modelCenter = {
    x: points.reduce((s, p) => s + p.model.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.model.y, 0) / points.length
  };
  
  const gpsCenter = {
    x: gpsInMeters.reduce((s, p) => s + p.x, 0) / points.length,
    y: gpsInMeters.reduce((s, p) => s + p.y, 0) / points.length
  };
  
  if (points.length === 2) {
    // Kahe punkti korral: arvuta rotation ja scale
    const modelDx = points[1].model.x - points[0].model.x;
    const modelDy = points[1].model.y - points[0].model.y;
    const gpsDx = gpsInMeters[1].x - gpsInMeters[0].x;
    const gpsDy = gpsInMeters[1].y - gpsInMeters[0].y;
    
    const modelDist = Math.sqrt(modelDx * modelDx + modelDy * modelDy);
    const gpsDist = Math.sqrt(gpsDx * gpsDx + gpsDy * gpsDy);
    
    const scale = gpsDist / modelDist;
    
    const modelAngle = Math.atan2(modelDy, modelDx);
    const gpsAngle = Math.atan2(gpsDy, gpsDx);
    const rotation = gpsAngle - modelAngle;
    
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    
    // Translation: GPS_center = scale * R * Model_center + T
    const tx = gpsCenter.x - scale * (cos * modelCenter.x - sin * modelCenter.y);
    const ty = gpsCenter.y - scale * (sin * modelCenter.x + cos * modelCenter.y);
    
    return {
      type: 'helmert',
      params: {
        a: scale * cos,
        b: -scale * sin,
        c: scale * sin,
        d: scale * cos,
        tx,
        ty
      },
      rotation_deg: rotation * 180 / Math.PI,
      scale,
      origin: modelCenter
    };
  }
  
  // 3+ punkti korral: täielik affine (least squares)
  // Lahendame: [x'] = [a b tx] * [x]
  //            [y']   [c d ty]   [y]
  //                              [1]
  
  // Moodustame maatriksid
  // A * params = B
  // Kus A on [x, y, 1] read ja B on [x', y'] veerud
  
  const n = points.length;
  let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0, sumXY = 0;
  let sumXpX = 0, sumXpY = 0, sumYpX = 0, sumYpY = 0;
  let sumXp = 0, sumYp = 0;
  
  for (let i = 0; i < n; i++) {
    const x = points[i].model.x;
    const y = points[i].model.y;
    const xp = gpsInMeters[i].x;
    const yp = gpsInMeters[i].y;
    
    sumX += x;
    sumY += y;
    sumX2 += x * x;
    sumY2 += y * y;
    sumXY += x * y;
    sumXpX += xp * x;
    sumXpY += xp * y;
    sumYpX += yp * x;
    sumYpY += yp * y;
    sumXp += xp;
    sumYp += yp;
  }
  
  // Lahenda normaalvõrrandid
  const det = n * (sumX2 * sumY2 - sumXY * sumXY) 
            - sumX * (sumX * sumY2 - sumY * sumXY) 
            + sumY * (sumX * sumXY - sumY * sumX2);
  
  if (Math.abs(det) < 1e-10) {
    // Singulaarne maatriks - punktid on kollineaarsed
    return null;
  }
  
  // Lihtsustatud lahendus (eeldame scale ≈ sama x ja y suunas)
  const a = (sumXpX * sumY2 - sumXpY * sumXY + sumXp * (sumXY * sumY - sumY2 * sumX) / n) / 
            (sumX2 * sumY2 - sumXY * sumXY - (sumX * sumX * sumY2 - 2 * sumX * sumY * sumXY + sumY * sumY * sumX2) / n);
  
  // Kasuta Helmert transformatsiooni tulemust 2 punkti jaoks
  // ja täpsusta rohkemate punktidega
  
  // Lihtsustame: kasutame esimest 2 punkti baasiks
  const baseTransform = calculateAffineTransform(points.slice(0, 2));
  if (!baseTransform) return null;
  
  // Arvuta keskmine viga ja reguleeri
  let totalError = 0;
  for (const point of points) {
    const predicted = applyTransformInternal(point.model, baseTransform);
    const actual = gpsInMeters[points.indexOf(point)];
    const error = Math.sqrt(
      Math.pow(predicted.x - actual.x, 2) + 
      Math.pow(predicted.y - actual.y, 2)
    );
    totalError += error;
  }
  
  return {
    ...baseTransform,
    // Lisa keskmine viga metaandmetena
  };
}

function applyTransformInternal(
  model: ModelCoordinate, 
  transform: AffineTransform
): { x: number; y: number } {
  const { a, b, c, d, tx, ty } = transform.params;
  return {
    x: a * model.x + b * model.y + tx,
    y: c * model.x + d * model.y + ty
  };
}

/**
 * Rakenda transformatsioon: mudel -> GPS
 */
export function applyTransform(
  model: ModelCoordinate,
  transform: AffineTransform
): GPSCoordinate {
  const result = applyTransformInternal(model, transform);
  
  // Teisenda tagasi WGS84
  const [longitude, latitude] = proj4('EPSG:32631', 'WGS84', [result.x, result.y]);
  
  return { latitude, longitude, altitude: model.z };
}

/**
 * Rakenda pöördtransformatsioon: GPS -> mudel
 */
export function applyInverseTransform(
  gps: GPSCoordinate,
  transform: AffineTransform
): ModelCoordinate {
  // Teisenda GPS meetriteks
  const [x, y] = proj4('WGS84', 'EPSG:32631', [gps.longitude, gps.latitude]);
  
  // Pöördmaatriks: [a b; c d]^-1
  const { a, b, c, d, tx, ty } = transform.params;
  const det = a * d - b * c;
  
  if (Math.abs(det) < 1e-10) {
    throw new Error('Singular transform matrix');
  }
  
  // Pöördmaatriks
  const ai = d / det;
  const bi = -b / det;
  const ci = -c / det;
  const di = a / det;
  
  // x' - tx, y' - ty
  const xShifted = x - tx;
  const yShifted = y - ty;
  
  return {
    x: ai * xShifted + bi * yShifted,
    y: ci * xShifted + di * yShifted,
    z: gps.altitude
  };
}

/**
 * Arvuta kalibreerimise täpsus (RMSE)
 */
export function calculateCalibrationError(
  points: Array<{ model: ModelCoordinate; gps: GPSCoordinate }>,
  transform: AffineTransform
): { rmse: number; maxError: number; errors: number[] } {
  const errors: number[] = [];
  
  for (const point of points) {
    const predicted = applyTransform(point.model, transform);
    const error = gpsDistance(predicted, point.gps);
    errors.push(error);
  }
  
  const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
  const maxError = Math.max(...errors);
  
  return { rmse, maxError, errors };
}
```

---

## 3. Komponentide struktuur

### 3.1 Uued komponendid

```
src/components/
├── GpsLocationSearchModal.tsx      # Põhiaken detailide otsimiseks ja GPS fikseerimiseks
├── ProjectCalibrationPanel.tsx     # Admin paneeli osa - kalibreerimise seadistamine
├── CalibrationPointCapture.tsx     # Popup GPS punkti salvestamiseks (avaneb eraldi aknas)
└── hooks/
    └── useGpsTracking.ts           # GPS jälgimise hook
```

### 3.2 Muudetavad komponendid

```
src/components/
├── AdminScreen.tsx                 # Lisa "Koordinaatsüsteem" ja "Kalibreerimine" sektsioonid
├── ToolsScreen.tsx                 # Lisa "GPS Location Search" nupp (peidetud)
└── supabase.ts                     # Lisa uued tüübid
```

---

## 4. Komponent: ProjectCalibrationPanel

See komponent lisatakse AdminScreen'i ja võimaldab:
- Valida riigi ja koordinaatsüsteemi
- Lisada kalibreerimispunkte
- Näha kalibreerimise täpsust
- Testida transformatsiooni

```typescript
// src/components/ProjectCalibrationPanel.tsx

interface ProjectCalibrationPanelProps {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  user: TrimbleExUser;
}

// State:
// - coordinateSystem: string
// - country: string
// - calibrationPoints: CalibrationPoint[]
// - isCalibrated: boolean
// - calibrationAccuracy: number | null
// - pickingMode: 'off' | 'picking'
// - selectedModelPoint: { x, y, z } | null

// Töövoog:
// 1. Kasutaja valib riigi -> süsteem soovitab koordinaatsüsteemi
// 2. Kui "Kohalik süsteem":
//    a. Kasutaja valib mudelist objekti (nt post)
//    b. Süsteem salvestab mudeli koordinaadid
//    c. Avaneb CalibrationPointCapture popup GPS koordinaatide jaoks
//    d. Kasutaja kinnitab GPS positsiooni
//    e. Punkt salvestatakse andmebaasi
//    f. Korrake 2+ punkti jaoks
// 3. Kui 2+ punkti olemas -> arvuta transformatsioon
// 4. Näita kalibreerimise täpsust ja viga iga punkti kohta
```

### 4.1 UI struktuur AdminScreen'is

```
┌─────────────────────────────────────────────────────┐
│ ⚙️ Koordinaatsüsteem ja kalibreerimine              │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Riik: [🇪🇪 Eesti        ▼]                          │
│                                                     │
│ Koordinaatsüsteem: [L-EST97 (EPSG:3301)  ▼]        │
│                    ☑ Kohalik süsteem (vajab         │
│                      kalibreerimist)                │
│                                                     │
├─────────────────────────────────────────────────────┤
│ 📍 Kalibreerimispunktid                             │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ #  │ Kirjeldus      │ Mudel        │ GPS       ││ │
│ ├────┼────────────────┼──────────────┼───────────┤│ │
│ │ 1  │ NW nurk P-001  │ 0, 0, 0      │ 58.12°N  ││ │
│ │    │                │              │ 24.55°E  ││ │
│ │    │                │              │ ±3m ✓    ││ │
│ ├────┼────────────────┼──────────────┼───────────┤│ │
│ │ 2  │ SE nurk P-045  │ 120.5, 85.2  │ 58.11°N  ││ │
│ │    │                │              │ 24.56°E  ││ │
│ │    │                │              │ ±5m ✓    ││ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ [+ Lisa kalibreerimispunkt]                         │
│                                                     │
├─────────────────────────────────────────────────────┤
│ 📊 Kalibreerimise täpsus                            │
│                                                     │
│ Staatus: ✅ Kalibreeritud                           │
│ Keskmine viga: 2.3m                                 │
│ Maksimaalne viga: 4.1m                              │
│ Pööre: 12.5°                                        │
│ Skaala: 1.0002                                      │
│                                                     │
│ [🔄 Arvuta uuesti] [🧪 Testi koordinaate]           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 5. Komponent: CalibrationPointCapture

Eraldi popup aken GPS koordinaatide salvestamiseks. Avaneb kui kasutaja on mudelist punkti valinud.

```typescript
// src/components/CalibrationPointCapture.tsx

// URL parameetrid:
// ?popup=calibration
// &projectId=xxx
// &modelX=123.45
// &modelY=67.89
// &modelZ=0
// &guid=xxx (valikuline)
// &mark=P-001 (valikuline)
// &description=NW%20nurk (valikuline)

// Komponendi funktsioon:
// 1. Näita GPS staatust reaalajas
// 2. Kasutaja seisab täpselt punkti peal
// 3. Vajutab "Fikseeri asukoht"
// 4. Salvestab andmebaasi
// 5. Sulgeb akna ja teavitab parent'i (postMessage)
```

### 5.1 UI

```
┌─────────────────────────────────────────┐
│ 📍 Kalibreerimispunkti salvestamine     │
├─────────────────────────────────────────┤
│                                         │
│ Mudeli punkt:                           │
│ X: 123.45 m                             │
│ Y: 67.89 m                              │
│ Z: 0.00 m                               │
│                                         │
│ Objekt: P-001 (Post NW nurk)            │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│ 🟢 GPS signaal: Hea                     │
│                                         │
│ Koordinaadid:                           │
│ 58.123456°N, 24.554321°E                │
│                                         │
│ Täpsus: ±3m                             │
│ Viimane uuendus: 2 sek tagasi           │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│ Kirjeldus: [Hoone NW nurk, post P-001]  │
│                                         │
│ [        ✅ Fikseeri asukoht        ]   │
│                                         │
│ [Tühista]                               │
│                                         │
└─────────────────────────────────────────┘
```

---

## 6. Komponent: GpsLocationSearchModal

Põhikomponent detailide otsimiseks ja GPS asukohtade salvestamiseks.

### 6.1 Funktsioonid

1. **Detailide laadimine** - Laeb paigaldamata detailid andmebaasist
2. **Otsing** - Cast unit mark ja product name järgi
3. **GPS fikseerimine** - Salvestab kasutaja praeguse GPS asukoha detaili juurde
4. **Koordinaatide teisendamine** - Kasutab projekti kalibreerimist GPS -> mudel teisenduseks
5. **Markerite lisamine** - Loob text markup'id mudelile
6. **Kaardi vaade** - Avab asukoha Google Maps'is

### 6.2 UI

```
┌─────────────────────────────────────────────────────────────────┐
│ 📍 GPS Location Search                                      [X] │
├─────────────────────────────────────────────────────────────────┤
│ 🟢 58.123456, 24.554321 | ±5m | Uuendatud: 2s tagasi           │
├─────────────────────────────────────────────────────────────────┤
│ 🔍 [Otsi cast unit marki või product name...              ]     │
│                                                                 │
│ Kokku: 234 | Positsioneeritud: 45 | Valitud: 3                 │
├─────────────────────────────────────────────────────────────────┤
│ ☐ │ Cast Unit Mark │ Product Name    │ GPS      │ Tegevus      │
│───┼────────────────┼─────────────────┼──────────┼──────────────│
│ ☐ │ D3BEA46        │ WALL_PANEL_200  │ —        │ [📍 Fikseeri]│
│ ☑ │ D3BEA47        │ COLUMN_400      │ ✓ ±5m    │ [🗺️ Kaart]  │
│ ☐ │ D3BEA48        │ BEAM_IPE300     │ —        │ [📍 Fikseeri]│
│ ☑ │ D3BEA49        │ SLAB_200        │ ✓ ±3m    │ [🗺️ Kaart]  │
│ ...                                                             │
├─────────────────────────────────────────────────────────────────┤
│ 3 detaili valitud                    [Tühista] [🏷️ Lisa marker]│
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Hook: useGpsTracking

```typescript
// src/hooks/useGpsTracking.ts

interface GpsState {
  position: {
    latitude: number;
    longitude: number;
    altitude?: number;
    accuracy: number;
    timestamp: number;
  } | null;
  error: string | null;
  isWatching: boolean;
  signalQuality: 'good' | 'fair' | 'poor' | 'none';
}

export function useGpsTracking(options?: {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}): GpsState & {
  startWatching: () => void;
  stopWatching: () => void;
  getCurrentPosition: () => Promise<GeolocationPosition>;
}
```

---

## 8. Integratsioon AdminScreen'i

### 8.1 Lisa uus vaade adminView'sse

```typescript
// AdminScreen.tsx

const [adminView, setAdminView] = useState<
  'main' | 'properties' | ... | 'coordinateSettings'
>('main');
```

### 8.2 Lisa nupp peamenüüsse

```typescript
// Admin menüüs
<button onClick={() => setAdminView('coordinateSettings')}>
  <FiMapPin /> Koordinaatsüsteem
</button>
```

### 8.3 Lisa ProjectCalibrationPanel

```typescript
{adminView === 'coordinateSettings' && (
  <ProjectCalibrationPanel
    api={api}
    projectId={projectId}
    user={user}
  />
)}
```

---

## 9. Integratsioon ToolsScreen'i

### 9.1 Lisa peidetud nupp

```typescript
// ToolsScreen.tsx

// Näita ainult kui kasutajal on õigus
{(isAdmin || user.can_access_gps_search) && (
  <button
    onClick={() => setShowGpsSearch(true)}
    style={{
      // Peidetud stiil - võib-olla väiksem, hallis toonis
    }}
  >
    <FiMapPin /> GPS Location Search
  </button>
)}

{showGpsSearch && (
  <GpsLocationSearchModal
    api={api}
    user={user}
    projectId={projectId}
    onClose={() => setShowGpsSearch(false)}
  />
)}
```

---

## 10. Tõlked

### 10.1 `src/i18n/locales/et/tools.json`

```json
{
  "gpsSearch": {
    "title": "GPS Location Search",
    "description": "Otsi ja fikseeri detailide GPS asukohad",
    "gpsStatus": {
      "good": "Hea signaal",
      "fair": "Nõrk signaal", 
      "poor": "Halb signaal",
      "none": "Signaal puudub"
    },
    "accuracy": "Täpsus",
    "lastUpdate": "Viimane uuendus",
    "searchPlaceholder": "Otsi cast unit marki või product name...",
    "total": "Kokku",
    "positioned": "Positsioneeritud",
    "selected": "Valitud",
    "fixPosition": "Fikseeri",
    "openMap": "Kaart",
    "addMarkers": "Lisa markerid",
    "clearSelection": "Tühista valik",
    "positionSaved": "Asukoht salvestatud",
    "markersAdded": "markerit lisatud",
    "noGpsSignal": "GPS signaal puudub",
    "selectPositioned": "Vali vähemalt üks positsioneeritud detail"
  },
  "calibration": {
    "title": "Koordinaatsüsteem ja kalibreerimine",
    "country": "Riik",
    "coordinateSystem": "Koordinaatsüsteem",
    "localSystem": "Kohalik süsteem (vajab kalibreerimist)",
    "calibrationPoints": "Kalibreerimispunktid",
    "addPoint": "Lisa kalibreerimispunkt",
    "pickFromModel": "Vali mudelist",
    "captureGps": "Salvesta GPS",
    "description": "Kirjeldus",
    "modelCoords": "Mudeli koordinaadid",
    "gpsCoords": "GPS koordinaadid",
    "accuracy": "Täpsus",
    "status": {
      "title": "Kalibreerimise staatus",
      "notCalibrated": "Pole kalibreeritud",
      "calibrated": "Kalibreeritud",
      "needsMorePoints": "Vaja veel {count} punkti"
    },
    "error": {
      "rmse": "Keskmine viga",
      "max": "Maksimaalne viga"
    },
    "rotation": "Pööre",
    "scale": "Skaala",
    "recalculate": "Arvuta uuesti",
    "testCoordinates": "Testi koordinaate"
  }
}
```

### 10.2 `src/i18n/locales/en/tools.json`

```json
{
  "gpsSearch": {
    "title": "GPS Location Search",
    "description": "Search and fix GPS locations of details",
    "gpsStatus": {
      "good": "Good signal",
      "fair": "Fair signal",
      "poor": "Poor signal",
      "none": "No signal"
    },
    "accuracy": "Accuracy",
    "lastUpdate": "Last update",
    "searchPlaceholder": "Search by cast unit mark or product name...",
    "total": "Total",
    "positioned": "Positioned",
    "selected": "Selected",
    "fixPosition": "Fix position",
    "openMap": "Map",
    "addMarkers": "Add markers",
    "clearSelection": "Clear selection",
    "positionSaved": "Position saved",
    "markersAdded": "markers added",
    "noGpsSignal": "No GPS signal",
    "selectPositioned": "Select at least one positioned detail"
  },
  "calibration": {
    "title": "Coordinate System & Calibration",
    "country": "Country",
    "coordinateSystem": "Coordinate System",
    "localSystem": "Local system (requires calibration)",
    "calibrationPoints": "Calibration Points",
    "addPoint": "Add calibration point",
    "pickFromModel": "Pick from model",
    "captureGps": "Capture GPS",
    "description": "Description",
    "modelCoords": "Model coordinates",
    "gpsCoords": "GPS coordinates",
    "accuracy": "Accuracy",
    "status": {
      "title": "Calibration Status",
      "notCalibrated": "Not calibrated",
      "calibrated": "Calibrated",
      "needsMorePoints": "Need {count} more points"
    },
    "error": {
      "rmse": "Mean error",
      "max": "Maximum error"
    },
    "rotation": "Rotation",
    "scale": "Scale",
    "recalculate": "Recalculate",
    "testCoordinates": "Test coordinates"
  }
}
```

---

## 11. Arenduse järjekord

### Faas 1: Põhiinfrastruktuur (4-5h)

1. [ ] Andmebaasi migratsioonid
   - `project_coordinate_settings` tabel
   - `project_calibration_points` tabel
   - `detail_positions` uuendused
   - `trimble_ex_users` uuendus
   
2. [ ] `coordinateUtils.ts` laiendamine
   - Kõik koordinaatsüsteemid
   - Affine transformatsiooni arvutus
   - Teisenduste funktsioonid

3. [ ] `useGpsTracking` hook
   
4. [ ] Tüüpide lisamine `supabase.ts`

### Faas 2: Kalibreerimise süsteem (4-5h)

5. [ ] `ProjectCalibrationPanel` komponent
   - Riigi ja süsteemi valik
   - Punktide nimekiri
   - Täpsuse näitamine

6. [ ] `CalibrationPointCapture` popup
   - GPS jälgimine
   - Punkti salvestamine

7. [ ] AdminScreen integratsioon
   - Uus vaade
   - Navigatsioon

### Faas 3: GPS Location Search (4-5h)

8. [ ] `GpsLocationSearchModal` komponent
   - Detailide laadimine
   - Otsing ja filtreerimine
   - GPS fikseerimine
   - Koordinaatide teisendamine

9. [ ] Markerite süsteem
   - Text markup loomine
   - Mudeli koordinaatide arvutamine

10. [ ] ToolsScreen integratsioon
    - Peidetud nupp
    - Õiguste kontroll

### Faas 4: Viimistlus (2-3h)

11. [ ] Tõlked (ET/EN)
12. [ ] Testimine erinevate projektidega
13. [ ] Offline režiimi tugi (valikuline)
14. [ ] Dokumentatsioon

---

## 12. Testimine

### 12.1 Kalibreerimise test

1. Loo uus projekt "local" süsteemiga
2. Lisa 2 kalibreerimispunkti
3. Kontrolli transformatsiooni parameetreid
4. Lisa 3. punkt ja kontrolli täpsust
5. Testi koordinaatide teisendamist

### 12.2 GPS Search test

1. Ava GPS Location Search
2. Kontrolli GPS staatust
3. Otsi detaili
4. Fikseeri asukoht
5. Lisa marker mudelile
6. Kontrolli markeri asukohta

### 12.3 Erinevad koordinaatsüsteemid

1. Testi Belgian Lambert 72 projektiga
2. Testi L-EST97 projektiga
3. Testi kohaliku süsteemiga (kalibreerimine)

---

## 13. Märkused arendajale

### 13.1 Mudeli koordinaadid

Trimble Connect mudeli koordinaadid võivad olla:
- Millimeetrites (Tekla)
- Meetrites (IFC)
- Muudes ühikutes

Kontrolli mudeli ühikuid enne transformatsiooni rakendamist.

### 13.2 GPS täpsus

- Telefoni GPS täpsus on tavaliselt 3-15m
- Hoonete sees võib olla palju halvem
- Kasuta ainult "good" või "fair" signaali korral

### 13.3 Kalibreerimispunktide valik

Soovitused kasutajale:
- Vali punktid hoone eri nurkadest (diagonaal)
- Seisa täpselt objekti kohal
- Oota kuni GPS stabiliseerub
- Lisa vähemalt 3 punkti parema täpsuse jaoks

### 13.4 Markup API

```typescript
// Trimble markup text lisamine
await api.markup.addMarkups([{
  type: 'text',
  position: { x, y, z },  // Mudeli koordinaadid
  label: 'D3BEA46\n📍 58.12°N, 24.55°E\n±5m',
  style: {
    color: { r: 0, g: 100, b: 200 },
    leaderHeight: 100 // cm
  }
}]);
```

---

## 14. Failide nimekiri

### Uued failid
- `supabase/migrations/20260126_gps_location_search.sql`
- `src/components/GpsLocationSearchModal.tsx`
- `src/components/ProjectCalibrationPanel.tsx`
- `src/components/CalibrationPointCapture.tsx`
- `src/hooks/useGpsTracking.ts`

### Muudetavad failid
- `src/utils/coordinateUtils.ts` - lisa koordinaatsüsteemid
- `src/supabase.ts` - lisa tüübid
- `src/components/AdminScreen.tsx` - lisa kalibreerimise sektsioon
- `src/components/ToolsScreen.tsx` - lisa GPS Search nupp
- `src/i18n/locales/et/tools.json` - tõlked
- `src/i18n/locales/en/tools.json` - tõlked
- `src/App.tsx` - versioon

---

## 15. Versioon

Uuenda versioon:
- `src/App.tsx`: `APP_VERSION = '3.2.0'`
- `package.json`: `"version": "3.2.0"`

Commit message:
```
v3.2.0: GPS Location Search - detailide asukoha tuvastamine ja kalibreerimine

- Lisa projekti koordinaatsüsteemi seaded (BE, EE, SE, FI, UTM)
- Lisa kalibreerimissüsteem kohalike koordinaatide jaoks
- Lisa GPS Location Search tööriist detailide otsimiseks
- Lisa GPS asukohtade fikseerimine ja markerite loomine
- Lisa useGpsTracking hook
```
