import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, DeliveryVehicle, DeliveryFactory } from '../supabase';
import { FiSave, FiRefreshCw, FiX, FiCheck, FiAlertTriangle } from 'react-icons/fi';
import './DeliverySpreadsheetEditor.css';

interface Props {
  projectId: string;
  onClose?: () => void;
}

interface SpreadsheetRow {
  id: string;
  item_id: string;
  vehicle_id: string | null;
  vehicle_code: string;
  scheduled_date: string | null;
  unload_start_time: string | null;
  guid: string;
  guid_ifc: string | null;
  assembly_mark: string;
  sort_order: number;
  // Track changes
  isModified: boolean;
  originalData: {
    vehicle_id: string | null;
    scheduled_date: string | null;
    unload_start_time: string | null;
    assembly_mark: string;
    sort_order: number;
  };
}

// Parse date from various formats to YYYY-MM-DD
const parseDate = (value: string): string | null => {
  if (!value || value.trim() === '') return null;

  // Try DD.MM.YYYY format
  const ddmmyyyy = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try DD.MM.YY format
  const ddmmyy = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (ddmmyy) {
    const [, day, month, year] = ddmmyy;
    const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try YYYY-MM-DD format (ISO)
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;

  return null;
};

// Format date for display (DD.MM.YYYY)
const formatDate = (date: string | null): string => {
  if (!date) return '';
  try {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  } catch {
    return date;
  }
};

// Parse time from various formats to HH:MM
const parseTime = (value: string): string | null => {
  if (!value || value.trim() === '') return null;

  // Try HH:MM format
  const hhmm = value.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const [, hour, minute] = hhmm;
    return `${hour.padStart(2, '0')}:${minute}`;
  }

  // Try HHMM format (no colon)
  const nocolon = value.match(/^(\d{2})(\d{2})$/);
  if (nocolon) {
    const [, hour, minute] = nocolon;
    return `${hour}:${minute}`;
  }

  return null;
};

export default function DeliverySpreadsheetEditor({ projectId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [vehicles, setVehicles] = useState<DeliveryVehicle[]>([]);
  const [_factories, setFactories] = useState<DeliveryFactory[]>([]); // eslint-disable-line @typescript-eslint/no-unused-vars

  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number; field: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; field: string; value: string } | null>(null);

  const tableRef = useRef<HTMLTableElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load factories
      const { data: factoriesData } = await supabase
        .from('trimble_delivery_factories')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('sort_order', { ascending: true });

      setFactories(factoriesData || []);

      // Load vehicles
      const { data: vehiclesData } = await supabase
        .from('trimble_delivery_vehicles')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('scheduled_date', { ascending: true })
        .order('sort_order', { ascending: true });

      setVehicles(vehiclesData || []);

      // Load items
      const { data: itemsData, error } = await supabase
        .from('trimble_delivery_items')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('scheduled_date', { ascending: true })
        .order('sort_order', { ascending: true });

      if (error) throw error;

      // Create vehicle code lookup
      const vehicleCodeMap = new Map<string, string>();
      const vehicleDateMap = new Map<string, string | null>();
      const vehicleTimeMap = new Map<string, string | null>();

      (vehiclesData || []).forEach(v => {
        vehicleCodeMap.set(v.id, v.vehicle_code);
        vehicleDateMap.set(v.id, v.scheduled_date);
        vehicleTimeMap.set(v.id, v.unload_start_time || null);
      });

      // Transform to spreadsheet rows
      const spreadsheetRows: SpreadsheetRow[] = (itemsData || []).map(item => ({
        id: `row_${item.id}`,
        item_id: item.id,
        vehicle_id: item.vehicle_id || null,
        vehicle_code: item.vehicle_id ? (vehicleCodeMap.get(item.vehicle_id) || '') : '',
        scheduled_date: item.scheduled_date,
        unload_start_time: item.vehicle_id ? (vehicleTimeMap.get(item.vehicle_id) || null) : null,
        guid: item.guid,
        guid_ifc: item.guid_ifc || null,
        assembly_mark: item.assembly_mark,
        sort_order: item.sort_order,
        isModified: false,
        originalData: {
          vehicle_id: item.vehicle_id || null,
          scheduled_date: item.scheduled_date,
          unload_start_time: item.vehicle_id ? (vehicleTimeMap.get(item.vehicle_id) || null) : null,
          assembly_mark: item.assembly_mark,
          sort_order: item.sort_order
        }
      }));

      setRows(spreadsheetRows);
    } catch (e) {
      console.error('Error loading data:', e);
      setMessage({ text: 'Viga andmete laadimisel', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  // Handle cell click
  const handleCellClick = (rowIndex: number, field: string) => {
    setSelectedCell({ rowIndex, field });
  };

  // Handle cell double click to edit
  const handleCellDoubleClick = (rowIndex: number, field: string) => {
    const row = rows[rowIndex];
    let value = '';

    switch (field) {
      case 'vehicle_code':
        value = row.vehicle_code;
        break;
      case 'scheduled_date':
        value = formatDate(row.scheduled_date);
        break;
      case 'unload_start_time':
        value = row.unload_start_time || '';
        break;
      case 'guid':
        value = row.guid_ifc || row.guid;
        break;
      case 'assembly_mark':
        value = row.assembly_mark;
        break;
      default:
        return;
    }

    setEditingCell({ rowIndex, field, value });
  };

  // Handle cell value change
  const handleCellChange = (value: string) => {
    if (!editingCell) return;
    setEditingCell({ ...editingCell, value });
  };

  // Commit cell edit
  const commitCellEdit = () => {
    if (!editingCell) return;

    const { rowIndex, field, value } = editingCell;

    setRows(prev => {
      const updated = [...prev];
      const updatedRow = { ...updated[rowIndex] };

      switch (field) {
        case 'vehicle_code': {
          // Find vehicle by code
          const vehicle = vehicles.find(v =>
            v.vehicle_code.toLowerCase() === value.toLowerCase()
          );
          if (vehicle) {
            updatedRow.vehicle_id = vehicle.id;
            updatedRow.vehicle_code = vehicle.vehicle_code;
            updatedRow.scheduled_date = vehicle.scheduled_date;
            updatedRow.unload_start_time = vehicle.unload_start_time || null;
          } else if (value.trim() === '') {
            updatedRow.vehicle_id = null;
            updatedRow.vehicle_code = '';
          }
          break;
        }
        case 'scheduled_date': {
          const parsed = parseDate(value);
          updatedRow.scheduled_date = parsed;
          break;
        }
        case 'unload_start_time': {
          const parsed = parseTime(value);
          updatedRow.unload_start_time = parsed;
          break;
        }
        case 'assembly_mark':
          updatedRow.assembly_mark = value;
          break;
      }

      // Check if modified
      updatedRow.isModified =
        updatedRow.vehicle_id !== updatedRow.originalData.vehicle_id ||
        updatedRow.scheduled_date !== updatedRow.originalData.scheduled_date ||
        updatedRow.assembly_mark !== updatedRow.originalData.assembly_mark ||
        updatedRow.sort_order !== updatedRow.originalData.sort_order;

      updated[rowIndex] = updatedRow;
      return updated;
    });

    setEditingCell(null);
    setSelectedCell({ rowIndex, field });
  };

  // Cancel cell edit
  const cancelCellEdit = () => {
    setEditingCell(null);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editingCell) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCellEdit();
        // Move to next row
        if (editingCell.rowIndex < rows.length - 1) {
          setSelectedCell({ rowIndex: editingCell.rowIndex + 1, field: editingCell.field });
        }
      } else if (e.key === 'Escape') {
        cancelCellEdit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitCellEdit();
        // Move to next field
        const fields = ['vehicle_code', 'scheduled_date', 'unload_start_time', 'guid', 'assembly_mark'];
        const currentIndex = fields.indexOf(editingCell.field);
        if (e.shiftKey) {
          if (currentIndex > 0) {
            setSelectedCell({ rowIndex: editingCell.rowIndex, field: fields[currentIndex - 1] });
          } else if (editingCell.rowIndex > 0) {
            setSelectedCell({ rowIndex: editingCell.rowIndex - 1, field: fields[fields.length - 1] });
          }
        } else {
          if (currentIndex < fields.length - 1) {
            setSelectedCell({ rowIndex: editingCell.rowIndex, field: fields[currentIndex + 1] });
          } else if (editingCell.rowIndex < rows.length - 1) {
            setSelectedCell({ rowIndex: editingCell.rowIndex + 1, field: fields[0] });
          }
        }
      }
    } else if (selectedCell) {
      const fields = ['vehicle_code', 'scheduled_date', 'unload_start_time', 'guid', 'assembly_mark'];
      const currentFieldIndex = fields.indexOf(selectedCell.field);

      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        handleCellDoubleClick(selectedCell.rowIndex, selectedCell.field);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedCell.rowIndex < rows.length - 1) {
          setSelectedCell({ rowIndex: selectedCell.rowIndex + 1, field: selectedCell.field });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedCell.rowIndex > 0) {
          setSelectedCell({ rowIndex: selectedCell.rowIndex - 1, field: selectedCell.field });
        }
      } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        if (currentFieldIndex < fields.length - 1) {
          setSelectedCell({ rowIndex: selectedCell.rowIndex, field: fields[currentFieldIndex + 1] });
        } else if (selectedCell.rowIndex < rows.length - 1) {
          setSelectedCell({ rowIndex: selectedCell.rowIndex + 1, field: fields[0] });
        }
      } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        if (currentFieldIndex > 0) {
          setSelectedCell({ rowIndex: selectedCell.rowIndex, field: fields[currentFieldIndex - 1] });
        } else if (selectedCell.rowIndex > 0) {
          setSelectedCell({ rowIndex: selectedCell.rowIndex - 1, field: fields[fields.length - 1] });
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Start editing on any character key
        handleCellDoubleClick(selectedCell.rowIndex, selectedCell.field);
      }
    }
  };

  // Save all changes
  const saveChanges = async () => {
    const modifiedRows = rows.filter(r => r.isModified);
    if (modifiedRows.length === 0) {
      setMessage({ text: 'Muudatusi pole', type: 'info' });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      let successCount = 0;
      let errorCount = 0;

      for (const row of modifiedRows) {
        // Update item
        const { error: itemError } = await supabase
          .from('trimble_delivery_items')
          .update({
            vehicle_id: row.vehicle_id,
            scheduled_date: row.scheduled_date,
            assembly_mark: row.assembly_mark,
            sort_order: row.sort_order,
            updated_at: new Date().toISOString()
          })
          .eq('id', row.item_id);

        if (itemError) {
          console.error('Error updating item:', row.item_id, itemError);
          errorCount++;
        } else {
          successCount++;
        }
      }

      if (errorCount > 0) {
        setMessage({ text: `${successCount} salvestatud, ${errorCount} viga`, type: 'error' });
      } else {
        setMessage({ text: `${successCount} muudatust salvestatud`, type: 'success' });
        // Reload to get fresh data and reset modified flags
        await loadData();
      }
    } catch (e) {
      console.error('Error saving changes:', e);
      setMessage({ text: 'Viga salvestamisel', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Get count of modified rows
  const modifiedCount = rows.filter(r => r.isModified).length;

  // Render cell content
  const renderCell = (row: SpreadsheetRow, rowIndex: number, field: string) => {
    const isSelected = selectedCell?.rowIndex === rowIndex && selectedCell?.field === field;
    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.field === field;

    let displayValue = '';
    switch (field) {
      case 'vehicle_code':
        displayValue = row.vehicle_code;
        break;
      case 'scheduled_date':
        displayValue = formatDate(row.scheduled_date);
        break;
      case 'unload_start_time':
        displayValue = row.unload_start_time || '';
        break;
      case 'guid':
        displayValue = row.guid_ifc || row.guid;
        break;
      case 'assembly_mark':
        displayValue = row.assembly_mark;
        break;
    }

    if (isEditing) {
      return (
        <input
          ref={inputRef}
          type="text"
          className="cell-input"
          value={editingCell.value}
          onChange={(e) => handleCellChange(e.target.value)}
          onBlur={commitCellEdit}
        />
      );
    }

    return (
      <div
        className={`cell-content${isSelected ? ' selected' : ''}${row.isModified ? ' modified' : ''}`}
        onClick={() => handleCellClick(rowIndex, field)}
        onDoubleClick={() => handleCellDoubleClick(rowIndex, field)}
      >
        {displayValue}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="spreadsheet-editor">
        <div className="spreadsheet-loading">
          <FiRefreshCw className="spinning" size={24} />
          <span>Laadin andmeid...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="spreadsheet-editor" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Header */}
      <div className="spreadsheet-header">
        <h1>Tarnegraafiku redaktor</h1>
        <div className="spreadsheet-actions">
          {message && (
            <span className={`spreadsheet-message ${message.type}`}>
              {message.type === 'success' && <FiCheck size={14} />}
              {message.type === 'error' && <FiAlertTriangle size={14} />}
              {message.text}
            </span>
          )}
          {modifiedCount > 0 && (
            <span className="modified-count">{modifiedCount} muudetud</span>
          )}
          <button
            className="btn-refresh"
            onClick={loadData}
            disabled={saving}
            title="Värskenda"
          >
            <FiRefreshCw size={16} />
          </button>
          <button
            className="btn-save"
            onClick={saveChanges}
            disabled={saving || modifiedCount === 0}
          >
            <FiSave size={16} />
            {saving ? 'Salvestan...' : 'Salvesta'}
          </button>
          {onClose && (
            <button className="btn-close" onClick={onClose}>
              <FiX size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="spreadsheet-instructions">
        <span>Topeltklikk või Enter - muuda lahtrit</span>
        <span>Tab - järgmine lahter</span>
        <span>Nooled - navigeeri</span>
        <span>Esc - tühista</span>
      </div>

      {/* Table */}
      <div className="spreadsheet-table-wrapper">
        <table ref={tableRef} className="spreadsheet-table">
          <thead>
            <tr>
              <th className="col-nr">#</th>
              <th className="col-vehicle">Veok</th>
              <th className="col-date">Kuupäev</th>
              <th className="col-time">Kellaaeg</th>
              <th className="col-guid">GUID</th>
              <th className="col-mark">Assembly Mark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id} className={row.isModified ? 'row-modified' : ''}>
                <td className="col-nr">{rowIndex + 1}</td>
                <td className="col-vehicle">{renderCell(row, rowIndex, 'vehicle_code')}</td>
                <td className="col-date">{renderCell(row, rowIndex, 'scheduled_date')}</td>
                <td className="col-time">{renderCell(row, rowIndex, 'unload_start_time')}</td>
                <td className="col-guid">{renderCell(row, rowIndex, 'guid')}</td>
                <td className="col-mark">{renderCell(row, rowIndex, 'assembly_mark')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="spreadsheet-footer">
        <span>{rows.length} rida</span>
        <span>{vehicles.length} veokid</span>
      </div>
    </div>
  );
}
