import { useTranslation } from 'react-i18next';
import { FiX, FiDownload } from 'react-icons/fi';
import { OrganizerGroup } from '../../../supabase';

interface ImportModalProps {
  show: boolean;
  importGroupId: string | null;
  importText: string;
  importProgress: { current: number; total: number; found: number } | null;
  saving: boolean;
  groups: OrganizerGroup[];
  onClose: () => void;
  onImportTextChange: (text: string) => void;
  onImport: () => void;
  isMsGuid: (guid: string) => boolean;
  isIfcGuid: (guid: string) => boolean;
}

interface ExcelImportModalProps {
  show: boolean;
  excelImportGroupId: string | null;
  excelImportFile: File | null;
  excelImportPreview: { rows: number; subgroups: string[] } | null;
  saving: boolean;
  groups: OrganizerGroup[];
  fileInputRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onImport: () => void;
  onDownloadTemplate: (groupId: string) => void;
}

export function ImportModal({
  show,
  importGroupId,
  importText,
  importProgress,
  saving,
  groups,
  onClose,
  onImportTextChange,
  onImport,
  isMsGuid,
  isIfcGuid
}: ImportModalProps) {
  const { t } = useTranslation('organizer');

  if (!show || !importGroupId) return null;

  const importGroup = groups.find(g => g.id === importGroupId);

  // Parse input to show preview
  const previewValues = importText
    .split(/[\n,;\t]+/)
    .map(v => v.trim())
    .filter(v => v.length > 0);
  const firstValue = previewValues[0] || '';
  const detectedType = isMsGuid(firstValue) ? 'GUID_MS (konverteeritakse IFC-ks)' : isIfcGuid(firstValue) ? 'IFC GUID' : 'Assembly mark';

  return (
    <div className="org-modal-overlay" onClick={onClose}>
      <div className="org-modal" onClick={e => e.stopPropagation()}>
        <div className="org-modal-header">
          <h2>{t('guidImport.title')}</h2>
          <button onClick={onClose}><FiX size={18} /></button>
        </div>
        <div className="org-modal-body">
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
            Grupp: <strong>{importGroup?.name}</strong>
          </p>

          <div className="org-field">
            <label>
              Kleebi GUID või GUID_MS väärtused
              <span style={{ fontSize: '11px', color: '#888', display: 'block' }}>
                (eraldajaks sobib reavahetus, koma, semikoolon või tabulaator)
              </span>
            </label>
            <textarea
              className="org-import-textarea"
              placeholder={t('guidExamplePlaceholder')}
              value={importText}
              onChange={(e) => onImportTextChange(e.target.value)}
              rows={10}
              style={{
                width: '100%',
                fontFamily: 'monospace',
                fontSize: '12px',
                padding: '8px',
                border: '1px solid var(--modus-border)',
                borderRadius: '4px',
                resize: 'vertical'
              }}
            />
          </div>

          {previewValues.length > 0 && (
            <div style={{ marginTop: '8px', padding: '8px', background: '#f5f5f5', borderRadius: '4px', fontSize: '12px' }}>
              <strong>Tuvastatud tüüp:</strong> {detectedType}
              <br />
              <strong>Väärtusi:</strong> {previewValues.length}
            </div>
          )}

          {importProgress && (
            <div className="org-batch-progress" style={{ marginTop: '12px' }}>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }} />
              </div>
              <span>
                Impordin: {importProgress.current} / {importProgress.total} (leitud: {importProgress.found})
              </span>
            </div>
          )}
        </div>
        <div className="org-modal-footer">
          <button className="cancel" onClick={onClose}>{t('cancel')}</button>
          <button
            className="save"
            onClick={onImport}
            disabled={saving || previewValues.length === 0}
          >
            {saving ? 'Impordin...' : `Impordi ${previewValues.length} väärtust`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExcelImportModal({
  show,
  excelImportGroupId,
  excelImportFile,
  excelImportPreview,
  saving,
  groups,
  fileInputRef,
  onClose,
  onFileSelect,
  onImport,
  onDownloadTemplate
}: ExcelImportModalProps) {
  const { t } = useTranslation('organizer');

  if (!show || !excelImportGroupId) return null;

  const importGroup = groups.find(g => g.id === excelImportGroupId);

  return (
    <div className="org-modal-overlay" onClick={onClose}>
      <div className="org-modal" onClick={e => e.stopPropagation()}>
        <div className="org-modal-header">
          <h2>{t('excelImport.title')}</h2>
          <button onClick={onClose}><FiX size={18} /></button>
        </div>
        <div className="org-modal-body">
          <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
            Grupp: <strong>{importGroup?.name}</strong>
          </p>

          <div style={{ marginBottom: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#166534' }}>
              <strong>Nõuded:</strong><br/>
              • GUID_IFC või GUID_MS veerg (vähemalt üks kohustuslik)<br/>
              • GUID_MS konverteeritakse automaatselt IFC formaati<br/>
              • Alamgrupp veerg loob uued alamgrupid automaatselt
            </p>
          </div>

          <div className="org-field" style={{ marginBottom: '16px' }}>
            <label>Vali Excel fail (.xlsx)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={onFileSelect}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px',
                border: '1px solid var(--modus-border)',
                borderRadius: '4px',
                marginTop: '4px'
              }}
            />
          </div>

          {excelImportPreview && (
            <div style={{ padding: '12px', background: '#eff6ff', borderRadius: '8px', marginBottom: '16px' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#1e40af' }}>
                <strong>Eelvaade:</strong><br/>
                • Ridu: {excelImportPreview.rows}<br/>
                {excelImportPreview.subgroups.length > 0 && (
                  <>• Alamgrupid: {excelImportPreview.subgroups.join(', ')}</>
                )}
              </p>
            </div>
          )}

          <button
            onClick={() => onDownloadTemplate(excelImportGroupId)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              background: 'white',
              border: '1px solid var(--modus-border)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              color: '#374151'
            }}
          >
            <FiDownload size={14} /> Lae alla template
          </button>
        </div>
        <div className="org-modal-footer">
          <button className="cancel" onClick={onClose}>{t('cancel')}</button>
          <button
            className="save"
            onClick={onImport}
            disabled={saving || !excelImportFile}
          >
            {saving ? 'Impordin...' : 'Impordi'}
          </button>
        </div>
      </div>
    </div>
  );
}
