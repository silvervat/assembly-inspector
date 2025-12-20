# Tarne Graafik (Delivery Schedule) - Põhjalik Tegevuskava

## Versiooni info
- **Praegune versioon:** 2.20.2
- **Uus versioon:** 3.0.0 (suur uuendus)
- **Kuupäev:** 2025-12-20

---

## 1. ÜLEVAADE

### 1.1 Funktsionaalsuse kirjeldus
Tarne graafik on uus moodul peamenüüs, mis võimaldab planeerida ja jälgida detailide tarnet objektile veokite kaupa. Erinevalt paigaldusgraafikust (mis keskendub paigaldamisele) keskendub tarne graafik logistikale ja koormate haldamisele.

### 1.2 Peamised erinevused Paigaldusgraafikust

| Aspekt | Paigaldusgraafik | Tarne Graafik |
|--------|------------------|---------------|
| Hierarhia | Päev → Detailid | Päev → Veokid → Detailid |
| Mahalaadimise masinad | Kraana, Teleskoop, Tõstuk, Käsitsi | Kraana, Teleskoop, Käsitsi |
| Töötajad | Troppija, Monteerija, Keevitaja | Taasnik, Keevitaja |
| Grupeerimise alus | Päev | Päev + Veok (tehas) |
| Mahalaetakse | Detailide kaupa | Veokite kaupa |
| Alternatiivne vaade | - | Tehaste järgi |
| Muudatuste logi | - | Täielik ajalugu |

### 1.3 Tehased ja veokid
```
Tehas: Obornik    → Lühend: OPO → Veokid: OPO1, OPO2, OPO3...
Tehas: Solid      → Lühend: SOL → Veokid: SOL1, SOL2, SOL3...
Tehas: [Muu]      → Lühend: XXX → Veokid: XXX1, XXX2, XXX3...
```

---

## 2. ANDMEBAASI ARHITEKTUUR

### 2.1 Uued tabelid

#### 2.1.1 `trimble_delivery_factories` - Tehaste register
```sql
CREATE TABLE trimble_delivery_factories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,           -- "Obornik", "Solid"
  factory_code TEXT NOT NULL,           -- "OPO", "SOL" (lühend veokite jaoks)
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,

  CONSTRAINT unique_factory_per_project UNIQUE (project_id, factory_code)
);
```

#### 2.1.2 `trimble_delivery_vehicles` - Veokite register
```sql
CREATE TABLE trimble_delivery_vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  factory_id UUID REFERENCES trimble_delivery_factories(id) ON DELETE CASCADE,
  vehicle_number INTEGER NOT NULL,       -- 1, 2, 3...
  vehicle_code TEXT NOT NULL,            -- "OPO1", "OPO2" (genereeritakse automaatselt)
  scheduled_date DATE NOT NULL,          -- Mis kuupäeval see veok tuleb

  -- Mahalaadimise meetodid
  unload_methods JSONB DEFAULT NULL,     -- {crane: 1, telescopic: 2, manual: 0}

  -- Ressursid
  resources JSONB DEFAULT NULL,          -- {taasnik: 2, keevitaja: 1}

  -- Staatused
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'loading', 'transit', 'arrived', 'unloading', 'completed', 'cancelled')),

  -- Statistika (arvutatakse triggeriga)
  item_count INTEGER DEFAULT 0,
  total_weight DECIMAL(12,2) DEFAULT 0,

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,

  CONSTRAINT unique_vehicle_per_date UNIQUE (project_id, factory_id, vehicle_number, scheduled_date)
);
```

#### 2.1.3 `trimble_delivery_items` - Tarne detailid
```sql
CREATE TABLE trimble_delivery_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,

  -- Trimble Connect identifikaatorid
  model_id TEXT,
  guid TEXT NOT NULL,
  guid_ifc TEXT,
  guid_ms TEXT,
  object_runtime_id INTEGER,
  trimble_product_id TEXT,               -- Trimble Connect Product ID!

  -- Detaili info
  assembly_mark TEXT NOT NULL,
  product_name TEXT,
  file_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_position_code TEXT,

  -- Tarne info
  scheduled_date DATE NOT NULL,          -- Planeeritud kuupäev
  sort_order INTEGER DEFAULT 0,

  -- Staatused
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'loaded', 'in_transit', 'delivered', 'cancelled')),

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,

  CONSTRAINT unique_delivery_item UNIQUE (project_id, guid)
);
```

#### 2.1.4 `trimble_delivery_history` - Muudatuste ajalugu
```sql
CREATE TABLE trimble_delivery_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,

  -- Muudatuse tüüp
  change_type TEXT NOT NULL CHECK (change_type IN (
    'created',           -- Esmakordselt lisatud
    'date_changed',      -- Kuupäev muutus
    'vehicle_changed',   -- Veok muutus
    'status_changed',    -- Staatus muutus
    'removed',           -- Eemaldatud koormast
    'daily_snapshot'     -- Päevalõpu hetktõmmis
  )),

  -- Vana väärtus
  old_date DATE,
  old_vehicle_id UUID,
  old_vehicle_code TEXT,
  old_status TEXT,

  -- Uus väärtus
  new_date DATE,
  new_vehicle_id UUID,
  new_vehicle_code TEXT,
  new_status TEXT,

  -- Meta
  change_reason TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Päevalõpu snapshot flag
  is_snapshot BOOLEAN DEFAULT false,
  snapshot_date DATE
);

CREATE INDEX idx_delivery_history_item ON trimble_delivery_history(item_id);
CREATE INDEX idx_delivery_history_vehicle ON trimble_delivery_history(vehicle_id);
CREATE INDEX idx_delivery_history_date ON trimble_delivery_history(changed_at);
CREATE INDEX idx_delivery_history_snapshot ON trimble_delivery_history(is_snapshot, snapshot_date);
```

#### 2.1.5 `trimble_delivery_comments` - Kommentaarid
```sql
CREATE TABLE trimble_delivery_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,

  -- Kommentaari sihtmärk (üks neist)
  delivery_item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE CASCADE,
  delivery_date DATE,

  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT delivery_comment_target_check CHECK (
    (delivery_item_id IS NOT NULL AND vehicle_id IS NULL AND delivery_date IS NULL) OR
    (delivery_item_id IS NULL AND vehicle_id IS NOT NULL AND delivery_date IS NULL) OR
    (delivery_item_id IS NULL AND vehicle_id IS NULL AND delivery_date IS NOT NULL)
  )
);

CREATE INDEX idx_delivery_comments_item ON trimble_delivery_comments(delivery_item_id);
CREATE INDEX idx_delivery_comments_vehicle ON trimble_delivery_comments(vehicle_id);
CREATE INDEX idx_delivery_comments_date ON trimble_delivery_comments(delivery_date);
```

### 2.2 Triggerid ja funktsioonid

#### 2.2.1 Veoki statistika uuendamine
```sql
-- Funktsioon veoki statistika arvutamiseks
CREATE OR REPLACE FUNCTION update_vehicle_statistics()
RETURNS TRIGGER AS $$
BEGIN
  -- Uuenda vana veoki statistikat (kui veok muutus)
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS NOT NULL AND OLD.vehicle_id != NEW.vehicle_id THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (
        SELECT COUNT(*) FROM trimble_delivery_items
        WHERE vehicle_id = OLD.vehicle_id
      ),
      total_weight = (
        SELECT COALESCE(SUM(CAST(NULLIF(cast_unit_weight, '') AS DECIMAL)), 0)
        FROM trimble_delivery_items
        WHERE vehicle_id = OLD.vehicle_id
      ),
      updated_at = NOW()
    WHERE id = OLD.vehicle_id;
  END IF;

  -- Uuenda uue veoki statistikat
  IF NEW.vehicle_id IS NOT NULL THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (
        SELECT COUNT(*) FROM trimble_delivery_items
        WHERE vehicle_id = NEW.vehicle_id
      ),
      total_weight = (
        SELECT COALESCE(SUM(CAST(NULLIF(cast_unit_weight, '') AS DECIMAL)), 0)
        FROM trimble_delivery_items
        WHERE vehicle_id = NEW.vehicle_id
      ),
      updated_at = NOW()
    WHERE id = NEW.vehicle_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_vehicle_stats
AFTER INSERT OR UPDATE OF vehicle_id, cast_unit_weight OR DELETE
ON trimble_delivery_items
FOR EACH ROW
EXECUTE FUNCTION update_vehicle_statistics();
```

#### 2.2.2 Ajaloo logimine
```sql
-- Funktsioon muudatuste logimiseks
CREATE OR REPLACE FUNCTION log_delivery_item_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Kuupäeva muutus
  IF TG_OP = 'UPDATE' AND OLD.scheduled_date != NEW.scheduled_date THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      old_date, new_date, old_vehicle_code, new_vehicle_code, changed_by
    )
    SELECT
      NEW.project_id, NEW.id, NEW.vehicle_id, 'date_changed',
      OLD.scheduled_date, NEW.scheduled_date,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = OLD.vehicle_id),
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      NEW.updated_by;
  END IF;

  -- Veoki muutus
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.vehicle_id::text, '') != COALESCE(NEW.vehicle_id::text, '') THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      old_vehicle_id, new_vehicle_id, old_vehicle_code, new_vehicle_code, changed_by
    )
    SELECT
      NEW.project_id, NEW.id, NEW.vehicle_id, 'vehicle_changed',
      OLD.vehicle_id, NEW.vehicle_id,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = OLD.vehicle_id),
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      NEW.updated_by;
  END IF;

  -- Staatuse muutus
  IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      old_status, new_status, changed_by
    )
    VALUES (
      NEW.project_id, NEW.id, NEW.vehicle_id, 'status_changed',
      OLD.status, NEW.status, NEW.updated_by
    );
  END IF;

  -- Uue kirje loomine
  IF TG_OP = 'INSERT' THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      new_date, new_vehicle_id, new_vehicle_code, new_status, changed_by
    )
    SELECT
      NEW.project_id, NEW.id, NEW.vehicle_id, 'created',
      NEW.scheduled_date, NEW.vehicle_id,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      NEW.status, NEW.created_by;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_delivery_changes
AFTER INSERT OR UPDATE
ON trimble_delivery_items
FOR EACH ROW
EXECUTE FUNCTION log_delivery_item_changes();
```

#### 2.2.3 Päevalõpu hetktõmmis (cron job funktsioon)
```sql
-- Funktsioon päevalõpu hetktõmmise tegemiseks
CREATE OR REPLACE FUNCTION create_daily_delivery_snapshot()
RETURNS void AS $$
DECLARE
  item_record RECORD;
BEGIN
  FOR item_record IN
    SELECT
      di.id, di.project_id, di.vehicle_id, di.scheduled_date, di.status,
      dv.vehicle_code
    FROM trimble_delivery_items di
    LEFT JOIN trimble_delivery_vehicles dv ON dv.id = di.vehicle_id
    WHERE di.updated_at::date = CURRENT_DATE
  LOOP
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      new_date, new_vehicle_id, new_vehicle_code, new_status,
      is_snapshot, snapshot_date, changed_by
    )
    VALUES (
      item_record.project_id, item_record.id, item_record.vehicle_id, 'daily_snapshot',
      item_record.scheduled_date, item_record.vehicle_id, item_record.vehicle_code, item_record.status,
      true, CURRENT_DATE, 'SYSTEM'
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

---

## 3. TYPESCRIPT TÜÜBID

### 3.1 Uued interface'id (supabase.ts)

```typescript
// Tehaste tabel
export interface DeliveryFactory {
  id: string;
  project_id: string;
  factory_name: string;
  factory_code: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  created_by: string;
}

// Veokite tabel
export interface DeliveryVehicle {
  id: string;
  project_id: string;
  factory_id: string;
  vehicle_number: number;
  vehicle_code: string;
  scheduled_date: string;
  unload_methods?: UnloadMethods;
  resources?: DeliveryResources;
  status: 'planned' | 'loading' | 'transit' | 'arrived' | 'unloading' | 'completed' | 'cancelled';
  item_count: number;
  total_weight: number;
  notes?: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by?: string;
  // Joined data
  factory?: DeliveryFactory;
}

// Mahalaadimise meetodid
export interface UnloadMethods {
  crane?: number;      // Kraana
  telescopic?: number; // Teleskooplaadur
  manual?: number;     // Käsitsi
}

// Ressursid
export interface DeliveryResources {
  taasnik?: number;    // Taasnikud
  keevitaja?: number;  // Keevitajad
}

// Detailid
export interface DeliveryItem {
  id: string;
  project_id: string;
  vehicle_id?: string;
  model_id?: string;
  guid: string;
  guid_ifc?: string;
  guid_ms?: string;
  object_runtime_id?: number;
  trimble_product_id?: string;
  assembly_mark: string;
  product_name?: string;
  file_name?: string;
  cast_unit_weight?: string;
  cast_unit_position_code?: string;
  scheduled_date: string;
  sort_order: number;
  status: 'planned' | 'loaded' | 'in_transit' | 'delivered' | 'cancelled';
  notes?: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by?: string;
  // Joined data
  vehicle?: DeliveryVehicle;
}

// Ajalugu
export interface DeliveryHistory {
  id: string;
  project_id: string;
  item_id: string;
  vehicle_id?: string;
  change_type: 'created' | 'date_changed' | 'vehicle_changed' | 'status_changed' | 'removed' | 'daily_snapshot';
  old_date?: string;
  old_vehicle_id?: string;
  old_vehicle_code?: string;
  old_status?: string;
  new_date?: string;
  new_vehicle_id?: string;
  new_vehicle_code?: string;
  new_status?: string;
  change_reason?: string;
  changed_by: string;
  changed_at: string;
  is_snapshot: boolean;
  snapshot_date?: string;
}

// Kommentaarid
export interface DeliveryComment {
  id: string;
  project_id: string;
  delivery_item_id?: string;
  vehicle_id?: string;
  delivery_date?: string;
  comment_text: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
}
```

---

## 4. UI KOMPONENTIDE STRUKTUUR

### 4.1 DeliveryScheduleScreen komponendi ülesehitus

```
DeliveryScheduleScreen/
├── Header (tagasi nupp, pealkiri, tööriistad)
│   ├── Otsing
│   ├── Vaate vahetaja (Päevade/Tehaste järgi)
│   └── Tööriistariba (eksport, import, seaded)
│
├── Calendar (sarnane paigaldusgraafikuga)
│   └── Kuu vaade detailide/veokite arvuga päeva kohta
│
├── ContentArea
│   ├── [Vaade 1: Päevade järgi]
│   │   └── DateGroup (kokkupandav)
│   │       ├── DateHeader (kuupäev, nädalapäev, statistika)
│   │       └── VehicleGroup (kokkupandav)
│   │           ├── VehicleHeader (OPO1, tehas, detailid, kg, staatus)
│   │           ├── UnloadMethods (kraana, teleskoop, käsitsi)
│   │           ├── Resources (taasnikud, keevitajad)
│   │           └── ItemList
│   │               └── DeliveryItemRow
│   │
│   └── [Vaade 2: Tehaste järgi]
│       └── FactoryGroup (kokkupandav)
│           ├── FactoryHeader (Obornik, Solid)
│           └── VehiclesByFactory
│               └── VehicleGroup
│                   ├── VehicleHeader
│                   └── DateGroup
│                       └── ItemList
│
├── Modals
│   ├── AddItemsModal (detailide lisamine)
│   ├── VehicleSettingsModal (veoki seaded, ressursid)
│   ├── MoveItemsModal (ümber tõstmine)
│   ├── HistoryModal (ajaloo vaatamine)
│   ├── ImportModal (GUID import)
│   └── ExportSettingsModal
│
└── Playback Controls
    └── Mahalaetakse veokite kaupa (mitte detailide kaupa)
```

### 4.2 Veoki kaart (VehicleCard)

```
┌─────────────────────────────────────────────────────────────┐
│ ▼ OPO1                           12 detaili  |  4,520 kg    │
│   Obornik                        [🚛 Plaanitud]             │
├─────────────────────────────────────────────────────────────┤
│ Mahalaadimine:  [🏗️ Kraana: 1] [🚜 Teleskoop: 2] [✋ Käsitsi]│
│ Ressursid:      [👷 Taasnik: 2] [🔧 Keevitaja: 1]           │
├─────────────────────────────────────────────────────────────┤
│   □ Assembly Mark    | Toode        | Asukoht  | Kaal       │
│   ├─ E-123-A         | HI400x300    | B2-3     | 850 kg     │
│   ├─ E-123-B         | HI400x300    | B2-4     | 920 kg     │
│   └─ E-124-A         | HI350x250    | B3-1     | 780 kg     │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. FUNKTSIONAALSUSED

### 5.1 Detailide lisamine

1. Kasutaja valib mudelist detailid
2. Vajutab "Lisa graafikule"
3. Avaneb modal:
   - **Kuupäev** (kohustuslik) - kalendrist valimine
   - **Tehas** (kohustuslik) - dropdown (Obornik, Solid, vms)
   - **Veok** (kohustuslik):
     - Olemasolev veok (dropdown)
     - VÕI uus veok (automaatne number)
4. Süsteem:
   - Loob vajadusel uue veoki
   - Lisab detailid veokisse
   - Uuendab statistikat (trigger)
   - Logib muudatuse (trigger)

### 5.2 Veoki haldamine

- **Veoki loomine**: Automaatne numbri genereerimine (tehase lühend + järjekorra nr)
- **Veoki ümber tõstmine**: Terve veok teise kuupäeva
- **Veoki staatuse muutmine**: planned → loading → transit → arrived → unloading → completed
- **Veoki kustutamine**: Detailid jäävad alles (vehicle_id = NULL), saab uuesti määrata

### 5.3 Detailide ümber tõstmine

1. Vali detailid (multi-select)
2. Vajuta "Tõsta ümber"
3. Modal:
   - Sihtveok (sama kuupäev või teine)
   - Või uus veok
4. Süsteem logib muudatuse

### 5.4 Mahalaetamine (Playback)

Erinevalt paigaldusgraafikust:
- Mahalaetakse **veokite kaupa**, mitte detailide kaupa
- Iga veoki puhul:
  1. Kuvatakse veoki info
  2. Värvitakse kõik veoki detailid korraga
  3. Zoom veoki detailidele
  4. Järgmine veok

**Värvimise valikud:**
- Päevade kaupa (kõik päeva veokid sama värvi)
- Veokite kaupa (iga veok erineva värviga)

### 5.5 Alternatiivne vaade (Tehaste järgi)

Nupp search'i kõrval vahetab vaadet:

**Vaade 1 (vaikimisi):** Päevade järgi
```
📅 20.12.2024
   └── 🚛 OPO1 (Obornik)
   └── 🚛 SOL1 (Solid)
📅 21.12.2024
   └── 🚛 OPO2 (Obornik)
```

**Vaade 2:** Tehaste järgi
```
🏭 Obornik
   └── 🚛 OPO1
       └── 📅 20.12.2024 (5 detaili)
   └── 🚛 OPO2
       └── 📅 21.12.2024 (8 detaili)
🏭 Solid
   └── 🚛 SOL1
       └── 📅 20.12.2024 (3 detaili)
```

### 5.6 Muudatuste ajalugu

**Logitakse:**
- Detaili lisamine (created)
- Kuupäeva muutmine (date_changed)
- Veoki muutmine (vehicle_changed)
- Staatuse muutmine (status_changed)
- Päevalõpu hetktõmmis (daily_snapshot)

**Vaatamine:**
- Modal detaili/veoki kohta
- Excel eksport ajalugu veeruga

**Hetktõmmis:**
- Öösiti (cron) fikseeritakse päeva lõpu seis
- Võrdlus: algus vs lõpp

### 5.7 Excel eksport

**Veerud:**
| Nr | Kuupäev | Veok | Tehas | Assembly Mark | Toode | Asukoht | Kaal | GUID | Staatus | Algne kuup. | Algne veok | Kommentaarid |

**Lehed:**
1. **Graafik** - põhiandmed
2. **Kokkuvõte** - statistika päevade/tehaste kaupa
3. **Ajalugu** - muudatuste logi

### 5.8 Import

**GUID-de import:**
1. Kleebi GUID-id (Excelist)
2. Süsteem:
   - Tuvastab detailid mudelist
   - Kontrollib duplikaate
   - Pakub tehase ja veoki valikut
3. Automaatne veoki number

**Duplikaatide kontroll:**
- Kui GUID on juba koormas → veateade
- Kui GUID on teises koormas → hoiatus (kas tõsta ümber?)

---

## 6. FAILIDE STRUKTUUR

### 6.1 Uued failid

```
src/
├── components/
│   ├── DeliveryScheduleScreen.tsx       (peakomponent, ~5000 rida)
│   └── DeliveryScheduleScreen.css       (stiilid)
│
supabase/
├── migrations/
│   └── 20251220_delivery_schedule.sql   (täielik migratsioon)
│
docs/
└── DELIVERY_SCHEDULE.md                 (dokumentatsioon)
```

### 6.2 Muudetavad failid

```
src/
├── App.tsx                  (+ handleDeliverySchedule, routing)
├── supabase.ts             (+ uued tüübid)
└── components/
    └── MainMenu.tsx        (+ uus menüü item)
```

---

## 7. IMPLEMENTATSIOONI JÄRJEKORD

### Faas 1: Andmebaas (1-2 päeva)
1. ✅ Loo SQL migratsioonifail
2. ✅ Loo triggerid ja funktsioonid
3. ✅ Testi Supabase's

### Faas 2: TypeScript (0.5 päeva)
1. ✅ Lisa tüübid supabase.ts
2. ✅ Ekspordi tüübid

### Faas 3: Põhistruktuur (2-3 päeva)
1. ✅ Loo DeliveryScheduleScreen.tsx skelet
2. ✅ Lisa MainMenu'sse
3. ✅ Lisa App.tsx routing
4. ✅ Implementeeri andmete laadimine

### Faas 4: UI komponendid (3-4 päeva)
1. ✅ Kalender
2. ✅ Päevade grupid
3. ✅ Veokite grupid
4. ✅ Detailide list
5. ✅ Alternatiivne vaade

### Faas 5: CRUD operatsioonid (2-3 päeva)
1. ✅ Detailide lisamine
2. ✅ Veokite haldus
3. ✅ Ümber tõstmine
4. ✅ Kustutamine

### Faas 6: Mahalaetamine (1-2 päeva)
1. ✅ Playback veokite kaupa
2. ✅ Värvimise valikud

### Faas 7: Ajalugu ja eksport (2 päeva)
1. ✅ Ajaloo vaatamine
2. ✅ Excel eksport
3. ✅ GUID import

### Faas 8: Testimine ja viimistlus (1-2 päeva)
1. ✅ Testimine
2. ✅ Bugfix
3. ✅ Versiooni uuendus

---

## 8. EOS2 INTEGRATSIOON

Tagamaks, et tarne graafik jääb EOS2 rakendusest redigeeritavaks:

1. **API endpoint'id** - Supabase REST API töötab mõlemas
2. **Samad tabelid** - EOS2 kasutab samu tabeleid
3. **Trimble Product ID** - Salvestatakse igale detailile
4. **Versioonihaldus** - Konfliktide lahendamine updated_at põhjal

---

## 9. TURVALISUS

### RLS (Row Level Security) poliitikad

```sql
-- Delivery items - projekti põhine ligipääs
CREATE POLICY "Users can view delivery items in their project"
ON trimble_delivery_items FOR SELECT
USING (project_id IN (
  SELECT trimble_project_id FROM trimble_inspection_users
  WHERE email = auth.jwt() ->> 'email'
));

-- Sarnased poliitikad teistele tabelitele
```

---

## 10. VERSIOONIHALDUS

**Praegune:** 2.20.2
**Uus:** 3.0.0

Põhjus: See on suur uus funktsioon, mis lisab olulise uue mooduli.

---

*Dokument koostatud: 2025-12-20*
*Autor: Claude AI*
