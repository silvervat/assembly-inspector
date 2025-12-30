# Assembly Inspector - API Dokumentatsioon

## Trimble Connect Workspace API

### Ühenduse Loomine
```typescript
import * as WorkspaceAPI from 'trimble-connect-workspace-api';

const api = await WorkspaceAPI.connect(window.parent, (event, args) => {
  // Event handler
});
```

### Viewer API

#### Mudeli Info
```typescript
// Kõik laetud mudelid
const models = await api.viewer.getModels();
// Returns: Array<{ id: string, name: string, ... }>

// Kõik objektid kõigist mudelitest
const allObjects = await api.viewer.getObjects();
// Returns: Array<{ modelId: string, objects: Array<{ id: number }> }>
```

#### Objekti Property'd
```typescript
// Property'd runtime ID järgi
const props = await api.viewer.getObjectProperties(modelId, runtimeIds, { includeHidden: true });

// Tagastab:
interface ObjectProperties {
  properties?: PropertySet[];  // Uuem formaat
  propertySets?: PropertySet[]; // Vanem formaat
  product?: { name: string };
  class?: string;
}

interface PropertySet {
  name: string;  // või 'set' võti
  properties: Array<{
    name: string;
    value?: any;
    displayValue?: string;
  }>;
}
```

#### GUID Teisendused
```typescript
// Runtime ID → IFC GUID
const ifcGuids = await api.viewer.convertToObjectIds(modelId, runtimeIds);
// Returns: string[] (IFC formaadis GUID'd, 22 tähemärki)

// IFC GUID → Runtime ID
const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, ifcGuids);
```

#### Valik (Selection)
```typescript
// Praegune valik
const selection = await api.viewer.getSelection();
// Returns: Array<{ modelId: string, objectRuntimeIds: number[] }>

// Vali objektid
await api.viewer.setSelection({ modelObjectIds: [...] }, 'set' | 'add' | 'remove');

// Selection change listener
api.viewer.addOnSelectionChanged?.(handleSelectionChange);
api.viewer.removeOnSelectionChanged?.(handleSelectionChange);
```

#### Kaamera
```typescript
// Zoom valitud objektidele
await api.viewer.setCamera({ selected: true }, { animationTime: 300 });

// Zoom konkreetsele objektile
await api.viewer.setCamera({ objectRuntimeIds: [id] }, { animationTime: 300 });
```

### Project API
```typescript
// Projekti info
const project = await api.project.getProject();
// Returns: { id: string, name: string, ... }
```

### Extension API
```typescript
// Kasutaja info
const user = await api.extension.getUser();
// Returns: { email: string, firstName: string, lastName: string, ... }
```

## Supabase API

### Klient
```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

### CRUD Operatsioonid

#### Select
```typescript
const { data, error } = await supabase
  .from('table_name')
  .select('*')
  .eq('column', value)
  .order('created_at', { ascending: false });
```

#### Insert
```typescript
const { data, error } = await supabase
  .from('table_name')
  .insert({ column: value })
  .select();
```

#### Upsert (Insert or Update)
```typescript
const { error } = await supabase
  .from('table_name')
  .upsert(records, {
    onConflict: 'unique_column',
    // ignoreDuplicates: true  ← EI KASUTA, muidu ei uuendata
  });
```

#### Update
```typescript
const { error } = await supabase
  .from('table_name')
  .update({ column: newValue })
  .eq('id', id);
```

#### Delete
```typescript
const { error } = await supabase
  .from('table_name')
  .delete()
  .eq('trimble_project_id', projectId)
  .in('guid_ifc', guids);
```

### Batch Operatsioonid

```typescript
// Paralleelsed päringud (5 korraga, 100ms viivitusega)
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 100;

for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const batch = items.slice(i, i + BATCH_SIZE);
  await Promise.all(
    batch.map(item =>
      supabase.from('table').update(item.updates).eq('id', item.id)
    )
  );
  if (i + BATCH_SIZE < items.length) {
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }
}
```

## GUID Formaadid

### IFC GUID (22 tähemärki)
```
0BTBFw6f90Nfh9rP1dlXru
```
Base64-sarnane formaat, kasutab tähemärke: `0-9A-Za-z_$`

### MS GUID (36 tähemärki)
```
3F27A39E-A6C1-4B89-9D24-8B5F9C7E1234
```
Standardne UUID formaat kriipsudega.

### Teisendus IFC → MS
```typescript
const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

function ifcToMsGuid(ifcGuid: string): string {
  if (!ifcGuid || ifcGuid.length !== 22) return '';

  let bits = '';
  for (let i = 0; i < 22; i++) {
    const idx = IFC_CHARS.indexOf(ifcGuid[i]);
    if (idx < 0) return '';
    const numBits = i === 0 ? 2 : 6;
    bits += idx.toString(2).padStart(numBits, '0');
  }

  if (bits.length !== 128) return '';

  let hex = '';
  for (let i = 0; i < 128; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`.toUpperCase();
}
```

## Property Mappings Kasutamine

### Normaliseeritud Võrdlus
```typescript
const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

const setNameNorm = normalize(setName);
const propNameNorm = normalize(propName);
const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);

if (setNameNorm === mappingSetNorm && propNameNorm === mappingPropNorm) {
  assemblyMark = String(propValue);
}
```

### Property Struktuurid (API vastused)

**Uuem formaat:**
```javascript
props.properties = [
  {
    name: "Tekla Assembly",  // või set: "Tekla Assembly"
    properties: [
      { name: "Assembly/Cast unit Mark", value: "E-001", displayValue: "E-001" }
    ]
  }
]
```

**Vanem formaat:**
```javascript
props.propertySets = [
  {
    name: "Tekla Common",
    properties: {
      "Cast_unit_Mark": "E-001"
    }
  }
]
```

**Mõlemat tuleb toetada!**
