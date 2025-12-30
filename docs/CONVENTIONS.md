# Assembly Inspector - Koodireeglid ja Parimad Praktikad

## Versioonihaldus

### Versiooni Uuendamine
**ALATI** uuenda versiooni kahes kohas:
1. `src/App.tsx` → `APP_VERSION`
2. `package.json` → `version`

```typescript
// src/App.tsx
export const APP_VERSION = '3.0.XXX';
```

```json
// package.json
{
  "version": "3.0.XXX"
}
```

### Commit Sõnumi Formaat
```
v3.0.XXX: Lühike kirjeldus

- Täpsem punkt 1
- Täpsem punkt 2
```

## TypeScript

### Tüüpide Defineerimine
```typescript
// Interface komponendi propside jaoks
interface DeliveryScheduleScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  onBackToMenu: () => void;
  userEmail?: string;
}

// Type andmeobjektide jaoks
type DeliveryItem = {
  id: string;
  guid_ifc: string;
  assembly_mark: string;
  // ...
};
```

### Any Kasutamine
Trimble API tagastab sageli `any` tüüpe. Kasuta type assertion'it:
```typescript
const props = propsArray[j];
const setName = (pset as any).set || (pset as any).name || '';
const propValue = (prop as any).displayValue ?? (prop as any).value;
```

## React Patterns

### useCallback Sõltuvused
```typescript
// ÕIGE: Kõik kasutatud muutujad sõltuvustes
const saveData = useCallback(async () => {
  await supabase.from('table').insert({ projectId, data });
}, [projectId, data]);

// VALE: Puuduvad sõltuvused
const saveData = useCallback(async () => {
  await supabase.from('table').insert({ projectId, data });
}, []); // projectId ja data puuduvad!
```

### useRef Lipud
```typescript
// Async operatsioonide koordineerimiseks
const syncingToModelRef = useRef(false);
const mountedRef = useRef(true);

useEffect(() => {
  mountedRef.current = true;
  return () => { mountedRef.current = false; };
}, []);

// Kasutamine
if (mountedRef.current) {
  setState(newValue);
}
```

### State Uuendamine Prev'iga
```typescript
// ÕIGE: Eelmise väärtuse põhjal
setSelectedItemIds(prev => {
  const next = new Set(prev);
  next.add(item.id);
  return next;
});

// VALE: Võib põhjustada race condition
setSelectedItemIds(new Set([...selectedItemIds, item.id]));
```

## Andmebaasi Operatsioonid

### Batch Operatsioonid
```typescript
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 100;

for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const batch = items.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(item => updateItem(item)));

  // Viivitus rate-limit'i vältimiseks
  if (i + BATCH_SIZE < items.length) {
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }
}
```

### Unikaalsus GUID Järgi
```typescript
// ÕIGE: Kustuta enne sisestamist
const guids = records.map(r => r.guid_ifc).filter(Boolean);
await supabase
  .from('table')
  .delete()
  .eq('project_id', projectId)
  .in('guid_ifc', guids);
await supabase.from('table').insert(records);

// VALE: upsert ignoreDuplicates - ei uuenda olemasolevaid
await supabase.from('table').upsert(records, { ignoreDuplicates: true });
```

## Property Mappings

### Normaliseeritud Võrdlus
```typescript
// ALATI normaliseeri property nimesid enne võrdlemist
const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

const setNameNorm = normalize(setName);
const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);

if (setNameNorm === mappingSetNorm) {
  // Match!
}
```

### Mõlema API Formaadi Tugi
```typescript
// Vanem formaat: propertySets
if (props?.propertySets) {
  for (const ps of props.propertySets) {
    // ps.properties on objekt
    const value = ps.properties['Cast_unit_Mark'];
  }
}

// Uuem formaat: properties array
if (props?.properties && Array.isArray(props.properties)) {
  for (const pset of props.properties) {
    // pset.properties on array
    for (const prop of pset.properties) {
      const value = prop.displayValue ?? prop.value;
    }
  }
}
```

## Excel Eksport

### Kaalude Ümardamine
```typescript
// ALATI ümarda 1 komakohani
const w = parseFloat(item.cast_unit_weight || '0');
const weightStr = isNaN(w) ? '' : w.toFixed(1);
```

### xlsx-js-style Kasutamine
```typescript
import * as XLSX from 'xlsx-js-style';

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);

// Veeru laiused
ws['!cols'] = [
  { wch: 14 }, { wch: 22 }, { wch: 36 }
];

XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
XLSX.writeFile(wb, 'export.xlsx');
```

## Error Handling

### Try-Catch Mustrid
```typescript
try {
  const result = await riskyOperation();
  if (mountedRef.current) {
    setData(result);
  }
} catch (e: any) {
  console.error('Operation failed:', e);
  if (mountedRef.current) {
    setMessage(`Viga: ${e.message}`);
  }
} finally {
  if (mountedRef.current) {
    setLoading(false);
  }
}
```

### Vaikne Vea Ignoreerimine
```typescript
// Timeout vigu võib ignoreerida
if (!e?.message?.includes('timed out')) {
  console.error('Error:', e);
}
```

## UI Patterns

### Loading State
```typescript
<button disabled={isLoading}>
  {isLoading ? (
    <>
      <FiRefreshCw className="spin" size={16} />
      Laadin...
    </>
  ) : (
    <>
      <FiUpload size={16} />
      Salvesta
    </>
  )}
</button>
```

### Checkbox Multi-Select
```typescript
<input
  type="checkbox"
  checked={isSelected}
  onChange={() => {}}  // Controlled component
  onClick={(e) => {
    e.stopPropagation();  // Ära lase row onClick'il käivituda
    toggleSelection(item.id);
  }}
/>
```

## Keele Konventsioonid

### Eesti Keel UI's
- Nupud: "Salvesta", "Kustuta", "Värskenda"
- Staatused: "Laadin...", "Viga: ..."
- Kinnitused: "Kas oled kindel?"

### Console Logid Inglise Keeles
```typescript
console.log('Processing batch:', batchNum);
console.error('Error saving:', error);
```

## Debug Logid

### Property Matching Debug
```typescript
if (rawNameNorm.includes('ebe') || rawNameNorm.includes('pos')) {
  console.log(`🔍 Property: ${setName}.${rawName} = ${propValue}`);
  console.log(`   Match: ${setNameNorm === mappingSetNorm}`);
}
```

### Märgistused
- `🔍` - Otsing/scanning
- `✅` - Õnnestus
- `❌` - Ebaõnnestus
- `📦` - Batch operatsioon
- `🆕` - Uus element
- `🔄` - Uuendus
