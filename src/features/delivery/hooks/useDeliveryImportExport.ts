import { useState, useCallback } from 'react';

interface ImportProgress {
  stage: 'idle' | 'searching' | 'fetching' | 'saving';
  current: number;
  total: number;
  message: string;
}

interface ParsedImportRow {
  guid: string;
  date?: string;
  time?: string;
  vehicleCode?: string;
  factoryCode?: string;
  comment?: string;
}

export function useDeliveryImportExport() {
  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFactoryId, setImportFactoryId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    stage: 'idle', current: 0, total: 0, message: '',
  });
  const [parsedImportData, setParsedImportData] = useState<ParsedImportRow[]>([]);

  // Export state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportLanguage, setExportLanguage] = useState<'et' | 'en'>('et');

  // Comparison state
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [importMode, setImportMode] = useState<'add_new' | 'update_all'>('update_all');
  const [importSourceDescription, setImportSourceDescription] = useState('');

  const resetImportState = useCallback(() => {
    setImportText('');
    setImportFactoryId('');
    setImporting(false);
    setImportProgress({ stage: 'idle', current: 0, total: 0, message: '' });
    setParsedImportData([]);
  }, []);

  return {
    // Import
    showImportModal, setShowImportModal,
    importText, setImportText,
    importFactoryId, setImportFactoryId,
    importing, setImporting,
    importProgress, setImportProgress,
    parsedImportData, setParsedImportData,
    resetImportState,
    // Export
    showExportModal, setShowExportModal,
    exportLanguage, setExportLanguage,
    // Comparison
    showComparisonModal, setShowComparisonModal,
    comparisonResult, setComparisonResult,
    comparisonLoading, setComparisonLoading,
    importMode, setImportMode,
    importSourceDescription, setImportSourceDescription,
  };
}
