# Google Sheets Sync - Claude Code Juhend

## Ülesanne

Implementeeri Google Sheets kahepoolne sünkroonimine tarnegraafiku veokitele. See võimaldab kasutajatel vaadata ja muuta veokite andmeid otse Google Sheets'is.

## Projekti asukoht

Repository: `assembly-inspector` (GitHub)

---

## 1. ANDMEBAASI MIGRATSIOON

Loo fail: `supabase/migrations/20260113_google_sheets_sync.sql`

```sql
-- ============================================
-- GOOGLE SHEETS SYNC SYSTEM
-- Versioon: 1.0.0
-- Kuupäev: 2025-01-13
-- ============================================

-- Projekti Google Sheets sünkroonimise konfiguratsioon
CREATE TABLE IF NOT EXISTS trimble_sheets_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  
  -- Google Drive/Sheets info
  google_drive_folder_id TEXT NOT NULL,
  google_spreadsheet_id TEXT,
  google_spreadsheet_url TEXT,
  sheet_name TEXT DEFAULT 'Veokid',
  
  -- Sünkroonimise seaded
  sync_enabled BOOLEAN DEFAULT true,
  sync_interval_minutes INTEGER DEFAULT 5,
  
  -- Ajatemplid
  last_sync_to_sheets TIMESTAMPTZ,
  last_sync_from_sheets TIMESTAMPTZ,
  last_full_sync TIMESTAMPTZ,
  
  -- Staatused
  sync_status TEXT DEFAULT 'not_initialized' 
    CHECK (sync_status IN ('not_initialized', 'idle', 'syncing', 'error')),
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_project_sheets_config UNIQUE (trimble_project_id)
);

-- Sünkroonimise logi
CREATE TABLE IF NOT EXISTS trimble_sheets_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES trimble_sheets_sync_config(id) ON DELETE CASCADE,
  trimble_project_id TEXT NOT NULL,
  
  sync_direction TEXT NOT NULL CHECK (sync_direction IN ('to_sheets', 'from_sheets', 'full')),
  sync_type TEXT DEFAULT 'auto' CHECK (sync_type IN ('auto', 'manual', 'initial')),
  
  vehicles_processed INTEGER DEFAULT 0,
  vehicles_created INTEGER DEFAULT 0,
  vehicles_updated INTEGER DEFAULT 0,
  vehicles_deleted INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  error_details JSONB,
  triggered_by TEXT
);

-- Veokite tabeli laiendus
ALTER TABLE trimble_delivery_vehicles 
ADD COLUMN IF NOT EXISTS sheets_row_number INTEGER,
ADD COLUMN IF NOT EXISTS sheets_last_modified TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sheets_checksum TEXT;

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_sheets_sync_config_project 
  ON trimble_sheets_sync_config(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_sheets_sync_log_config 
  ON trimble_sheets_sync_log(config_id);
CREATE INDEX IF NOT EXISTS idx_sheets_sync_log_started 
  ON trimble_sheets_sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_sheets_row 
  ON trimble_delivery_vehicles(sheets_row_number) 
  WHERE sheets_row_number IS NOT NULL;

-- RLS Policies
ALTER TABLE trimble_sheets_sync_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_sheets_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view sheets config"
  ON trimble_sheets_sync_config FOR SELECT
  USING (
    trimble_project_id IN (
      SELECT trimble_project_id FROM trimble_inspection_users
      WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
    )
  );

CREATE POLICY "Admins can manage sheets config"
  ON trimble_sheets_sync_config FOR ALL
  USING (
    trimble_project_id IN (
      SELECT trimble_project_id FROM trimble_inspection_users
      WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
      AND role IN ('admin', 'moderator')
    )
  );

CREATE POLICY "Project members can view sync logs"
  ON trimble_sheets_sync_log FOR SELECT
  USING (
    trimble_project_id IN (
      SELECT trimble_project_id FROM trimble_inspection_users
      WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
    )
  );

CREATE POLICY "Allow insert sync logs"
  ON trimble_sheets_sync_log FOR INSERT
  WITH CHECK (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION update_sheets_sync_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sheets_sync_config_updated ON trimble_sheets_sync_config;
CREATE TRIGGER trigger_sheets_sync_config_updated
  BEFORE UPDATE ON trimble_sheets_sync_config
  FOR EACH ROW
  EXECUTE FUNCTION update_sheets_sync_config_timestamp();
```

---

## 2. TYPESCRIPT TÜÜBID

Lisa faili `src/supabase.ts` (enne viimast `export` rida või faili lõppu):

```typescript
// ============================================
// GOOGLE SHEETS SYNC TYPES
// ============================================

export interface SheetsSyncConfig {
  id: string;
  trimble_project_id: string;
  google_drive_folder_id: string;
  google_spreadsheet_id: string | null;
  google_spreadsheet_url: string | null;
  sheet_name: string;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  last_sync_to_sheets: string | null;
  last_sync_from_sheets: string | null;
  last_full_sync: string | null;
  sync_status: 'not_initialized' | 'idle' | 'syncing' | 'error';
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

export interface SheetsSyncLog {
  id: string;
  config_id: string;
  trimble_project_id: string;
  sync_direction: 'to_sheets' | 'from_sheets' | 'full';
  sync_type: 'auto' | 'manual' | 'initial';
  vehicles_processed: number;
  vehicles_created: number;
  vehicles_updated: number;
  vehicles_deleted: number;
  errors_count: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_details: Record<string, unknown> | null;
  triggered_by: string | null;
}
```

---

## 3. DELIVERYSCHEDULESCREEN.TSX MUUDATUSED

### 3.1 Lisa import

Faili alguses, teiste importide juurde:

```typescript
import { SheetsSyncConfig, SheetsSyncLog } from '../supabase';
```

### 3.2 Lisa uued state muutujad

Komponendi alguses, teiste useState hookide juurde:

```typescript
// Google Sheets Sync
const [showSheetsModal, setShowSheetsModal] = useState(false);
const [sheetsConfig, setSheetsConfig] = useState<SheetsSyncConfig | null>(null);
const [sheetsLogs, setSheetsLogs] = useState<SheetsSyncLog[]>([]);
const [sheetsLoading, setSheetsLoading] = useState(false);
```

### 3.3 Lisa Sheets config laadimine

Lisa uus useEffect (teiste useEffect'ide juurde):

```typescript
// Load Google Sheets sync config
useEffect(() => {
  const loadSheetsConfig = async () => {
    if (!projectId) return;
    
    const { data } = await supabase
      .from('trimble_sheets_sync_config')
      .select('*')
      .eq('trimble_project_id', projectId)
      .single();
    
    if (data) {
      setSheetsConfig(data);
    }
  };
  
  loadSheetsConfig();
}, [projectId]);
```

### 3.4 Lisa funktsioonid Sheets haldamiseks

Lisa need funktsioonid komponendi sisse (teiste funktsioonide juurde):

```typescript
// Google Sheets functions
const loadSheetsLogs = async () => {
  if (!projectId) return;
  
  const { data } = await supabase
    .from('trimble_sheets_sync_log')
    .select('*')
    .eq('trimble_project_id', projectId)
    .order('started_at', { ascending: false })
    .limit(10);
  
  if (data) {
    setSheetsLogs(data);
  }
};

const initializeSheetsConfig = async () => {
  if (!projectId || !user) return;
  
  setSheetsLoading(true);
  
  const { data, error } = await supabase
    .from('trimble_sheets_sync_config')
    .insert({
      trimble_project_id: projectId,
      google_drive_folder_id: '104KWXRGYHRUZMAKmNSYjiLR4IY8hKWaD',
      sheet_name: 'Veokid',
      sync_enabled: true,
      created_by: user.email || tcUserEmail || 'unknown'
    })
    .select()
    .single();
  
  setSheetsLoading(false);
  
  if (data) {
    setSheetsConfig(data);
  } else if (error) {
    console.error('Failed to initialize sheets config:', error);
    alert('Sheets konfiguratsiooni loomine ebaõnnestus!');
  }
};

const refreshSheetsConfig = async () => {
  if (!projectId) return;
  
  const { data } = await supabase
    .from('trimble_sheets_sync_config')
    .select('*')
    .eq('trimble_project_id', projectId)
    .single();
  
  if (data) {
    setSheetsConfig(data);
  }
};

const toggleSheetsSync = async (enabled: boolean) => {
  if (!sheetsConfig) return;
  
  await supabase
    .from('trimble_sheets_sync_config')
    .update({ sync_enabled: enabled })
    .eq('id', sheetsConfig.id);
  
  refreshSheetsConfig();
};
```

### 3.5 Lisa toolbar nupp

Leia toolbar sektsioonis koht kus on teised nupud (otsing, filter, jne) ja lisa:

```tsx
{/* Google Sheets Sync Button */}
<button
  className="toolbar-btn"
  onClick={() => {
    setShowSheetsModal(true);
    loadSheetsLogs();
  }}
  title="Google Sheets sünkroonimine"
>
  <FiExternalLink />
  <span className="btn-text">Sheets</span>
</button>
```

### 3.6 Lisa modal

Lisa komponendi lõppu, enne viimast `</div>` ja teiste modalide juurde:

```tsx
{/* Google Sheets Sync Modal */}
{showSheetsModal && (
  <div className="modal-overlay" onClick={() => setShowSheetsModal(false)}>
    <div className="modal settings-modal" onClick={e => e.stopPropagation()}>
      <div className="modal-header">
        <h2><FiExternalLink style={{ marginRight: 8 }} />Google Sheets Sünkroonimine</h2>
        <button className="close-btn" onClick={() => setShowSheetsModal(false)}>
          <FiX />
        </button>
      </div>
      
      <div className="modal-body">
        {sheetsLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <FiRefreshCw className="spin" size={24} />
            <p>Laadin...</p>
          </div>
        ) : !sheetsConfig ? (
          <div className="sheets-not-initialized">
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <FiExternalLink size={48} style={{ color: '#9ca3af', marginBottom: 16 }} />
              <p style={{ marginBottom: 16, color: '#374151' }}>
                Google Sheets sünkroonimine pole veel seadistatud.
              </p>
              <button 
                className="submit-btn primary"
                onClick={initializeSheetsConfig}
              >
                <FiPlus style={{ marginRight: 8 }} />
                Seadista sünkroonimine
              </button>
            </div>
            <div className="sheets-hint" style={{ 
              marginTop: 24, 
              padding: 16, 
              background: '#f9fafb', 
              borderRadius: 8,
              fontSize: 13,
              color: '#6b7280'
            }}>
              <strong>Järgmised sammud pärast seadistamist:</strong>
              <ol style={{ marginTop: 8, paddingLeft: 20 }}>
                <li>Ava Google Apps Script</li>
                <li>Käivita <code>initializeSheet()</code> funktsioon</li>
                <li>Sheet luuakse automaatselt</li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="sheets-config">
            {/* Status */}
            <div className="sheets-status-row">
              <span>Staatus:</span>
              <span className={`sheets-status-badge ${sheetsConfig.sync_status}`}>
                {sheetsConfig.sync_status === 'not_initialized' && '⚪ Ootab initsialiseerimist'}
                {sheetsConfig.sync_status === 'idle' && '🟢 Valmis'}
                {sheetsConfig.sync_status === 'syncing' && '🔄 Sünkroonib...'}
                {sheetsConfig.sync_status === 'error' && '🔴 Viga'}
              </span>
            </div>

            {/* Sheet Link */}
            {sheetsConfig.google_spreadsheet_url ? (
              <div className="sheets-link-row">
                <span>Google Sheet:</span>
                <a 
                  href={sheetsConfig.google_spreadsheet_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="sheets-link"
                >
                  <FiExternalLink style={{ marginRight: 4 }} />
                  Ava Sheets'is
                </a>
              </div>
            ) : (
              <div className="sheets-pending">
                <FiClock style={{ marginRight: 8 }} />
                Sheet pole veel loodud. Käivita Google Apps Scriptis <code>initializeSheet()</code>
                <button 
                  className="refresh-btn"
                  onClick={refreshSheetsConfig}
                  style={{ marginLeft: 12 }}
                >
                  <FiRefreshCw size={14} />
                </button>
              </div>
            )}

            {/* Sync times */}
            <div className="sheets-times">
              <div className="sheets-time-row">
                <span>Viimane sünkr. Sheeti:</span>
                <span>{sheetsConfig.last_sync_to_sheets 
                  ? new Date(sheetsConfig.last_sync_to_sheets).toLocaleString('et-EE')
                  : '-'
                }</span>
              </div>
              <div className="sheets-time-row">
                <span>Viimane sünkr. Sheetist:</span>
                <span>{sheetsConfig.last_sync_from_sheets 
                  ? new Date(sheetsConfig.last_sync_from_sheets).toLocaleString('et-EE')
                  : '-'
                }</span>
              </div>
            </div>

            {/* Error */}
            {sheetsConfig.last_error && (
              <div className="sheets-error">
                <FiAlertTriangle style={{ marginRight: 8 }} />
                <div>
                  <strong>Viimane viga:</strong>
                  <code>{sheetsConfig.last_error}</code>
                </div>
              </div>
            )}

            {/* Toggle */}
            <div className="sheets-toggle-row">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={sheetsConfig.sync_enabled}
                  onChange={(e) => toggleSheetsSync(e.target.checked)}
                />
                <span>Automaatne sünkroonimine aktiivne</span>
              </label>
            </div>

            {/* Logs */}
            {sheetsLogs.length > 0 && (
              <div className="sheets-logs">
                <h4>Viimased sünkroonimised</h4>
                <table className="sheets-logs-table">
                  <thead>
                    <tr>
                      <th>Aeg</th>
                      <th>Suund</th>
                      <th>Veokeid</th>
                      <th>Kestus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetsLogs.slice(0, 5).map(log => (
                      <tr key={log.id} className={log.errors_count > 0 ? 'has-error' : ''}>
                        <td>{new Date(log.started_at).toLocaleString('et-EE')}</td>
                        <td>{log.sync_direction === 'to_sheets' ? '→ Sheets' : '← Sheets'}</td>
                        <td>{log.vehicles_processed}</td>
                        <td>{log.duration_ms ? `${log.duration_ms}ms` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="modal-footer">
        <button className="cancel-btn" onClick={() => setShowSheetsModal(false)}>
          Sulge
        </button>
      </div>
    </div>
  </div>
)}
```

---

## 4. CSS STIILID

Lisa faili `src/components/DeliveryScheduleScreen.css`:

```css
/* ============================================
   GOOGLE SHEETS SYNC STYLES
   ============================================ */

.sheets-not-initialized code {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
}

.sheets-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sheets-status-row,
.sheets-link-row,
.sheets-time-row,
.sheets-toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #e5e7eb;
}

.sheets-status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
}

.sheets-status-badge.idle { background: #d1fae5; color: #065f46; }
.sheets-status-badge.syncing { background: #dbeafe; color: #1e40af; }
.sheets-status-badge.error { background: #fee2e2; color: #991b1b; }
.sheets-status-badge.not_initialized { background: #f3f4f6; color: #6b7280; }

.sheets-link {
  display: inline-flex;
  align-items: center;
  color: #2563eb;
  text-decoration: none;
  font-weight: 500;
  padding: 6px 12px;
  background: #eff6ff;
  border-radius: 6px;
  transition: background 0.2s;
}

.sheets-link:hover {
  background: #dbeafe;
  text-decoration: none;
}

.sheets-pending {
  display: flex;
  align-items: center;
  background: #fffbeb;
  border: 1px solid #fbbf24;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 13px;
  color: #92400e;
}

.sheets-pending code {
  background: #fef3c7;
  padding: 2px 6px;
  border-radius: 4px;
  margin: 0 4px;
}

.sheets-pending .refresh-btn {
  background: #fbbf24;
  color: #78350f;
  border: none;
  padding: 6px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sheets-pending .refresh-btn:hover {
  background: #f59e0b;
}

.sheets-times {
  background: #f9fafb;
  border-radius: 8px;
  padding: 12px 16px;
}

.sheets-times .sheets-time-row {
  border-bottom: none;
  padding: 6px 0;
  font-size: 13px;
}

.sheets-times .sheets-time-row:last-child {
  padding-bottom: 0;
}

.sheets-error {
  display: flex;
  align-items: flex-start;
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 13px;
  color: #991b1b;
}

.sheets-error code {
  display: block;
  margin-top: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  word-break: break-all;
  background: #fecaca;
  padding: 4px 8px;
  border-radius: 4px;
}

.sheets-toggle-row {
  border-bottom: none;
  padding-top: 16px;
}

.sheets-toggle-row .toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 14px;
}

.sheets-toggle-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.sheets-logs {
  margin-top: 8px;
}

.sheets-logs h4 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #374151;
}

.sheets-logs-table {
  width: 100%;
  font-size: 12px;
  border-collapse: collapse;
}

.sheets-logs-table th,
.sheets-logs-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}

.sheets-logs-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #4b5563;
}

.sheets-logs-table tr.has-error {
  background: #fef2f2;
}

.sheets-logs-table tr:hover {
  background: #f3f4f6;
}

/* Spin animation for loading */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin {
  animation: spin 1s linear infinite;
}
```

---

## 5. COMMIT JA PUSH

Peale muudatuste tegemist:

```bash
git add .
git commit -m "feat: Add Google Sheets bidirectional sync for delivery vehicles

- Add database migration for sheets sync config and logs
- Add TypeScript types for SheetsSyncConfig and SheetsSyncLog
- Add Sheets sync modal to DeliveryScheduleScreen
- Add toolbar button to open sync settings
- Support automatic sync every 5 minutes via Google Apps Script"

git push origin main
```

---

## 6. KONTROLLNIMEKIRI

- [ ] Migratsioonifail loodud: `supabase/migrations/20260113_google_sheets_sync.sql`
- [ ] TypeScript tüübid lisatud: `src/supabase.ts`
- [ ] State muutujad lisatud: `DeliveryScheduleScreen.tsx`
- [ ] useEffect hook lisatud config laadimiseks
- [ ] Funktsioonid lisatud (loadSheetsLogs, initializeSheetsConfig, jne)
- [ ] Toolbar nupp lisatud
- [ ] Modal lisatud
- [ ] CSS stiilid lisatud: `DeliveryScheduleScreen.css`
- [ ] Commit ja push tehtud

---

## 7. TESTIMINE

1. Käivita migratsioon Supabase'is
2. Ava rakendus
3. Mine Tarnegraafikusse
4. Kliki "Sheets" nuppu toolbaris
5. Kliki "Seadista sünkroonimine"
6. Kontrolli kas config loodi Supabase'i tabelisse `trimble_sheets_sync_config`
