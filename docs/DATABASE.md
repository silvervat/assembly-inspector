# Assembly Inspector - Andmebaasi Skeem

## Ülevaade

Andmebaas asub Supabase's (PostgreSQL). Ühenduse konfiguratsioon on failis `src/supabase.ts`.

## Tabelid

### 1. trimble_ex_users
Autoriseeritud kasutajad.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `user_email` | TEXT | Trimble kasutaja email (UNIQUE) |
| `name` | TEXT | Kuvatav nimi (optional) |
| `role` | TEXT | 'inspector' \| 'admin' \| 'viewer' |
| `created_at` | TIMESTAMP | Loomise aeg |

### 2. trimble_model_objects
Mudeli objektide cache tarnegraafiku jaoks.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `trimble_project_id` | TEXT | Trimble projekti ID |
| `model_id` | TEXT | Mudeli ID |
| `object_runtime_id` | INTEGER | Objekti runtime ID |
| `guid` | TEXT | MS GUID (nullable) |
| `guid_ifc` | TEXT | IFC GUID |
| `assembly_mark` | TEXT | Assembly mark (nt "E-001") |
| `product_name` | TEXT | Toote nimi |
| `created_at` | TIMESTAMP | Loomise aeg |

**Unikaalsus**: `(trimble_project_id, guid_ifc)` - üks GUID projekti kohta

### 3. project_property_mappings
Projekti-põhised Tekla property seaded.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `trimble_project_id` | TEXT | Trimble projekti ID (UNIQUE) |
| `assembly_mark_set` | TEXT | Property set nimi (nt "EBE_Tootmine") |
| `assembly_mark_prop` | TEXT | Property nimi (nt "1EBE_Pos_number") |
| `weight_set` | TEXT | Kaalu property set |
| `weight_prop` | TEXT | Kaalu property nimi |
| `position_code_set` | TEXT | Positsioonikoodi set |
| `position_code_prop` | TEXT | Positsioonikoodi property |
| `top_elevation_set` | TEXT | Ülemise kõrguse set |
| `top_elevation_prop` | TEXT | Ülemise kõrguse property |
| `bottom_elevation_set` | TEXT | Alumise kõrguse set |
| `bottom_elevation_prop` | TEXT | Alumise kõrguse property |
| `guid_set` | TEXT | GUID set |
| `guid_prop` | TEXT | GUID property |
| `updated_at` | TIMESTAMP | Viimane muudatus |
| `updated_by` | TEXT | Muutja email |

### 4. trimble_delivery_vehicles
Tarnegraafiku veokid.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `trimble_project_id` | TEXT | Projekti ID |
| `factory_id` | UUID | Tehase ID (FK) |
| `vehicle_code` | TEXT | Veoki kood (nt "V-01") |
| `delivery_date` | DATE | Tarne kuupäev |
| `unload_start_time` | TEXT | Mahalaadimise algus (nt "08:00") |
| `sort_order` | INTEGER | Järjekord |
| `created_at` | TIMESTAMP | Loomise aeg |

### 5. trimble_delivery_items
Tarnegraafiku detailid (veokites).

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `trimble_project_id` | TEXT | Projekti ID |
| `vehicle_id` | UUID | Veoki ID (FK, nullable) |
| `guid` | TEXT | MS GUID |
| `guid_ifc` | TEXT | IFC GUID |
| `assembly_mark` | TEXT | Assembly mark |
| `product_name` | TEXT | Toote nimi |
| `cast_unit_weight` | TEXT | Kaal |
| `cast_unit_position_code` | TEXT | Positsioonikood |
| `status` | TEXT | 'pending' \| 'loaded' \| 'delivered' \| 'installed' |
| `sort_order` | INTEGER | Järjekord veokis |
| `created_at` | TIMESTAMP | Loomise aeg |

### 6. trimble_delivery_factories
Tehased tarnegraafikus.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `trimble_project_id` | TEXT | Projekti ID |
| `name` | TEXT | Tehase nimi |
| `code` | TEXT | Tehase kood |
| `sort_order` | INTEGER | Järjekord |
| `created_at` | TIMESTAMP | Loomise aeg |

### 7. installation_schedule_items
Paigaldusgraafiku elemendid.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `trimble_project_id` | TEXT | Projekti ID |
| `guid` | TEXT | MS GUID |
| `guid_ifc` | TEXT | IFC GUID |
| `guid_ms` | TEXT | MS GUID (alternatiiv) |
| `assembly_mark` | TEXT | Assembly mark |
| `product_name` | TEXT | Toote nimi |
| `cast_unit_weight` | TEXT | Kaal |
| `cast_unit_position_code` | TEXT | Positsioonikood |
| `scheduled_date` | DATE | Planeeritud paigalduskuupäev |
| `actual_date` | DATE | Tegelik paigalduskuupäev |
| `status` | TEXT | 'planned' \| 'in_progress' \| 'completed' |
| `created_at` | TIMESTAMP | Loomise aeg |

### 8. inspections
Kvaliteedikontrolli kirjed.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `trimble_project_id` | TEXT | Projekti ID |
| `inspection_type` | TEXT | Inspektsiooni tüüp |
| `guid` | TEXT | Objekti GUID |
| `guid_ifc` | TEXT | IFC GUID |
| `guid_ms` | TEXT | MS GUID |
| `assembly_mark` | TEXT | Assembly mark |
| `product_name` | TEXT | Toote nimi |
| `cast_unit_weight` | TEXT | Kaal |
| `cast_unit_position_code` | TEXT | Positsioonikood |
| `cast_unit_top_elevation` | TEXT | Ülemine kõrgus |
| `cast_unit_bottom_elevation` | TEXT | Alumine kõrgus |
| `result` | TEXT | Tulemus |
| `notes` | TEXT | Märkused |
| `inspector_email` | TEXT | Inspektori email |
| `created_at` | TIMESTAMP | Loomise aeg |

### 9. installation_month_locks
Paigalduste kuu lukustused - võimaldab administraatoritel lukustada kuu, et tavakasutajad ei saaks lisada/kustutada paigaldusi.

| Veerg | Tüüp | Kirjeldus |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `project_id` | TEXT | Projekti ID |
| `month_key` | TEXT | Kuu võti (formaat: "2026-01") |
| `locked_by` | TEXT | Lukustaja email |
| `locked_by_name` | TEXT | Lukustaja nimi |
| `locked_at` | TIMESTAMP | Lukustamise aeg |
| `created_at` | TIMESTAMP | Loomise aeg |

**Unikaalsus:** `(project_id, month_key)` - sama kuu saab lukustada ainult üks kord projekti kohta.

## Suhted (ER Diagramm)

```
trimble_ex_users
       │
       │ (auth by email)
       ▼
┌──────────────────────────────────────────────────────────┐
│                    trimble_project_id                     │
│                           │                               │
│    ┌──────────────────────┼──────────────────────┐       │
│    │                      │                      │       │
│    ▼                      ▼                      ▼       │
│ project_property    trimble_model        trimble_delivery │
│ _mappings           _objects             _factories       │
│                                                │          │
│                                                ▼          │
│                                          trimble_delivery │
│                                          _vehicles        │
│                                                │          │
│                                                ▼          │
│                                          trimble_delivery │
│                                          _items           │
│                                                           │
│ installation_schedule_items      inspections              │
└──────────────────────────────────────────────────────────┘
```

## Olulised Päringud

### Unikaalsus GUID järgi (delete + insert)
```sql
-- Enne sisestamist kustuta sama GUID'ga kirjed
DELETE FROM trimble_model_objects
WHERE trimble_project_id = $1 AND guid_ifc = ANY($2);

-- Seejärel sisesta uued
INSERT INTO trimble_model_objects (...) VALUES (...);
```

### Property mappings laadimine
```sql
SELECT * FROM project_property_mappings
WHERE trimble_project_id = $1
LIMIT 1;
```

### Delivery items koos veokitega
```sql
SELECT di.*, dv.vehicle_code, dv.delivery_date
FROM trimble_delivery_items di
LEFT JOIN trimble_delivery_vehicles dv ON di.vehicle_id = dv.id
WHERE di.trimble_project_id = $1
ORDER BY dv.sort_order, di.sort_order;
```
