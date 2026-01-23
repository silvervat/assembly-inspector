import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, DeliveryVehicle } from '../supabase';
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
  product_name: string;
  cast_unit_weight: string;
  sort_order: number;
  isModified: boolean;
  originalData: {
    vehicle_id: string | null;
    scheduled_date: string | null;
  };
}

type CellKey = `${number}-${string}`;

// Editable fields only - assembly_mark, product_name, weight are read-only
const EDITABLE_FIELDS = ['vehicle_code', 'scheduled_date', 'unload_start_time'];
const ALL_FIELDS = ['vehicle_code', 'scheduled_date', 'unload_start_time', 'guid', 'assembly_mark', 'product_name', 'cast_unit_weight'];

// Parse date from various formats to YYYY-MM-DD
const parseDate = (value: string): string | null => {
  if (!value || value.trim() === '') return null;
  const ddmmyyyy = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const ddmmyy = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (ddmmyy) {
    const [, day, month, year] = ddmmyy;
    const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;
  return null;
};

// Format date for display (DD.MM.YYYY)
const formatDate = (date: string | null): string => {
  if (!date) return '';
  try {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  } catch {
    return date;
  }
};

// Parse time from various formats to HH:MM
const parseTime = (value: string): string | null => {
  if (!value || value.trim() === '') return null;
  const hhmm = value.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) return `${hhmm[1].padStart(2, '0')}:${hhmm[2]}`;
  const nocolon = value.match(/^(\d{2})(\d{2})$/);
  if (nocolon) return `${nocolon[1]}:${nocolon[2]}`;
  return null;
};

export default function DeliverySpreadsheetEditor({ projectId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [vehicles, setVehicles] = useState<DeliveryVehicle[]>([]);

  // Multi-cell selection
  const [selectedCells, setSelectedCells] = useState<Set<CellKey>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; field: string; value: string } | null>(null);
  const [selectionStart, setSelectionStart] = useState<{ rowIndex: number; field: string } | null>(null);

  // Column widths (resizable)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    vehicle_code: 80,
    scheduled_date: 90,
    unload_start_time: 70,
    guid: 240,
    assembly_mark: 120,
    product_name: 150,
    cast_unit_weight: 70
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  const tableRef = useRef<HTMLTableElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
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

      // Create vehicle lookup maps
      const vehicleCodeMap = new Map<string, string>();
      const vehicleTimeMap = new Map<string, string | null>();
      (vehiclesData || []).forEach(v => {
        vehicleCodeMap.set(v.id, v.vehicle_code);
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
        assembly_mark: item.assembly_mark || '',
        product_name: item.product_name || '',
        cast_unit_weight: item.cast_unit_weight || '',
        sort_order: item.sort_order,
        isModified: false,
        originalData: {
          vehicle_id: item.vehicle_id || null,
          scheduled_date: item.scheduled_date
        }
      }));

      setRows(spreadsheetRows);
      setSelectedCells(new Set());
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

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent, field: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(field);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[field];
  };

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizeStartX.current;
      const newWidth = Math.max(40, resizeStartWidth.current + diff);
      setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  // Cell key helper
  const cellKey = (rowIndex: number, field: string): CellKey => `${rowIndex}-${field}`;

  // Handle cell click (with Ctrl for multi-select)
  const handleCellClick = (e: React.MouseEvent, rowIndex: number, field: string) => {
    if (editingCell) {
      commitCellEdit();
    }

    const key = cellKey(rowIndex, field);

    if (e.ctrlKey || e.metaKey) {
      // Toggle selection
      setSelectedCells(prev => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    } else if (e.shiftKey && selectionStart) {
      // Range selection
      const startRow = Math.min(selectionStart.rowIndex, rowIndex);
      const endRow = Math.max(selectionStart.rowIndex, rowIndex);
      const startFieldIdx = ALL_FIELDS.indexOf(selectionStart.field);
      const endFieldIdx = ALL_FIELDS.indexOf(field);
      const startField = Math.min(startFieldIdx, endFieldIdx);
      const endField = Math.max(startFieldIdx, endFieldIdx);

      const newSelection = new Set<CellKey>();
      for (let r = startRow; r <= endRow; r++) {
        for (let f = startField; f <= endField; f++) {
          newSelection.add(cellKey(r, ALL_FIELDS[f]));
        }
      }
      setSelectedCells(newSelection);
    } else {
      // Single selection
      setSelectedCells(new Set([key]));
      setSelectionStart({ rowIndex, field });
    }
  };

  // Handle cell double click to edit
  const handleCellDoubleClick = (rowIndex: number, field: string) => {
    if (!EDITABLE_FIELDS.includes(field)) return; // Only editable fields

    const row = rows[rowIndex];
    let value = '';
    switch (field) {
      case 'vehicle_code': value = row.vehicle_code; break;
      case 'scheduled_date': value = formatDate(row.scheduled_date); break;
      case 'unload_start_time': value = row.unload_start_time || ''; break;
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
          const vehicle = vehicles.find(v => v.vehicle_code.toLowerCase() === value.toLowerCase());
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
          updatedRow.scheduled_date = parseDate(value);
          break;
        }
        case 'unload_start_time': {
          updatedRow.unload_start_time = parseTime(value);
          break;
        }
      }

      updatedRow.isModified =
        updatedRow.vehicle_id !== updatedRow.originalData.vehicle_id ||
        updatedRow.scheduled_date !== updatedRow.originalData.scheduled_date;

      updated[rowIndex] = updatedRow;
      return updated;
    });

    setEditingCell(null);
  };

  // Delete selected cells (clear editable fields)
  const deleteSelectedCells = () => {
    if (selectedCells.size === 0) return;

    setRows(prev => {
      const updated = [...prev];
      selectedCells.forEach(key => {
        const [rowStr, field] = key.split('-');
        const rowIndex = parseInt(rowStr);
        if (!EDITABLE_FIELDS.includes(field)) return; // Only clear editable fields

        const updatedRow = { ...updated[rowIndex] };
        switch (field) {
          case 'vehicle_code':
            updatedRow.vehicle_id = null;
            updatedRow.vehicle_code = '';
            break;
          case 'scheduled_date':
            updatedRow.scheduled_date = null;
            break;
          case 'unload_start_time':
            updatedRow.unload_start_time = null;
            break;
        }
        updatedRow.isModified =
          updatedRow.vehicle_id !== updatedRow.originalData.vehicle_id ||
          updatedRow.scheduled_date !== updatedRow.originalData.scheduled_date;
        updated[rowIndex] = updatedRow;
      });
      return updated;
    });
  };

  // Paste text into selected cells
  const doPaste = (text: string) => {
    if (selectedCells.size === 0 || !text) return;

    // Parse pasted data (tab-separated columns, newline-separated rows)
    const pastedRows = text.split(/\r?\n/).filter(line => line.length > 0).map(line => line.split('\t'));

    // Find top-left of selection
    let minRow = Infinity, minFieldIdx = Infinity;
    selectedCells.forEach(key => {
      const [rowStr, field] = key.split('-');
      const rowIndex = parseInt(rowStr);
      const fieldIdx = ALL_FIELDS.indexOf(field);
      if (rowIndex < minRow) minRow = rowIndex;
      if (fieldIdx < minFieldIdx) minFieldIdx = fieldIdx;
    });

    setRows(prev => {
      const updated = [...prev];
      pastedRows.forEach((pastedCols, pasteRowOffset) => {
        const targetRow = minRow + pasteRowOffset;
        if (targetRow >= updated.length) return;

        pastedCols.forEach((value, pasteColOffset) => {
          const targetFieldIdx = minFieldIdx + pasteColOffset;
          if (targetFieldIdx >= ALL_FIELDS.length) return;

          const field = ALL_FIELDS[targetFieldIdx];
          if (!EDITABLE_FIELDS.includes(field)) return;

          const updatedRow = { ...updated[targetRow] };
          const trimmedValue = value.trim();

          switch (field) {
            case 'vehicle_code': {
              const vehicle = vehicles.find(v => v.vehicle_code.toLowerCase() === trimmedValue.toLowerCase());
              if (vehicle) {
                updatedRow.vehicle_id = vehicle.id;
                updatedRow.vehicle_code = vehicle.vehicle_code;
                updatedRow.scheduled_date = vehicle.scheduled_date;
                updatedRow.unload_start_time = vehicle.unload_start_time || null;
              } else if (trimmedValue === '') {
                updatedRow.vehicle_id = null;
                updatedRow.vehicle_code = '';
              }
              break;
            }
            case 'scheduled_date':
              updatedRow.scheduled_date = parseDate(trimmedValue) || (trimmedValue === '' ? null : updatedRow.scheduled_date);
              break;
            case 'unload_start_time':
              updatedRow.unload_start_time = parseTime(trimmedValue) || (trimmedValue === '' ? null : updatedRow.unload_start_time);
              break;
          }
          updatedRow.isModified =
            updatedRow.vehicle_id !== updatedRow.originalData.vehicle_id ||
            updatedRow.scheduled_date !== updatedRow.originalData.scheduled_date;
          updated[targetRow] = updatedRow;
        });
      });
      return updated;
    });

    setMessage({ text: `Kleebitud ${pastedRows.length} rida`, type: 'success' });
  };

  // Handle keyboard navigation and actions
  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (editingCell) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCellEdit();
      } else if (e.key === 'Escape') {
        setEditingCell(null);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitCellEdit();
      }
      return;
    }

    // Ctrl+V - paste from clipboard
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        if (text && selectedCells.size > 0) {
          doPaste(text);
        }
      } catch (err) {
        console.warn('Could not read clipboard:', err);
      }
      return;
    }

    // Delete key - clear selected cells
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelectedCells();
      return;
    }

    // Get first selected cell for navigation
    if (selectedCells.size === 0) return;
    const firstKey = [...selectedCells][0];
    const [rowStr, field] = firstKey.split('-');
    const rowIndex = parseInt(rowStr);
    const fieldIdx = ALL_FIELDS.indexOf(field);

    // Enter or F2 to edit
    if ((e.key === 'Enter' || e.key === 'F2') && EDITABLE_FIELDS.includes(field)) {
      e.preventDefault();
      handleCellDoubleClick(rowIndex, field);
      return;
    }

    // Arrow navigation
    let newRow = rowIndex;
    let newFieldIdx = fieldIdx;

    if (e.key === 'ArrowDown') newRow = Math.min(rows.length - 1, rowIndex + 1);
    else if (e.key === 'ArrowUp') newRow = Math.max(0, rowIndex - 1);
    else if (e.key === 'ArrowRight' || e.key === 'Tab') newFieldIdx = Math.min(ALL_FIELDS.length - 1, fieldIdx + 1);
    else if (e.key === 'ArrowLeft') newFieldIdx = Math.max(0, fieldIdx - 1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && EDITABLE_FIELDS.includes(field)) {
      handleCellDoubleClick(rowIndex, field);
      return;
    } else {
      return;
    }

    e.preventDefault();
    const newKey = cellKey(newRow, ALL_FIELDS[newFieldIdx]);

    if (e.shiftKey) {
      setSelectedCells(prev => new Set([...prev, newKey]));
    } else {
      setSelectedCells(new Set([newKey]));
      setSelectionStart({ rowIndex: newRow, field: ALL_FIELDS[newFieldIdx] });
    }
  };

  // Setup paste listener (fallback for when Ctrl+V doesn't work via keyboard)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pasteHandler = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text && selectedCells.size > 0) {
        e.preventDefault();
        doPaste(text);
      }
    };
    container.addEventListener('paste', pasteHandler as EventListener);
    return () => container.removeEventListener('paste', pasteHandler as EventListener);
  }, [selectedCells, vehicles]);

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
        const { error: itemError } = await supabase
          .from('trimble_delivery_items')
          .update({
            vehicle_id: row.vehicle_id,
            scheduled_date: row.scheduled_date,
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
        await loadData();
      }
    } catch (e) {
      console.error('Error saving changes:', e);
      setMessage({ text: 'Viga salvestamisel', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const modifiedCount = rows.filter(r => r.isModified).length;

  // Render cell content
  const renderCell = (row: SpreadsheetRow, rowIndex: number, field: string) => {
    const key = cellKey(rowIndex, field);
    const isSelected = selectedCells.has(key);
    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.field === field;
    const isEditable = EDITABLE_FIELDS.includes(field);

    let displayValue = '';
    switch (field) {
      case 'vehicle_code': displayValue = row.vehicle_code; break;
      case 'scheduled_date': displayValue = formatDate(row.scheduled_date); break;
      case 'unload_start_time': displayValue = row.unload_start_time || ''; break;
      case 'guid': displayValue = row.guid_ifc || row.guid; break;
      case 'assembly_mark': displayValue = row.assembly_mark; break;
      case 'product_name': displayValue = row.product_name; break;
      case 'cast_unit_weight': displayValue = row.cast_unit_weight ? `${row.cast_unit_weight}` : ''; break;
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
        className={`cell-content${isSelected ? ' selected' : ''}${row.isModified ? ' modified' : ''}${!isEditable ? ' readonly' : ''}`}
        onClick={(e) => handleCellClick(e, rowIndex, field)}
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
    <div
      ref={containerRef}
      className="spreadsheet-editor"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
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
          <button className="btn-refresh" onClick={loadData} disabled={saving} title="Värskenda">
            <FiRefreshCw size={16} />
          </button>
          <button className="btn-save" onClick={saveChanges} disabled={saving || modifiedCount === 0}>
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
        <span>Topeltklikk/Enter - muuda</span>
        <span>Ctrl+klikk - mitu lahtrit</span>
        <span>Shift+klikk - vahemik</span>
        <span>Delete - tühjenda</span>
        <span>Ctrl+V - kleebi</span>
      </div>

      {/* Table */}
      <div className="spreadsheet-table-wrapper">
        <table ref={tableRef} className="spreadsheet-table">
          <thead>
            <tr>
              <th className="col-nr" style={{ width: 40 }}>#</th>
              <th style={{ width: columnWidths.vehicle_code }}>
                Veok
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 'vehicle_code')} />
              </th>
              <th style={{ width: columnWidths.scheduled_date }}>
                Kuupäev
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 'scheduled_date')} />
              </th>
              <th style={{ width: columnWidths.unload_start_time }}>
                Kell
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 'unload_start_time')} />
              </th>
              <th style={{ width: columnWidths.guid }}>
                GUID
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 'guid')} />
              </th>
              <th style={{ width: columnWidths.assembly_mark }}>
                Mark
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 'assembly_mark')} />
              </th>
              <th style={{ width: columnWidths.product_name }}>
                Toode
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 'product_name')} />
              </th>
              <th style={{ width: columnWidths.cast_unit_weight }}>
                Kaal
                <div className="resize-handle" onMouseDown={(e) => handleResizeStart(e, 'cast_unit_weight')} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id} className={row.isModified ? 'row-modified' : ''}>
                <td className="col-nr">{rowIndex + 1}</td>
                <td>{renderCell(row, rowIndex, 'vehicle_code')}</td>
                <td>{renderCell(row, rowIndex, 'scheduled_date')}</td>
                <td>{renderCell(row, rowIndex, 'unload_start_time')}</td>
                <td className="col-guid">{renderCell(row, rowIndex, 'guid')}</td>
                <td>{renderCell(row, rowIndex, 'assembly_mark')}</td>
                <td>{renderCell(row, rowIndex, 'product_name')}</td>
                <td>{renderCell(row, rowIndex, 'cast_unit_weight')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="spreadsheet-footer">
        <span>{rows.length} rida</span>
        <span>{selectedCells.size} valitud</span>
      </div>
    </div>
  );
}
