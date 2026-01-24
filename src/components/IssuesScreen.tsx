import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import {
  supabase,
  TrimbleExUser,
  Issue,
  IssueStatus,
  IssuePriority,
  IssueSource,
  IssueFixedCategory,
  IssueAssignment,
  IssueComment,
  IssueAttachment,
  IssueCategory,
  IssueActivityLog,
  ISSUE_STATUS_CONFIG,
  ISSUE_PRIORITY_CONFIG,
  ISSUE_FIXED_CATEGORY_CONFIG,
  ACTIVITY_ACTION_LABELS
} from '../supabase';
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';
import { findObjectsInLoadedModels } from '../utils/navigationHelper';
import * as XLSX from 'xlsx-js-style';
import {
  FiPlus, FiSearch, FiChevronDown, FiChevronRight,
  FiEdit2, FiTrash2, FiX, FiCamera, FiDownload,
  FiRefreshCw, FiFilter, FiUser, FiAlertTriangle, FiAlertCircle,
  FiCheckCircle, FiLoader, FiCheckSquare, FiMoreVertical,
  FiTarget, FiMessageSquare, FiActivity, FiLayers, FiSend,
  FiArrowUp, FiArrowDown, FiMinus, FiAlertOctagon, FiEye, FiLink
} from 'react-icons/fi';
import PageHeader from './PageHeader';
import { InspectionMode } from './MainMenu';

// ============================================
// TYPES
// ============================================

interface IssuesScreenProps {
  api: WorkspaceAPI.WorkspaceAPI;
  user: TrimbleExUser;
  projectId: string;
  tcUserEmail: string;
  tcUserName?: string;
  onBackToMenu: () => void;
  onNavigate?: (mode: InspectionMode | null) => void;
  onColorModelWhite?: () => void;
  onOpenPartDatabase?: () => void;
}

interface SelectedObject {
  modelId: string;
  runtimeId: number;
  guidIfc: string;
  guidMs?: string;
  assemblyMark?: string;
  productName?: string;
  castUnitWeight?: string;
  castUnitPositionCode?: string;
}

// Team member from Trimble Connect API
interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  status: string;
}

// Filter state
interface IssueFilters {
  status: IssueStatus | 'all';
  priority: IssuePriority | 'all';
  category: string | 'all';
  assignedTo: string | 'all';
  source: IssueSource | 'all';
  dateRange: 'today' | 'week' | 'month' | 'all';
  overdue: boolean;
}

// Performance constants
const COLOR_BATCH_SIZE = 100;
const WHITE_COLOR = { r: 255, g: 255, b: 255, a: 255 };

// Status icons mapping (4 statuses only)
const STATUS_ICONS: Record<IssueStatus, React.ReactNode> = {
  nonconformance: <FiAlertTriangle size={14} />,
  in_progress: <FiLoader size={14} />,
  completed: <FiCheckCircle size={14} />,
  closed: <FiCheckSquare size={14} />
};

// Priority icons mapping
const PRIORITY_ICONS: Record<IssuePriority, React.ReactNode> = {
  low: <FiArrowDown size={12} />,
  medium: <FiMinus size={12} />,
  high: <FiArrowUp size={12} />,
  critical: <FiAlertOctagon size={12} />
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('et-EE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min tagasi`;
  if (diffHours < 24) return `${diffHours}h tagasi`;
  if (diffDays < 7) return `${diffDays}p tagasi`;
  return formatDate(dateStr);
}

function isOverdue(issue: Issue): boolean {
  if (!issue.due_date) return false;
  if (['closed', 'cancelled', 'completed'].includes(issue.status)) return false;
  const today = new Date().toISOString().split('T')[0];
  return issue.due_date < today;
}

// ============================================
// COMPONENT
// ============================================

export default function IssuesScreen({
  api,
  user,
  projectId,
  tcUserEmail,
  tcUserName,
  onBackToMenu,
  onNavigate,
  onColorModelWhite,
  onOpenPartDatabase
}: IssuesScreenProps) {
  // ============================================
  // STATE
  // ============================================

  // Data state
  const [issues, setIssues] = useState<Issue[]>([]);
  const [_categories, setCategories] = useState<IssueCategory[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [coloringStatus, setColoringStatus] = useState('');
  const [_selectedIssue, _setSelectedIssue] = useState<Issue | null>(null);
  const [highlightedIssueId, setHighlightedIssueId] = useState<string | null>(null);
  const [expandedStatuses, setExpandedStatuses] = useState<Set<IssueStatus>>(
    new Set(['nonconformance', 'in_progress'])
  );

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [newIssueObjects, setNewIssueObjects] = useState<SelectedObject[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    status: 'nonconformance' as IssueStatus,
    priority: 'medium' as IssuePriority,
    source: 'inspection' as IssueSource,
    category_id: '',
    fixed_category: '' as IssueFixedCategory | '',
    due_date: '',
    estimated_hours: '',
    estimated_cost: ''
  });

  // Detail view state
  const [showDetail, setShowDetail] = useState(false);
  const [detailIssue, setDetailIssue] = useState<Issue | null>(null);
  const [issueComments, setIssueComments] = useState<IssueComment[]>([]);
  const [issueAttachments, setIssueAttachments] = useState<IssueAttachment[]>([]);
  const [issueActivities, setIssueActivities] = useState<IssueActivityLog[]>([]);
  const [newComment, setNewComment] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Filter state
  const [filters, setFilters] = useState<IssueFilters>({
    status: 'all',
    priority: 'all',
    category: 'all',
    assignedTo: 'all',
    source: 'all',
    dateRange: 'all',
    overdue: false
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Assignment state
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assigningIssueId, setAssigningIssueId] = useState<string | null>(null);

  // Assembly selection enforcement state
  const [_assemblySelectionEnabled, setAssemblySelectionEnabled] = useState(true);
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);

  // Sub-details modal state - supports multiple parents
  const [showSubDetailsModal, setShowSubDetailsModal] = useState(false);
  const [loadingSubDetails, setLoadingSubDetails] = useState(false);
  const [subDetails, setSubDetails] = useState<{
    id: number;
    guidIfc: string;
    name: string;
    type: string;
    profile: string;
    color: { r: number; g: number; b: number; a: number };
  }[]>([]);
  const [selectedSubDetailsByParent, setSelectedSubDetailsByParent] = useState<Map<string, Set<number>>>(new Map());
  const [currentSubDetailsParentGuid, setCurrentSubDetailsParentGuid] = useState<string>('');
  const [subDetailModelId, setSubDetailModelId] = useState<string>('');
  const [lockedParentObjects, setLockedParentObjects] = useState<SelectedObject[]>([]);
  const [highlightedSubDetailId, setHighlightedSubDetailId] = useState<number | null>(null);

  // Status group menu state
  const [statusMenuOpen, setStatusMenuOpen] = useState<IssueStatus | null>(null);

  // Real-time selection state (for continuous monitoring)
  const [currentSelectedObjects, setCurrentSelectedObjects] = useState<SelectedObject[]>([]);

  // Refs
  const syncingToModelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formFileInputRef = useRef<HTMLInputElement>(null);

  // Property mappings
  const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);

  // Check assembly selection state
  const checkAssemblySelection = useCallback(async (): Promise<boolean> => {
    try {
      const settings = await api.viewer.getSettings();
      const enabled = !!settings.assemblySelection;
      setAssemblySelectionEnabled(enabled);
      return enabled;
    } catch (e) {
      console.warn('Could not get assembly selection settings:', e);
      return true;
    }
  }, [api]);

  // Enable assembly selection
  const enableAssemblySelection = useCallback(async () => {
    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: true });
      setAssemblySelectionEnabled(true);
      setShowAssemblyModal(false);
      setMessage('✅ Assembly Selection sisse lülitatud');
    } catch (e) {
      console.error('Failed to enable assembly selection:', e);
      setMessage('⚠️ Assembly Selection sisselülitamine ebaõnnestus');
    }
  }, [api]);

  // Disable assembly selection (for sub-details viewing)
  const disableAssemblySelection = useCallback(async () => {
    try {
      await (api.viewer as any).setSettings?.({ assemblySelection: false });
      setAssemblySelectionEnabled(false);
    } catch (e) {
      console.error('Failed to disable assembly selection:', e);
    }
  }, [api]);

  // Generate distinct colors for sub-details
  const generateSubDetailColors = useCallback((count: number): { r: number; g: number; b: number; a: number }[] => {
    const colors: { r: number; g: number; b: number; a: number }[] = [];
    const hueStep = 360 / count;
    for (let i = 0; i < count; i++) {
      const hue = (i * hueStep) % 360;
      // Convert HSL to RGB (saturation 70%, lightness 50%)
      const s = 0.7;
      const l = 0.5;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      const m = l - c / 2;
      let r = 0, g = 0, b = 0;
      if (hue < 60) { r = c; g = x; b = 0; }
      else if (hue < 120) { r = x; g = c; b = 0; }
      else if (hue < 180) { r = 0; g = c; b = x; }
      else if (hue < 240) { r = 0; g = x; b = c; }
      else if (hue < 300) { r = x; g = 0; b = c; }
      else { r = c; g = 0; b = x; }
      colors.push({
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
        a: 255
      });
    }
    return colors;
  }, []);

  // Load sub-details for selected assembly
  const loadSubDetails = useCallback(async (modelId: string, runtimeId: number, parentGuid: string, _parentObj?: SelectedObject) => {
    try {
      setLoadingSubDetails(true);

      // Lock the current parent objects so they don't change
      setLockedParentObjects([...newIssueObjects]);
      setCurrentSubDetailsParentGuid(parentGuid);

      // Get children of the selected assembly
      const children = await (api.viewer as any).getHierarchyChildren?.(modelId, [runtimeId]);

      if (!children || children.length === 0) {
        setMessage('⚠️ Valitud detailil pole alamdetaile');
        return;
      }

      const childIds = children.map((c: any) => c.id);
      const childProps: any[] = await api.viewer.getObjectProperties(modelId, childIds);
      const childGuids = await api.viewer.convertToObjectIds(modelId, childIds);
      const colors = generateSubDetailColors(children.length);

      // Map children with their properties, GUIDs and colors
      const subDetailsList = children.map((child: any, index: number) => {
        const props = childProps[index] || {};
        const guid = childGuids?.[index] || '';
        // Try to get type and profile from properties
        let type = props.name || 'Element';
        let profile = '';

        if (props.properties && Array.isArray(props.properties)) {
          for (const pset of props.properties) {
            const propArray = (pset as any).properties || [];
            for (const prop of propArray) {
              const propName = ((prop as any).name || '').toLowerCase();
              if (propName.includes('profile') || propName.includes('section')) {
                profile = String((prop as any).displayValue ?? (prop as any).value ?? '');
              }
              if (propName === 'type' || propName === 'objecttype') {
                type = String((prop as any).displayValue ?? (prop as any).value ?? type);
              }
            }
          }
        }

        return {
          id: child.id,
          guidIfc: guid,
          name: props.name || `Element ${index + 1}`,
          type: type,
          profile: profile,
          color: colors[index]
        };
      });

      // Disable assembly selection to allow sub-detail selection
      await disableAssemblySelection();

      // Color model white first - get ALL objects from all models
      setMessage('Värvin mudeli valgeks...');
      const models = await (api.viewer as any).getModels();
      for (const model of models) {
        try {
          const allObjects = await (api.viewer as any).getObjects(model.id, { loaded: true });
          if (allObjects && allObjects.length > 0) {
            const allRuntimeIds = allObjects.map((obj: any) => obj.id);
            for (let i = 0; i < allRuntimeIds.length; i += COLOR_BATCH_SIZE) {
              const batch = allRuntimeIds.slice(i, i + COLOR_BATCH_SIZE);
              await api.viewer.setObjectState(
                { modelObjectIds: [{ modelId: model.id, objectRuntimeIds: batch }] },
                { color: WHITE_COLOR }
              );
            }
          }
        } catch (e) {
          console.warn('Could not color model:', model.id, e);
        }
      }

      // Color each sub-detail with its unique color
      setMessage('Värvin alamdetaile...');
      for (const subDetail of subDetailsList) {
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: [subDetail.id] }] },
          { color: subDetail.color }
        );
      }

      // Zoom to the parent assembly
      await api.viewer.setSelection(
        { modelObjectIds: [{ modelId, objectRuntimeIds: [runtimeId] }] },
        'set'
      );
      await api.viewer.setCamera({ selected: true }, { animationTime: 500 });

      setSubDetails(subDetailsList);
      setSubDetailModelId(modelId);
      setHighlightedSubDetailId(null);
      setShowSubDetailsModal(true);
      setLoadingSubDetails(false);

    } catch (e) {
      console.error('Error loading sub-details:', e);
      setMessage('⚠️ Alamdetailide laadimine ebaõnnestus');
      setLoadingSubDetails(false);
      setLockedParentObjects([]);
    }
  }, [api, disableAssemblySelection, generateSubDetailColors, newIssueObjects]);

  // Handle sub-detail click - zoom to it
  const handleSubDetailClick = useCallback(async (subDetailId: number) => {
    try {
      await api.viewer.setSelection(
        { modelObjectIds: [{ modelId: subDetailModelId, objectRuntimeIds: [subDetailId] }] },
        'set'
      );
      await api.viewer.setCamera({ selected: true }, { animationTime: 300 });
    } catch (e) {
      console.error('Error selecting sub-detail:', e);
    }
  }, [api, subDetailModelId]);

  // Toggle sub-detail for linking to issue (per parent)
  const toggleSubDetailForIssue = useCallback((subDetailId: number) => {
    if (!currentSubDetailsParentGuid) return;

    setSelectedSubDetailsByParent(prev => {
      const next = new Map(prev);
      const parentSet = new Set(next.get(currentSubDetailsParentGuid) || []);

      if (parentSet.has(subDetailId)) {
        parentSet.delete(subDetailId);
      } else {
        parentSet.add(subDetailId);
      }

      next.set(currentSubDetailsParentGuid, parentSet);
      return next;
    });
  }, [currentSubDetailsParentGuid]);

  // Close sub-details modal and restore assembly selection
  const closeSubDetailsModal = useCallback(async () => {
    setShowSubDetailsModal(false);
    setSubDetails([]);
    setHighlightedSubDetailId(null);
    setCurrentSubDetailsParentGuid('');
    setLoadingSubDetails(false);
    // Restore locked parent objects (don't lose them!)
    // lockedParentObjects stays until form is closed
    // Clear model selection to avoid confusion
    try {
      await api.viewer.setSelection({ modelObjectIds: [] }, 'set');
    } catch (e) {
      console.warn('Could not clear selection:', e);
    }
    await enableAssemblySelection();
  }, [api, enableAssemblySelection]);

  // Listen for selection changes when sub-details modal is open
  useEffect(() => {
    if (!showSubDetailsModal || subDetails.length === 0) return;

    const checkSubDetailSelection = async () => {
      try {
        const selection = await api.viewer.getSelection();
        if (!selection || selection.length === 0) {
          setHighlightedSubDetailId(null);
          return;
        }

        const firstSel = selection[0];
        if (!firstSel.objectRuntimeIds || firstSel.objectRuntimeIds.length === 0) {
          setHighlightedSubDetailId(null);
          return;
        }

        const selectedRuntimeId = firstSel.objectRuntimeIds[0];
        const found = subDetails.find(sd => sd.id === selectedRuntimeId);
        if (found) {
          setHighlightedSubDetailId(found.id);
          // Auto-scroll to highlighted item
          const element = document.getElementById(`sub-detail-${found.id}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          setHighlightedSubDetailId(null);
        }
      } catch (e) {
        // Ignore errors
      }
    };

    // Poll for selection changes
    const interval = setInterval(checkSubDetailSelection, 300);
    return () => clearInterval(interval);
  }, [api, showSubDetailsModal, subDetails]);

  // Helper function to extract selected objects from current model selection
  const getSelectedObjectsFromModel = useCallback(async (): Promise<SelectedObject[]> => {
    const selection = await api.viewer.getSelection();
    if (!selection || selection.length === 0) return [];

    const selectedObjects: SelectedObject[] = [];

    for (const sel of selection) {
      if (!sel.objectRuntimeIds || sel.objectRuntimeIds.length === 0) continue;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const propsArray = await (api.viewer as any).getObjectProperties(sel.modelId, sel.objectRuntimeIds, { includeHidden: true });
        const guids = await api.viewer.convertToObjectIds(sel.modelId, sel.objectRuntimeIds);

        for (let i = 0; i < sel.objectRuntimeIds.length; i++) {
          const runtimeId = sel.objectRuntimeIds[i];
          const props = propsArray?.[i];
          const guid = guids?.[i] || '';

          // Extract assembly mark using property mappings with normalized name comparison
          let assemblyMark = '';
          const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

          if (propertyMappings && props?.properties && Array.isArray(props.properties)) {
            const mappingSetNorm = normalize(propertyMappings.assembly_mark_set);
            const mappingPropNorm = normalize(propertyMappings.assembly_mark_prop);

            // Iterate through property sets (Trimble API format: array of {set, properties: [{name, value, displayValue}]})
            for (const pset of props.properties) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const setName = (pset as any).set || (pset as any).name || '';
              const setNameNorm = normalize(setName);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const propArray = (pset as any).properties || [];

              for (const prop of propArray) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const propName = (prop as any).name || '';
                const propNameNorm = normalize(propName);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const propValue = (prop as any).displayValue ?? (prop as any).value;

                if (!propValue) continue;

                // Check if this matches the configured assembly mark mapping
                if (setNameNorm === mappingSetNorm && propNameNorm === mappingPropNorm) {
                  assemblyMark = String(propValue);
                  break;
                }
                // Fallback: look for common patterns
                if (!assemblyMark && propNameNorm.includes('cast') && propNameNorm.includes('mark')) {
                  assemblyMark = String(propValue);
                }
                if (!assemblyMark && propNameNorm.includes('assembly') && propNameNorm.includes('mark')) {
                  assemblyMark = String(propValue);
                }
              }
              if (assemblyMark) break;
            }
          }

          // If no assembly mark from properties, try to get from database
          if (!assemblyMark && guid && projectId) {
            try {
              const { data: dbObj } = await supabase
                .from('trimble_model_objects')
                .select('assembly_mark, product_name')
                .eq('trimble_project_id', projectId)
                .eq('guid_ifc', guid.toLowerCase())
                .maybeSingle();
              if (dbObj?.assembly_mark) {
                assemblyMark = dbObj.assembly_mark;
              }
            } catch {
              // Ignore database errors
            }
          }

          selectedObjects.push({
            modelId: sel.modelId,
            runtimeId,
            guidIfc: guid,
            assemblyMark: assemblyMark || props?.name || '',
            productName: props?.name,
            castUnitWeight: props?.propertySets?.['Tekla Assembly']?.['Cast_unit_Weight']?.toString(),
            castUnitPositionCode: props?.propertySets?.['Tekla Assembly']?.['Cast_unit_Position_Code']?.toString()
          });
        }
      } catch (e) {
        console.error('Error getting object properties:', e);
      }
    }

    return selectedObjects;
  }, [api, propertyMappings, projectId]);

  // Continuous selection monitoring - always active to track current selection
  useEffect(() => {
    if (!api) return;

    const updateCurrentSelection = async () => {
      try {
        const objects = await getSelectedObjectsFromModel();
        setCurrentSelectedObjects(objects);

        // If form is open and not editing, update the form's objects too
        // BUT NOT when sub-details modal is open (parent details should be locked)
        if (showForm && !editingIssue && !showSubDetailsModal) {
          setNewIssueObjects(objects);
        }
      } catch (e) {
        // Ignore errors during polling
      }
    };

    // Initial update
    updateCurrentSelection();

    // Poll for selection changes every 500ms
    const interval = setInterval(updateCurrentSelection, 500);

    return () => {
      clearInterval(interval);
    };
  }, [api, getSelectedObjectsFromModel, showForm, editingIssue, showSubDetailsModal]);

  // ============================================
  // DATA LOADING
  // ============================================

  const loadIssues = useCallback(async () => {
    try {
      setLoading(true);

      // Load issues with objects, assignments, and counts
      const { data: issuesData, error: issuesError } = await supabase
        .from('issues')
        .select(`
          *,
          category:issue_categories(*),
          objects:issue_objects(*),
          assignments:issue_assignments(*),
          comments:issue_comments(count),
          attachments:issue_attachments(count)
        `)
        .eq('trimble_project_id', projectId)
        .order('detected_at', { ascending: false });

      if (issuesError) throw issuesError;

      // Process issues with counts
      const issuesWithCounts = (issuesData || []).map((issue: any) => ({
        ...issue,
        objects: issue.objects || [],
        assignments: (issue.assignments || []).filter((a: IssueAssignment) => a.is_active),
        comments_count: issue.comments?.[0]?.count || 0,
        attachments_count: issue.attachments?.[0]?.count || 0,
        comments: undefined, // Remove the raw count array
        attachments: undefined // Remove the raw count array
      }));

      setIssues(issuesWithCounts);

    } catch (e: unknown) {
      console.error('Error loading issues:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadCategories = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('issue_categories')
        .select('*')
        .eq('trimble_project_id', projectId)
        .eq('is_active', true)
        .order('sort_order');

      if (!error && data) {
        setCategories(data);
      }
    } catch (e) {
      console.error('Error loading categories:', e);
    }
  }, [projectId]);

  const loadTeamMembers = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const team = await (api.project as any).getMembers?.();
      if (team && Array.isArray(team)) {
        const members = team.map((member: { id?: string; email?: string; firstName?: string; lastName?: string; role?: string; status?: string }) => ({
          id: member.id || '',
          email: member.email || '',
          firstName: member.firstName || '',
          lastName: member.lastName || '',
          fullName: `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email || '',
          role: member.role || '',
          status: member.status || ''
        }));
        setTeamMembers(members.filter(m => m.status === 'ACTIVE'));
      }
    } catch (e) {
      console.error('Error loading team:', e);
    }
  }, [api]);

  // Initial load
  useEffect(() => {
    loadIssues();
    loadCategories();
    loadTeamMembers();
  }, [loadIssues, loadCategories, loadTeamMembers]);

  // ============================================
  // MODEL COLORING
  // ============================================

  const colorModelByIssueStatus = useCallback(async () => {
    if (!api || !projectId) return;

    setColoringStatus('Värvin mudelit...');

    try {
      // 1. Load all model objects from database
      const { data: modelObjects, error: moError } = await supabase
        .from('trimble_model_objects')
        .select('guid_ifc, model_id')
        .eq('trimble_project_id', projectId);

      if (moError) throw moError;
      if (!modelObjects || modelObjects.length === 0) {
        console.log('📦 No model objects found');
        setColoringStatus('');
        return;
      }

      // 2. Find runtime IDs in model
      const guids = modelObjects.map(obj => obj.guid_ifc).filter((g): g is string => !!g);
      const foundObjects = await findObjectsInLoadedModels(api, guids);

      // 3. Color ALL objects white first
      const allByModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!allByModel[found.modelId]) allByModel[found.modelId] = [];
        allByModel[found.modelId].push(found.runtimeId);
      }

      for (const [modelId, runtimeIds] of Object.entries(allByModel)) {
        for (let i = 0; i < runtimeIds.length; i += COLOR_BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + COLOR_BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: WHITE_COLOR }
          );
        }
      }

      // 4. Load all issues with their objects for this project
      const { data: projectIssues, error: ioError } = await supabase
        .from('issues')
        .select(`
          id,
          status,
          objects:issue_objects(guid_ifc, model_id)
        `)
        .eq('trimble_project_id', projectId);

      if (ioError) throw ioError;
      if (!projectIssues || projectIssues.length === 0) {
        console.log('✅ Model colored white, no issues');
        setColoringStatus('');
        return;
      }

      // 5. Color each issue object with its status color
      for (const issue of projectIssues) {
        if (!issue.objects || issue.objects.length === 0) continue;
        const status = issue.status as IssueStatus;
        if (!status) continue;

        for (const obj of issue.objects) {
          if (!obj.guid_ifc) continue;
          const found = foundObjects.get(obj.guid_ifc.toLowerCase());
          if (found) {
            const color = ISSUE_STATUS_CONFIG[status].modelColor;
            await api.viewer.setObjectState(
              { modelObjectIds: [{ modelId: found.modelId, objectRuntimeIds: [found.runtimeId] }] },
              { color }
            );
          }
        }
      }

      console.log(`✅ Model colored: ${projectIssues.length} issues`);
      setColoringStatus('');

    } catch (e: unknown) {
      console.error('❌ Error coloring model:', e);
      setColoringStatus('');
    }
  }, [api, projectId]);

  // Color on load
  useEffect(() => {
    if (!loading && issues.length >= 0) {
      colorModelByIssueStatus();
    }
  }, [loading, colorModelByIssueStatus]);

  // ============================================
  // MODEL SELECTION SYNC
  // ============================================

  const handleModelSelectionChange = useCallback(async () => {
    if (syncingToModelRef.current) return;

    try {
      const selection = await api.viewer.getSelection();
      if (!selection || selection.length === 0) {
        setHighlightedIssueId(null);
        return;
      }

      // Get GUIDs of selected objects
      const firstSel = selection[0];
      if (!firstSel.objectRuntimeIds || firstSel.objectRuntimeIds.length === 0) return;
      const guids = await api.viewer.convertToObjectIds(
        firstSel.modelId,
        firstSel.objectRuntimeIds
      );

      if (!guids || guids.length === 0) return;

      // Find issue with this GUID
      const guidLower = guids[0].toLowerCase();
      const matchingIssue = issues.find(
        i => i.objects?.some(o => o.guid_ifc?.toLowerCase() === guidLower)
      );

      if (matchingIssue) {
        setHighlightedIssueId(matchingIssue.id);

        // Scroll to issue in list
        const element = document.getElementById(`issue-card-${matchingIssue.id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Expand status group if collapsed
        if (!expandedStatuses.has(matchingIssue.status)) {
          setExpandedStatuses(prev => new Set([...prev, matchingIssue.status]));
        }
      } else {
        setHighlightedIssueId(null);
      }

    } catch (e) {
      console.error('Error handling model selection:', e);
    }
  }, [api, issues, expandedStatuses]);

  // Poll for model selection changes (like other components do)
  useEffect(() => {
    if (!api) return;

    // Poll for selection changes every 1 second
    const interval = setInterval(() => {
      handleModelSelectionChange();
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [api, handleModelSelectionChange]);

  // Select issue in model (List -> Model)
  const selectIssueInModel = useCallback(async (issue: Issue) => {
    if (!issue.objects || issue.objects.length === 0) {
      setMessage('⚠️ Mittevastavus pole seotud mudeli objektiga');
      return;
    }

    syncingToModelRef.current = true;

    try {
      // Get all GUIDs for this issue
      const objectsByModel: Record<string, string[]> = {};
      for (const obj of issue.objects) {
        if (!objectsByModel[obj.model_id]) objectsByModel[obj.model_id] = [];
        objectsByModel[obj.model_id].push(obj.guid_ifc);
      }

      // Convert to runtime IDs and select
      const modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] = [];

      for (const [modelId, guids] of Object.entries(objectsByModel)) {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, guids);
        const validIds = runtimeIds.filter((id): id is number => id !== undefined && id !== null);
        if (validIds.length > 0) {
          modelObjectIds.push({ modelId, objectRuntimeIds: validIds });
        }
      }

      if (modelObjectIds.length > 0) {
        await api.viewer.setSelection({ modelObjectIds }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
      } else {
        setMessage('⚠️ Objekti ei leitud mudelist');
      }

    } catch (e: unknown) {
      console.error('Error selecting in model:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    } finally {
      setTimeout(() => {
        syncingToModelRef.current = false;
      }, 2000);
    }
  }, [api]);

  // Select all issues of a specific status in model
  const selectStatusInModel = useCallback(async (status: IssueStatus) => {
    const statusIssues = issues.filter(i => mapDeprecatedStatus(i.status) === status);
    if (statusIssues.length === 0) {
      setMessage('⚠️ Selles staatuses pole mittevastavusi');
      return;
    }

    syncingToModelRef.current = true;
    setStatusMenuOpen(null);

    try {
      // Collect all GUIDs from all issues of this status
      const objectsByModel: Record<string, string[]> = {};

      for (const issue of statusIssues) {
        for (const obj of (issue.objects || [])) {
          if (!objectsByModel[obj.model_id]) objectsByModel[obj.model_id] = [];
          if (obj.guid_ifc && !objectsByModel[obj.model_id].includes(obj.guid_ifc)) {
            objectsByModel[obj.model_id].push(obj.guid_ifc);
          }
        }
      }

      // Convert to runtime IDs and select
      const modelObjectIds: { modelId: string; objectRuntimeIds: number[] }[] = [];

      for (const [modelId, guids] of Object.entries(objectsByModel)) {
        const runtimeIds = await api.viewer.convertToObjectRuntimeIds(modelId, guids);
        const validIds = runtimeIds.filter((id): id is number => id !== undefined && id !== null);
        if (validIds.length > 0) {
          modelObjectIds.push({ modelId, objectRuntimeIds: validIds });
        }
      }

      if (modelObjectIds.length > 0) {
        await api.viewer.setSelection({ modelObjectIds }, 'set');
        await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
        setMessage(`✓ Valitud ${statusIssues.length} mittevastavust (${ISSUE_STATUS_CONFIG[status].label})`);
      } else {
        setMessage('⚠️ Objekte ei leitud mudelist');
      }

    } catch (e: unknown) {
      console.error('Error selecting status in model:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    } finally {
      setTimeout(() => {
        syncingToModelRef.current = false;
      }, 2000);
    }
  }, [api, issues]);

  // Color only issues of a specific status
  const colorStatusInModel = useCallback(async (status: IssueStatus) => {
    setStatusMenuOpen(null);
    setColoringStatus(`Värvin ${ISSUE_STATUS_CONFIG[status].label}...`);

    try {
      // Get issues of this status
      const statusIssues = issues.filter(i => mapDeprecatedStatus(i.status) === status);

      if (statusIssues.length === 0) {
        setMessage('⚠️ Selles staatuses pole mittevastavusi');
        setColoringStatus('');
        return;
      }

      // Get the color for this status
      const statusColor = ISSUE_STATUS_CONFIG[status].modelColor;

      // Collect all GUIDs and find in model
      const guids: string[] = [];
      for (const issue of statusIssues) {
        for (const obj of (issue.objects || [])) {
          if (obj.guid_ifc) guids.push(obj.guid_ifc);
        }
      }

      const foundObjects = await findObjectsInLoadedModels(api, guids);

      // Color by model
      const byModel: Record<string, number[]> = {};
      for (const [, found] of foundObjects) {
        if (!byModel[found.modelId]) byModel[found.modelId] = [];
        byModel[found.modelId].push(found.runtimeId);
      }

      for (const [modelId, runtimeIds] of Object.entries(byModel)) {
        for (let i = 0; i < runtimeIds.length; i += COLOR_BATCH_SIZE) {
          const batch = runtimeIds.slice(i, i + COLOR_BATCH_SIZE);
          await api.viewer.setObjectState(
            { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
            { color: statusColor }
          );
        }
      }

      setMessage(`✓ Värvitud ${statusIssues.length} mittevastavust`);
      setColoringStatus('');

    } catch (e: unknown) {
      console.error('Error coloring status:', e);
      setColoringStatus('');
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [api, issues]);

  // ============================================
  // ISSUE CRUD OPERATIONS
  // ============================================

  const handleCreateIssue = useCallback(async () => {
    // Check assembly selection first
    const isEnabled = await checkAssemblySelection();
    if (!isEnabled) {
      setShowAssemblyModal(true);
      return;
    }

    // Use currently selected objects
    setNewIssueObjects(currentSelectedObjects);

    // Reset form with today's date as discovery date
    const today = new Date().toISOString().split('T')[0];
    setFormData({
      title: '',
      description: '',
      location: '',
      status: 'nonconformance',
      priority: 'medium',
      source: 'inspection',
      category_id: '',
      fixed_category: '',
      due_date: today, // Default to today as discovery date
      estimated_hours: '',
      estimated_cost: ''
    });
    setEditingIssue(null);
    setShowForm(true);
  }, [checkAssemblySelection, currentSelectedObjects]);

  const handleSubmitIssue = useCallback(async () => {
    if (!formData.title.trim()) {
      setMessage('⚠️ Pealkiri on kohustuslik');
      return;
    }

    if (!formData.fixed_category) {
      setMessage('⚠️ Kategooria valimine on kohustuslik');
      return;
    }

    if (!editingIssue && newIssueObjects.length === 0) {
      setMessage('⚠️ Vähemalt üks detail peab olema valitud');
      return;
    }

    try {
      if (editingIssue) {
        // Update existing issue
        const { error } = await supabase
          .from('issues')
          .update({
            title: formData.title.trim(),
            description: formData.description.trim() || null,
            location: formData.location.trim() || null,
            status: formData.status,
            priority: formData.priority,
            source: formData.source,
            category_id: formData.category_id || null,
            fixed_category: formData.fixed_category || null,
            due_date: formData.due_date || null,
            estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
            estimated_cost: formData.estimated_cost ? parseFloat(formData.estimated_cost) : null,
            updated_by: tcUserEmail
          })
          .eq('id', editingIssue.id);

        if (error) throw error;

        setMessage('✅ Mittevastavus uuendatud');

      } else {
        // Create new issue
        const { data: newIssue, error: issueError } = await supabase
          .from('issues')
          .insert({
            trimble_project_id: projectId,
            title: formData.title.trim(),
            description: formData.description.trim() || null,
            location: formData.location.trim() || null,
            status: formData.status,
            priority: formData.priority,
            source: formData.source,
            category_id: formData.category_id || null,
            fixed_category: formData.fixed_category || null,
            due_date: formData.due_date || null,
            estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
            estimated_cost: formData.estimated_cost ? parseFloat(formData.estimated_cost) : null,
            reported_by: tcUserEmail,
            reported_by_name: tcUserName
          })
          .select()
          .single();

        if (issueError) throw issueError;

        // Add objects to issue
        const objectsToInsert = newIssueObjects.map((obj, index) => ({
          issue_id: newIssue.id,
          model_id: obj.modelId,
          guid_ifc: obj.guidIfc,
          guid_ms: obj.guidMs,
          assembly_mark: obj.assemblyMark,
          product_name: obj.productName,
          cast_unit_weight: obj.castUnitWeight,
          cast_unit_position_code: obj.castUnitPositionCode,
          is_primary: index === 0,
          sort_order: index,
          added_by: tcUserEmail
        }));

        const { error: objectsError } = await supabase
          .from('issue_objects')
          .insert(objectsToInsert);

        if (objectsError) throw objectsError;

        // Upload pending files if any
        if (pendingFiles.length > 0) {
          for (const file of pendingFiles) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const ext = file.name.split('.').pop() || 'jpg';
            const filename = `${projectId}/${newIssue.id}/${timestamp}.${ext}`;

            const { error: uploadError } = await supabase.storage
              .from('issue-attachments')
              .upload(filename, file);

            if (!uploadError) {
              const { data: urlData } = supabase.storage
                .from('issue-attachments')
                .getPublicUrl(filename);

              await supabase
                .from('issue_attachments')
                .insert({
                  issue_id: newIssue.id,
                  file_name: file.name,
                  file_url: urlData.publicUrl,
                  file_size: file.size,
                  mime_type: file.type,
                  attachment_type: file.type.startsWith('image/') ? 'photo' : 'document',
                  uploaded_by: tcUserEmail,
                  uploaded_by_name: tcUserName
                });
            }
          }
        }

        setMessage('✅ Mittevastavus loodud');
      }

      setShowForm(false);
      setNewIssueObjects([]);
      setPendingFiles([]);
      setSelectedSubDetailsByParent(new Map());
      setLockedParentObjects([]);
      await loadIssues();
      await colorModelByIssueStatus();

    } catch (e: unknown) {
      console.error('Error saving issue:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [formData, editingIssue, newIssueObjects, pendingFiles, projectId, tcUserEmail, tcUserName, loadIssues, colorModelByIssueStatus]);

  const handleDeleteIssue = useCallback(async (issueId: string) => {
    if (!confirm('Kas oled kindel, et soovid mittevastavust kustutada?')) return;

    try {
      const { error } = await supabase
        .from('issues')
        .delete()
        .eq('id', issueId);

      if (error) throw error;

      setMessage('✅ Mittevastavus kustutatud');
      setShowDetail(false);
      setDetailIssue(null);
      await loadIssues();
      await colorModelByIssueStatus();

    } catch (e: unknown) {
      console.error('Error deleting issue:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [loadIssues, colorModelByIssueStatus]);

  const handleStatusChange = useCallback(async (issueId: string, newStatus: IssueStatus) => {
    try {
      const { error } = await supabase
        .from('issues')
        .update({
          status: newStatus,
          updated_by: tcUserEmail
        })
        .eq('id', issueId);

      if (error) throw error;

      setMessage(`✅ Staatus muudetud: ${ISSUE_STATUS_CONFIG[newStatus].label}`);
      await loadIssues();
      await colorModelByIssueStatus();

      // Update detail view if open
      if (detailIssue?.id === issueId) {
        setDetailIssue(prev => prev ? { ...prev, status: newStatus } : null);
      }

    } catch (e: unknown) {
      console.error('Error changing status:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [tcUserEmail, loadIssues, colorModelByIssueStatus, detailIssue]);

  // ============================================
  // DETAIL VIEW
  // ============================================

  const openIssueDetail = useCallback(async (issue: Issue) => {
    setDetailIssue(issue);
    setShowDetail(true);

    // Load comments
    const { data: comments } = await supabase
      .from('issue_comments')
      .select('*')
      .eq('issue_id', issue.id)
      .order('created_at', { ascending: true });
    setIssueComments(comments || []);

    // Load attachments
    const { data: attachments } = await supabase
      .from('issue_attachments')
      .select('*')
      .eq('issue_id', issue.id)
      .order('uploaded_at', { ascending: false });
    setIssueAttachments(attachments || []);

    // Load activity
    const { data: activities } = await supabase
      .from('issue_activity_log')
      .select('*')
      .eq('issue_id', issue.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setIssueActivities(activities || []);

  }, []);

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim() || !detailIssue) return;

    try {
      const { error } = await supabase
        .from('issue_comments')
        .insert({
          issue_id: detailIssue.id,
          comment_text: newComment.trim(),
          author_email: tcUserEmail,
          author_name: tcUserName
        });

      if (error) throw error;

      // Log activity
      await supabase.from('issue_activity_log').insert({
        trimble_project_id: projectId,
        issue_id: detailIssue.id,
        action: 'comment_added',
        action_label: ACTIVITY_ACTION_LABELS.comment_added,
        actor_email: tcUserEmail,
        actor_name: tcUserName
      });

      setNewComment('');
      setMessage('✅ Kommentaar lisatud');

      // Reload comments
      const { data: comments } = await supabase
        .from('issue_comments')
        .select('*')
        .eq('issue_id', detailIssue.id)
        .order('created_at', { ascending: true });
      setIssueComments(comments || []);

    } catch (e: unknown) {
      console.error('Error adding comment:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [newComment, detailIssue, tcUserEmail, tcUserName, projectId]);

  // ============================================
  // PHOTO HANDLING
  // ============================================

  const handlePhotoUpload = useCallback(async (files: FileList | File[]) => {
    if (!detailIssue || files.length === 0) return;

    setUploadingPhoto(true);

    try {
      for (const file of Array.from(files)) {
        // Generate unique filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = file.name.split('.').pop() || 'jpg';
        const filename = `${projectId}/${detailIssue.id}/${timestamp}.${ext}`;

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('issue-attachments')
          .upload(filename, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('issue-attachments')
          .getPublicUrl(filename);

        // Save attachment record
        const { error: dbError } = await supabase
          .from('issue_attachments')
          .insert({
            issue_id: detailIssue.id,
            file_name: file.name,
            file_url: urlData.publicUrl,
            file_size: file.size,
            mime_type: file.type,
            attachment_type: file.type.startsWith('image/') ? 'photo' : 'document',
            uploaded_by: tcUserEmail,
            uploaded_by_name: tcUserName
          });

        if (dbError) throw dbError;
      }

      // Log activity
      await supabase.from('issue_activity_log').insert({
        trimble_project_id: projectId,
        issue_id: detailIssue.id,
        action: 'attachment_added',
        action_label: ACTIVITY_ACTION_LABELS.attachment_added,
        actor_email: tcUserEmail,
        actor_name: tcUserName,
        details: { count: files.length }
      });

      setMessage(`✅ ${files.length} fail(i) üles laetud`);

      // Reload attachments
      const { data: attachments } = await supabase
        .from('issue_attachments')
        .select('*')
        .eq('issue_id', detailIssue.id)
        .order('uploaded_at', { ascending: false });
      setIssueAttachments(attachments || []);

    } catch (e: unknown) {
      console.error('Error uploading photo:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    } finally {
      setUploadingPhoto(false);
    }
  }, [detailIssue, projectId, tcUserEmail, tcUserName]);

  // Paste handler for images
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!showDetail || !detailIssue) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            // Rename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const ext = file.type.split('/')[1] || 'png';
            const renamedFile = new File([file], `pasted_${timestamp}.${ext}`, { type: file.type });
            imageFiles.push(renamedFile);
          }
        }
      }

      if (imageFiles.length > 0) {
        await handlePhotoUpload(imageFiles);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [showDetail, detailIssue, handlePhotoUpload]);

  const handleDeleteAttachment = useCallback(async (attachment: IssueAttachment) => {
    if (!confirm('Kas oled kindel, et soovid faili kustutada?')) return;

    try {
      // Extract storage path from URL
      const url = new URL(attachment.file_url);
      const pathParts = url.pathname.split('/');
      const storagePath = pathParts.slice(pathParts.indexOf('issue-attachments') + 1).join('/');

      // Delete from storage
      if (storagePath) {
        await supabase.storage.from('issue-attachments').remove([storagePath]);
      }

      // Delete record
      const { error } = await supabase
        .from('issue_attachments')
        .delete()
        .eq('id', attachment.id);

      if (error) throw error;

      setMessage('✅ Fail kustutatud');

      // Reload attachments
      if (detailIssue) {
        const { data: attachments } = await supabase
          .from('issue_attachments')
          .select('*')
          .eq('issue_id', detailIssue.id)
          .order('uploaded_at', { ascending: false });
        setIssueAttachments(attachments || []);
      }

    } catch (e: unknown) {
      console.error('Error deleting attachment:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [detailIssue]);

  // ============================================
  // USER ASSIGNMENT
  // ============================================

  const handleAssignUser = useCallback(async (userEmail: string, userName: string) => {
    if (!assigningIssueId) return;

    try {
      // Check if already assigned
      const { data: existing } = await supabase
        .from('issue_assignments')
        .select('id')
        .eq('issue_id', assigningIssueId)
        .eq('user_email', userEmail)
        .eq('is_active', true)
        .single();

      if (existing) {
        setMessage('⚠️ Kasutaja on juba määratud');
        return;
      }

      const { error } = await supabase
        .from('issue_assignments')
        .insert({
          issue_id: assigningIssueId,
          user_email: userEmail,
          user_name: userName,
          role: 'assignee',
          assigned_by: tcUserEmail,
          assigned_by_name: tcUserName
        });

      if (error) throw error;

      setMessage(`✅ ${userName} määratud`);
      setShowAssignDialog(false);
      setAssigningIssueId(null);
      await loadIssues();

    } catch (e: unknown) {
      console.error('Error assigning user:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [assigningIssueId, tcUserEmail, tcUserName, loadIssues]);

  const handleUnassignUser = useCallback(async (assignmentId: string) => {
    try {
      const { error } = await supabase
        .from('issue_assignments')
        .update({
          is_active: false,
          unassigned_at: new Date().toISOString(),
          unassigned_by: tcUserEmail
        })
        .eq('id', assignmentId);

      if (error) throw error;

      setMessage('✅ Kasutaja eemaldatud');
      await loadIssues();

    } catch (e: unknown) {
      console.error('Error unassigning user:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [tcUserEmail, loadIssues]);

  // ============================================
  // FILTERING
  // ============================================

  const filteredIssues = useMemo(() => {
    let result = [...issues];

    // Text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(issue =>
        issue.issue_number.toLowerCase().includes(query) ||
        issue.title.toLowerCase().includes(query) ||
        issue.objects?.some(o => o.assembly_mark?.toLowerCase().includes(query)) ||
        issue.description?.toLowerCase().includes(query) ||
        issue.location?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (filters.status !== 'all') {
      result = result.filter(i => i.status === filters.status);
    }

    // Priority filter
    if (filters.priority !== 'all') {
      result = result.filter(i => i.priority === filters.priority);
    }

    // Category filter
    if (filters.category !== 'all') {
      result = result.filter(i => i.category_id === filters.category);
    }

    // Assigned to filter
    if (filters.assignedTo !== 'all') {
      result = result.filter(i =>
        i.assignments?.some(a => a.user_email === filters.assignedTo && a.is_active)
      );
    }

    // Date range filter
    if (filters.dateRange !== 'all') {
      const now = new Date();
      let startDate: Date;

      switch (filters.dateRange) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
      }

      result = result.filter(i => new Date(i.detected_at) >= startDate);
    }

    // Overdue filter
    if (filters.overdue) {
      result = result.filter(i => isOverdue(i));
    }

    return result;
  }, [issues, searchQuery, filters]);

  // ============================================
  // EXCEL EXPORT
  // ============================================

  const exportToExcel = useCallback(async () => {
    try {
      setMessage('Genereerin Excelit...');

      const rows: (string | number | null)[][] = [];

      // Header row
      rows.push([
        'Number', 'Pealkiri', 'Staatus', 'Prioriteet', 'Kategooria',
        'Detailid', 'Assembly Mark', 'Avastatud', 'Tähtaeg',
        'Vastutaja', 'Teavitaja', 'Kirjeldus', 'Asukoht'
      ]);

      // Sort by status order then by number
      const sortedIssues = [...filteredIssues].sort((a, b) => {
        const statusDiff = ISSUE_STATUS_CONFIG[a.status].order - ISSUE_STATUS_CONFIG[b.status].order;
        if (statusDiff !== 0) return statusDiff;
        return a.issue_number.localeCompare(b.issue_number);
      });

      for (const issue of sortedIssues) {
        const objects = issue.objects || [];
        const assemblyMarks = objects.map(o => o.assembly_mark).filter(Boolean).join(', ');
        const primaryAssignee = issue.assignments?.find(a => a.is_primary && a.is_active);

        rows.push([
          issue.issue_number,
          issue.title,
          ISSUE_STATUS_CONFIG[issue.status].label,
          ISSUE_PRIORITY_CONFIG[issue.priority].label,
          issue.category?.name || '',
          objects.length,
          assemblyMarks,
          formatDate(issue.detected_at),
          issue.due_date ? formatDate(issue.due_date) : '',
          primaryAssignee?.user_name || primaryAssignee?.user_email || '',
          issue.reported_by_name || issue.reported_by,
          issue.description || '',
          issue.location || ''
        ]);
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Style header row
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '2563EB' }, type: 'solid' as const },
        alignment: { horizontal: 'center' as const }
      };

      for (let col = 0; col < rows[0].length; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
        if (ws[cellRef]) {
          ws[cellRef].s = headerStyle;
        }
      }

      // Column widths
      ws['!cols'] = [
        { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 15 },
        { wch: 8 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
        { wch: 20 }, { wch: 20 }, { wch: 40 }, { wch: 20 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Mittevastavused');

      // Generate filename
      const date = new Date().toISOString().split('T')[0];
      const filename = `Mittevastavused_${date}.xlsx`;

      XLSX.writeFile(wb, filename);
      setMessage('✅ Excel alla laetud');

    } catch (e: unknown) {
      console.error('Error exporting to Excel:', e);
      setMessage(`Viga: ${e instanceof Error ? e.message : 'Tundmatu viga'}`);
    }
  }, [filteredIssues]);

  // Map deprecated statuses to new ones
  const mapDeprecatedStatus = (status: string): IssueStatus => {
    switch (status) {
      case 'problem':
      case 'pending':
        return 'nonconformance'; // Old statuses map to first status
      case 'cancelled':
        return 'closed'; // Cancelled maps to closed
      default:
        return status as IssueStatus;
    }
  };

  // Group issues by status (4 statuses only, with deprecated status mapping)
  const issuesByStatus = useMemo(() => {
    const grouped: Record<IssueStatus, Issue[]> = {
      nonconformance: [],
      in_progress: [],
      completed: [],
      closed: []
    };

    for (const issue of filteredIssues) {
      const mappedStatus = mapDeprecatedStatus(issue.status);
      if (grouped[mappedStatus]) {
        grouped[mappedStatus].push(issue);
      }
    }

    return grouped;
  }, [filteredIssues]);

  // Status order for display (4 statuses only)
  const statusOrder: IssueStatus[] = [
    'nonconformance', 'in_progress', 'completed', 'closed'
  ];

  // Clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // ============================================
  // RENDER
  // ============================================

  // Handle navigation from header
  const handleHeaderNavigate = (mode: InspectionMode | null) => {
    if (mode === null) {
      onBackToMenu();
    } else if (onNavigate) {
      onNavigate(mode);
    }
  };

  return (
    <div className="issues-screen">
      {/* PageHeader with hamburger menu */}
      <PageHeader
        title={`Mittevastavused (${filteredIssues.length}/${issues.length})`}
        onBack={onBackToMenu}
        onNavigate={handleHeaderNavigate}
        currentMode="issues"
        user={user}
        onColorModelWhite={onColorModelWhite}
        api={api}
        projectId={projectId}
        onOpenPartDatabase={onOpenPartDatabase}
      >
        <button
          className="icon-button"
          onClick={colorModelByIssueStatus}
          title="Värvi mudel"
        >
          <FiRefreshCw size={18} />
        </button>
        <button
          className="icon-button"
          onClick={exportToExcel}
          title="Ekspordi Excel"
        >
          <FiDownload size={18} />
        </button>
        <button
          className="primary-button"
          onClick={handleCreateIssue}
          title={currentSelectedObjects.length > 0 ? `Lisa mittevastavus (${currentSelectedObjects.length} detaili valitud)` : 'Lisa mittevastavus'}
        >
          <FiPlus size={18} />
          Lisa {currentSelectedObjects.length > 0 && `(${currentSelectedObjects.length})`}
        </button>
      </PageHeader>

      {/* Message */}
      {message && (
        <div className={`issues-message ${message.startsWith('⚠️') || message.startsWith('Viga') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      {/* Coloring status */}
      {coloringStatus && (
        <div className="issues-coloring-status">
          <FiLoader className="spinning" size={14} />
          {coloringStatus}
        </div>
      )}

      {/* Search bar with filter toggle */}
      <div className="issues-search">
        <FiSearch size={16} />
        <input
          type="text"
          placeholder="Otsi numbri, pealkirja, detaili järgi..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} title="Tühjenda otsing">
            <FiX size={14} />
          </button>
        )}
        <button
          onClick={() => setShowFilters(!showFilters)}
          title="Filtrid"
          style={{
            background: showFilters ? '#2563eb' : '#f1f5f9',
            color: showFilters ? 'white' : '#64748b'
          }}
        >
          <FiFilter size={14} />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="issues-filters">
          <select
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value as IssueStatus | 'all' }))}
          >
            <option value="all">Kõik staatused</option>
            {Object.entries(ISSUE_STATUS_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>

          <select
            value={filters.priority}
            onChange={e => setFilters(f => ({ ...f, priority: e.target.value as IssuePriority | 'all' }))}
          >
            <option value="all">Kõik prioriteedid</option>
            {Object.entries(ISSUE_PRIORITY_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>

          <select
            value={filters.assignedTo}
            onChange={e => setFilters(f => ({ ...f, assignedTo: e.target.value }))}
          >
            <option value="all">Kõik vastutajad</option>
            <option value={tcUserEmail}>Mulle määratud</option>
            {teamMembers.map(member => (
              <option key={member.email} value={member.email}>
                {member.fullName}
              </option>
            ))}
          </select>

          <select
            value={filters.dateRange}
            onChange={e => setFilters(f => ({ ...f, dateRange: e.target.value as 'today' | 'week' | 'month' | 'all' }))}
          >
            <option value="all">Kõik kuupäevad</option>
            <option value="today">Täna</option>
            <option value="week">Viimane nädal</option>
            <option value="month">Viimane kuu</option>
          </select>

          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={filters.overdue}
              onChange={e => setFilters(f => ({ ...f, overdue: e.target.checked }))}
            />
            <span>Tähtaeg ületatud</span>
          </label>

          <button
            className="filter-clear-btn"
            onClick={() => {
              setFilters({
                status: 'all', priority: 'all', category: 'all',
                assignedTo: 'all', source: 'all', dateRange: 'all', overdue: false
              });
              setSearchQuery('');
            }}
          >
            <FiX size={14} /> Tühjenda
          </button>
        </div>
      )}

      {/* Issues list grouped by status */}
      <div className="issues-list">
        {loading ? (
          <div className="issues-loading">
            <FiLoader className="spinning" size={24} />
            <span>Laen mittevastavusi...</span>
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="issues-empty">
            <FiAlertCircle size={48} />
            <p>Mittevastavusi ei leitud</p>
            <p className="issues-empty-hint">
              Vali mudelist detail ja klõpsa "Lisa mittevastavus"
            </p>
          </div>
        ) : (
          statusOrder.map(status => {
            const statusIssues = issuesByStatus[status];
            if (statusIssues.length === 0) return null;

            const config = ISSUE_STATUS_CONFIG[status];
            const isExpanded = expandedStatuses.has(status);

            return (
              <div key={status} className="issues-status-group">
                <div className="status-group-header-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    className="status-group-header"
                    onClick={() => {
                      setExpandedStatuses(prev => {
                        const next = new Set(prev);
                        if (next.has(status)) {
                          next.delete(status);
                        } else {
                          next.add(status);
                        }
                        return next;
                      });
                    }}
                    style={{ borderLeftColor: config.color, flex: 1 }}
                  >
                    <div className="status-group-title">
                      {isExpanded ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                      <span
                        className="status-badge"
                        style={{ backgroundColor: config.bgColor, color: config.color }}
                      >
                        {STATUS_ICONS[status]}
                        {config.label}
                      </span>
                      <span className="status-count">{statusIssues.length}</span>
                    </div>
                  </button>

                  {/* Three-dot menu */}
                  <div style={{ position: 'relative' }}>
                    <button
                      className="status-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatusMenuOpen(statusMenuOpen === status ? null : status);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '4px 6px',
                        cursor: 'pointer',
                        color: '#64748b',
                        borderRadius: '4px'
                      }}
                    >
                      <FiMoreVertical size={14} />
                    </button>

                    {statusMenuOpen === status && (
                      <div
                        className="status-menu-dropdown"
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: '100%',
                          background: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          zIndex: 100,
                          minWidth: '160px',
                          overflow: 'hidden'
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => selectStatusInModel(status)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            fontSize: '12px',
                            color: '#374151',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                          onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <FiTarget size={14} />
                          Vali kõik mudelis
                        </button>
                        <button
                          onClick={() => colorStatusInModel(status)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            fontSize: '12px',
                            color: '#374151',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                          onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '3px',
                            background: config.color,
                            display: 'inline-block'
                          }} />
                          Värvi mudelis
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="status-group-items">
                    {statusIssues.map(issue => (
                      <div
                        key={issue.id}
                        id={`issue-card-${issue.id}`}
                        className={`issue-card issue-card-compact ${highlightedIssueId === issue.id ? 'highlighted' : ''} ${isOverdue(issue) ? 'overdue' : ''}`}
                        onClick={() => openIssueDetail(issue)}
                      >
                        <div className="issue-card-row">
                          <span className="issue-card-title-truncated" title={`${issue.issue_number}: ${issue.title}`}>
                            {issue.title.length > 25 ? issue.title.substring(0, 25) + '...' : issue.title}
                          </span>
                          {/* Category badge */}
                          {issue.fixed_category && ISSUE_FIXED_CATEGORY_CONFIG[issue.fixed_category] && (
                            <span
                              className="category-badge-mini"
                              style={{
                                backgroundColor: ISSUE_FIXED_CATEGORY_CONFIG[issue.fixed_category].bgColor,
                                color: ISSUE_FIXED_CATEGORY_CONFIG[issue.fixed_category].color
                              }}
                              title={ISSUE_FIXED_CATEGORY_CONFIG[issue.fixed_category].label}
                            >
                              {ISSUE_FIXED_CATEGORY_CONFIG[issue.fixed_category].label.substring(0, 3).toUpperCase()}
                            </span>
                          )}
                          {/* Icons for comments and photos */}
                          {(issue.comments_count || 0) > 0 && (
                            <span className="issue-meta-icon" title={`${issue.comments_count} kommentaari`}>
                              <FiMessageSquare size={10} />
                            </span>
                          )}
                          {(issue.attachments_count || 0) > 0 && (
                            <span className="issue-meta-icon" title={`${issue.attachments_count} pilti`}>
                              <FiCamera size={10} />
                            </span>
                          )}
                          <span
                            className="priority-badge small"
                            style={{
                              backgroundColor: ISSUE_PRIORITY_CONFIG[issue.priority].bgColor,
                              color: ISSUE_PRIORITY_CONFIG[issue.priority].color
                            }}
                            title={ISSUE_PRIORITY_CONFIG[issue.priority].label}
                          >
                            {PRIORITY_ICONS[issue.priority]}
                          </span>
                          <span className="issue-date-compact">
                            {formatDate(issue.detected_at)}
                          </span>
                          <div className="issue-card-actions-inline">
                            <button
                              className="icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectIssueInModel(issue);
                              }}
                              title="Näita mudelis"
                            >
                              <FiTarget size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Issue Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content issue-form-modal issue-form-modal-compact" onClick={e => e.stopPropagation()}>
            <div className="modal-header compact">
              <h2>{editingIssue ? 'Muuda mittevastavust' : 'Lisa uus mittevastavus'}</h2>
              <button onClick={() => setShowForm(false)}>
                <FiX size={18} />
              </button>
            </div>

            <div className="issue-form issue-form-compact">
              {/* Selected objects - compact inline tags with sub-details button per object */}
              {!editingIssue && (
                <div className="form-section" style={{ marginBottom: '8px' }}>
                  <label style={{ marginBottom: '2px', fontSize: '11px' }}>
                    Detailid ({(showSubDetailsModal ? lockedParentObjects : newIssueObjects).length})
                    {showSubDetailsModal && <span style={{ color: '#059669', marginLeft: '4px' }}>(lukustatud)</span>}
                  </label>
                  {(showSubDetailsModal ? lockedParentObjects : newIssueObjects).length === 0 ? (
                    <div style={{
                      padding: '6px 10px',
                      background: '#fef3c7',
                      borderRadius: '4px',
                      color: '#92400e',
                      fontSize: '11px',
                      textAlign: 'center'
                    }}>
                      Vali mudelist detailid (Assembly Selection peab olema sisse lülitatud)
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {(showSubDetailsModal ? lockedParentObjects : newIssueObjects).map((obj, index) => {
                        const parentGuid = obj.guidIfc || `obj-${index}`;
                        const parentSubDetails = selectedSubDetailsByParent.get(parentGuid);
                        const subDetailCount = parentSubDetails?.size || 0;

                        return (
                          <div
                            key={index}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px 6px',
                              background: currentSubDetailsParentGuid === parentGuid ? '#dbeafe' : '#f1f5f9',
                              border: currentSubDetailsParentGuid === parentGuid ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                              borderRadius: '4px'
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                fontSize: '11px',
                                fontWeight: 500,
                                color: '#1e293b'
                              }}
                              title={obj.guidIfc || undefined}
                            >
                              {obj.assemblyMark || obj.productName || 'Element'}
                            </span>

                            {/* Sub-details count badge */}
                            {subDetailCount > 0 && (
                              <span style={{
                                padding: '1px 5px',
                                background: '#dcfce7',
                                color: '#166534',
                                borderRadius: '10px',
                                fontSize: '9px',
                                fontWeight: 600
                              }}>
                                +{subDetailCount}
                              </span>
                            )}

                            {/* Sub-details button */}
                            <button
                              type="button"
                              disabled={loadingSubDetails}
                              onClick={async (e) => {
                                e.stopPropagation();
                                await loadSubDetails(obj.modelId, obj.runtimeId, parentGuid, obj);
                              }}
                              style={{
                                padding: '2px 6px',
                                background: currentSubDetailsParentGuid === parentGuid ? '#3b82f6' : '#e2e8f0',
                                color: currentSubDetailsParentGuid === parentGuid ? 'white' : '#64748b',
                                border: 'none',
                                borderRadius: '3px',
                                fontSize: '9px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                              title="Vali alamdetailid"
                            >
                              <FiLink size={10} />
                              Alamd.
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="form-row">
                <div className="form-group full">
                  <label>Pealkiri *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                    placeholder="Kirjelda mittevastavust lühidalt"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Staatus</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData(f => ({ ...f, status: e.target.value as IssueStatus }))}
                  >
                    {Object.entries(ISSUE_STATUS_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Prioriteet</label>
                  <select
                    value={formData.priority}
                    onChange={e => setFormData(f => ({ ...f, priority: e.target.value as IssuePriority }))}
                  >
                    {Object.entries(ISSUE_PRIORITY_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Kategooria *</label>
                  <select
                    value={formData.fixed_category}
                    onChange={e => setFormData(f => ({ ...f, fixed_category: e.target.value as IssueFixedCategory | '' }))}
                    style={{ borderColor: !formData.fixed_category ? '#dc2626' : undefined }}
                  >
                    <option value="">-- Vali kategooria --</option>
                    {Object.entries(ISSUE_FIXED_CATEGORY_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Avastamise kuupäev</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={e => setFormData(f => ({ ...f, due_date: e.target.value }))}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group full">
                  <label>Kirjeldus</label>
                  <textarea
                    value={formData.description}
                    onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                    placeholder="Detailne kirjeldus"
                    rows={2}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group full">
                  <label>Asukoht</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={e => setFormData(f => ({ ...f, location: e.target.value }))}
                    placeholder="Nt. vasakpoolne serv"
                  />
                </div>
              </div>

              {/* File upload section */}
              {!editingIssue && (
                <div className="form-section" style={{ marginBottom: '12px' }}>
                  <label style={{ marginBottom: '4px' }}>Fotod/failid</label>
                  <div
                    className={`file-drop-zone ${isDraggingFiles ? 'dragging' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingFiles(true); }}
                    onDragLeave={() => setIsDraggingFiles(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingFiles(false);
                      const files = Array.from(e.dataTransfer.files);
                      setPendingFiles(prev => [...prev, ...files]);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      console.log('File drop zone clicked, triggering file input');
                      formFileInputRef.current?.click();
                    }}
                    style={{
                      border: `2px dashed ${isDraggingFiles ? '#2563eb' : '#d1d5db'}`,
                      borderRadius: '6px',
                      padding: pendingFiles.length > 0 ? '8px' : '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: isDraggingFiles ? '#eff6ff' : '#f9fafb',
                      transition: 'all 0.2s'
                    }}
                  >
                    <input
                      ref={formFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx"
                      style={{ display: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        console.log('Form file input onChange triggered', e.target.files?.length);
                        if (e.target.files && e.target.files.length > 0) {
                          const filesArray = Array.from(e.target.files);
                          console.log('Adding files:', filesArray.map(f => f.name));
                          setPendingFiles(prev => [...prev, ...filesArray]);
                        }
                        e.target.value = '';
                      }}
                    />
                    {pendingFiles.length === 0 ? (
                      <div style={{ color: '#6b7280', fontSize: '12px' }}>
                        <FiCamera size={20} style={{ marginBottom: '4px', opacity: 0.5 }} />
                        <div>Lohista failid siia või kliki</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {pendingFiles.map((file, idx) => (
                          <div
                            key={idx}
                            style={{
                              position: 'relative',
                              width: '48px',
                              height: '48px',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              border: '1px solid #e5e7eb'
                            }}
                          >
                            {file.type.startsWith('image/') ? (
                              <img
                                src={URL.createObjectURL(file)}
                                alt={file.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <div style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: '#f3f4f6',
                                fontSize: '10px',
                                color: '#6b7280'
                              }}>
                                {file.name.split('.').pop()?.toUpperCase()}
                              </div>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingFiles(prev => prev.filter((_, i) => i !== idx));
                              }}
                              style={{
                                position: 'absolute',
                                top: '-4px',
                                right: '-4px',
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                background: '#ef4444',
                                color: 'white',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                padding: 0
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <div
                          style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '4px',
                            border: '1px dashed #d1d5db',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#9ca3af'
                          }}
                        >
                          <FiPlus size={16} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="form-actions">
                <button
                  className="secondary-button"
                  onClick={() => setShowForm(false)}
                >
                  Tühista
                </button>
                <button
                  className="primary-button"
                  onClick={handleSubmitIssue}
                >
                  {editingIssue ? 'Salvesta muudatused' : 'Lisa mittevastavus'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Issue Detail Modal */}
      {showDetail && detailIssue && (
        <div className="modal-overlay" onClick={() => setShowDetail(false)}>
          <div className="modal-content issue-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="detail-header-info">
                <span className="issue-number">{detailIssue.issue_number}</span>
                <span
                  className="status-badge large"
                  style={{
                    backgroundColor: ISSUE_STATUS_CONFIG[detailIssue.status].bgColor,
                    color: ISSUE_STATUS_CONFIG[detailIssue.status].color
                  }}
                >
                  {STATUS_ICONS[detailIssue.status]}
                  {ISSUE_STATUS_CONFIG[detailIssue.status].label}
                </span>
              </div>
              <button onClick={() => setShowDetail(false)}>
                <FiX size={20} />
              </button>
            </div>

            <div className="issue-detail">
              <h3>{detailIssue.title}</h3>

              {/* Quick status change */}
              <div className="status-change-bar">
                {statusOrder.map(s => (
                  <button
                    key={s}
                    className={`status-btn ${detailIssue.status === s ? 'active' : ''}`}
                    style={{
                      backgroundColor: detailIssue.status === s ? ISSUE_STATUS_CONFIG[s].color : undefined,
                      color: detailIssue.status === s ? 'white' : ISSUE_STATUS_CONFIG[s].color,
                      borderColor: ISSUE_STATUS_CONFIG[s].color
                    }}
                    onClick={() => handleStatusChange(detailIssue.id, s)}
                    title={ISSUE_STATUS_CONFIG[s].label}
                  >
                    {STATUS_ICONS[s]}
                  </button>
                ))}
              </div>

              {/* Info grid */}
              <div className="detail-info-grid">
                <div className="info-item">
                  <span className="info-label">Prioriteet</span>
                  <span
                    className="priority-badge"
                    style={{
                      backgroundColor: ISSUE_PRIORITY_CONFIG[detailIssue.priority].bgColor,
                      color: ISSUE_PRIORITY_CONFIG[detailIssue.priority].color
                    }}
                  >
                    {PRIORITY_ICONS[detailIssue.priority]}
                    {ISSUE_PRIORITY_CONFIG[detailIssue.priority].label}
                  </span>
                </div>
                {detailIssue.fixed_category && ISSUE_FIXED_CATEGORY_CONFIG[detailIssue.fixed_category] && (
                  <div className="info-item">
                    <span className="info-label">Kategooria</span>
                    <span
                      className="category-badge"
                      style={{
                        backgroundColor: ISSUE_FIXED_CATEGORY_CONFIG[detailIssue.fixed_category].bgColor,
                        color: ISSUE_FIXED_CATEGORY_CONFIG[detailIssue.fixed_category].color,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px'
                      }}
                    >
                      {ISSUE_FIXED_CATEGORY_CONFIG[detailIssue.fixed_category].label}
                    </span>
                  </div>
                )}
                <div className="info-item">
                  <span className="info-label">Avastatud</span>
                  <span>{formatDateTime(detailIssue.detected_at)}</span>
                </div>
                {detailIssue.due_date && (
                  <div className="info-item">
                    <span className="info-label">Tähtaeg</span>
                    <span className={isOverdue(detailIssue) ? 'overdue' : ''}>
                      {formatDate(detailIssue.due_date)}
                    </span>
                  </div>
                )}
                <div className="info-item">
                  <span className="info-label">Teavitas</span>
                  <span>{detailIssue.reported_by_name || detailIssue.reported_by}</span>
                </div>
              </div>

              {/* Description */}
              {detailIssue.description && (
                <div className="detail-section">
                  <h4>Kirjeldus</h4>
                  <p>{detailIssue.description}</p>
                </div>
              )}

              {/* Location */}
              {detailIssue.location && (
                <div className="detail-section">
                  <h4>Asukoht</h4>
                  <p>{detailIssue.location}</p>
                </div>
              )}

              {/* Objects */}
              <div className="detail-section">
                <h4>
                  <FiLayers size={14} />
                  Seotud detailid ({detailIssue.objects?.length || 0})
                </h4>
                <div className="detail-objects-list">
                  {detailIssue.objects?.map(obj => (
                    <div
                      key={obj.id}
                      className="detail-object"
                      onClick={() => {
                        // Select this object in model
                        syncingToModelRef.current = true;
                        api.viewer.convertToObjectRuntimeIds(obj.model_id, [obj.guid_ifc])
                          .then(runtimeIds => {
                            const validIds = runtimeIds.filter((id): id is number => id !== undefined && id !== null);
                            if (validIds.length > 0) {
                              api.viewer.setSelection({
                                modelObjectIds: [{ modelId: obj.model_id, objectRuntimeIds: validIds }]
                              }, 'set');
                              api.viewer.setCamera({ selected: true }, { animationTime: 500 });
                            }
                          })
                          .finally(() => {
                            setTimeout(() => { syncingToModelRef.current = false; }, 2000);
                          });
                      }}
                    >
                      <span className="obj-mark">{obj.assembly_mark || 'Unknown'}</span>
                      {obj.product_name && <span className="obj-product">{obj.product_name}</span>}
                      {obj.is_primary && <span className="primary-tag">Peamine</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Assignments */}
              <div className="detail-section">
                <h4>
                  <FiUser size={14} />
                  Vastutajad
                  <button
                    className="add-btn"
                    onClick={() => {
                      setAssigningIssueId(detailIssue.id);
                      setShowAssignDialog(true);
                    }}
                  >
                    <FiPlus size={14} />
                  </button>
                </h4>
                <div className="assignments-list">
                  {detailIssue.assignments?.filter(a => a.is_active).map(a => (
                    <div key={a.id} className="assignment-item">
                      <FiUser size={14} />
                      <span>{a.user_name || a.user_email}</span>
                      <button
                        className="remove-btn"
                        onClick={() => handleUnassignUser(a.id)}
                      >
                        <FiX size={12} />
                      </button>
                    </div>
                  ))}
                  {(!detailIssue.assignments || detailIssue.assignments.filter(a => a.is_active).length === 0) && (
                    <span className="no-assignments">Pole määratud</span>
                  )}
                </div>
              </div>

              {/* Photos */}
              <div className="detail-section">
                <h4>
                  <FiCamera size={14} />
                  Pildid ({issueAttachments.filter(a => a.attachment_type === 'photo').length})
                  <button
                    className="add-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPhoto}
                  >
                    {uploadingPhoto ? <FiLoader className="spinning" size={14} /> : <FiPlus size={14} />}
                  </button>
                </h4>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => {
                    if (e.target.files) handlePhotoUpload(e.target.files);
                    e.target.value = '';
                  }}
                />
                <p className="paste-hint">Võid ka kleepida pildi (Ctrl+V)</p>
                <div className="photos-grid">
                  {issueAttachments.filter(a => a.attachment_type === 'photo').map(photo => (
                    <div key={photo.id} className="photo-item">
                      <img src={photo.file_url} alt={photo.file_name} />
                      <div className="photo-actions">
                        <a href={photo.file_url} download={photo.file_name} target="_blank" rel="noopener noreferrer">
                          <FiDownload size={14} />
                        </a>
                        <button onClick={() => handleDeleteAttachment(photo)}>
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick action buttons */}
              <div className="detail-quick-actions">
                <button
                  className="icon-action-btn"
                  onClick={() => {
                    setEditingIssue(detailIssue);
                    setFormData({
                      title: detailIssue.title,
                      description: detailIssue.description || '',
                      location: detailIssue.location || '',
                      status: detailIssue.status,
                      priority: detailIssue.priority,
                      source: detailIssue.source,
                      category_id: detailIssue.category_id || '',
                      fixed_category: detailIssue.fixed_category || '',
                      due_date: detailIssue.due_date || '',
                      estimated_hours: detailIssue.estimated_hours?.toString() || '',
                      estimated_cost: detailIssue.estimated_cost?.toString() || ''
                    });
                    setShowDetail(false);
                    setShowForm(true);
                  }}
                  title="Muuda"
                >
                  <FiEdit2 size={14} />
                </button>
                <button
                  className="icon-action-btn danger"
                  onClick={() => handleDeleteIssue(detailIssue.id)}
                  title="Kustuta"
                >
                  <FiTrash2 size={14} />
                </button>
                <button
                  className="icon-action-btn primary"
                  onClick={() => selectIssueInModel(detailIssue)}
                  title="Näita mudelis"
                >
                  <FiEye size={14} />
                </button>
              </div>

              {/* Comments */}
              <div className="detail-section">
                <h4>
                  <FiMessageSquare size={14} />
                  Kommentaarid ({issueComments.length})
                </h4>
                <div className="comments-list">
                  {issueComments.map(comment => (
                    <div key={comment.id} className="comment-item">
                      <div className="comment-header">
                        <span className="comment-author">
                          {comment.author_name || comment.author_email}
                        </span>
                        <span className="comment-date" title={formatDateTime(comment.created_at)}>
                          {formatDateTime(comment.created_at)} ({formatRelativeTime(comment.created_at)})
                        </span>
                      </div>
                      <p className="comment-text">{comment.comment_text}</p>
                      {comment.old_status && comment.new_status && (
                        <div className="comment-status-change">
                          Staatus: {ISSUE_STATUS_CONFIG[comment.old_status].label} →{' '}
                          {ISSUE_STATUS_CONFIG[comment.new_status].label}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="comment-input">
                  <textarea
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    placeholder="Lisa kommentaar..."
                    rows={2}
                  />
                  <button
                    className="send-btn"
                    onClick={handleAddComment}
                    disabled={!newComment.trim()}
                  >
                    <FiSend size={16} />
                  </button>
                </div>
              </div>

              {/* Activity log */}
              <div className="detail-section">
                <h4>
                  <FiActivity size={14} />
                  Tegevused
                </h4>
                <div className="activity-list">
                  {issueActivities.slice(0, 10).map(activity => (
                    <div key={activity.id} className="activity-item">
                      <span className="activity-text">
                        {activity.action_label}
                        {activity.old_value && activity.new_value && (
                          <span className="activity-change">
                            {' '}{activity.old_value} → {activity.new_value}
                          </span>
                        )}
                      </span>
                      <span className="activity-meta">
                        {activity.actor_name || activity.actor_email} • {formatRelativeTime(activity.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Assign User Dialog */}
      {showAssignDialog && (
        <div className="modal-overlay" onClick={() => setShowAssignDialog(false)}>
          <div className="modal-content assign-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Määra vastutaja</h3>
              <button onClick={() => setShowAssignDialog(false)}>
                <FiX size={20} />
              </button>
            </div>
            <div className="assign-list">
              {teamMembers.map(member => (
                <button
                  key={member.email}
                  className="assign-item"
                  onClick={() => handleAssignUser(member.email, member.fullName)}
                >
                  <FiUser size={16} />
                  <div className="assign-info">
                    <span className="assign-name">{member.fullName}</span>
                    <span className="assign-email">{member.email}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Assembly Selection Modal */}
      {showAssemblyModal && (
        <div className="modal-overlay" onClick={() => setShowAssemblyModal(false)}>
          <div className="modal-content assembly-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Assembly Selection nõutav</h3>
              <button onClick={() => setShowAssemblyModal(false)}>
                <FiX size={20} />
              </button>
            </div>
            <div style={{ padding: '16px' }}>
              <p style={{ marginBottom: '12px', fontSize: '13px', color: '#64748b' }}>
                Mittevastavuse lisamiseks peab Assembly Selection olema sisse lülitatud.
                See tagab, et valitakse terviklik detail (assembly), mitte selle alamosad.
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  className="secondary-button"
                  onClick={() => setShowAssemblyModal(false)}
                >
                  Tühista
                </button>
                <button
                  className="primary-button"
                  onClick={async () => {
                    await enableAssemblySelection();
                    setShowAssemblyModal(false);
                    // Retry creating issue
                    handleCreateIssue();
                  }}
                >
                  Lülita sisse
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-details Modal */}
      {showSubDetailsModal && (
        <div className="modal-overlay" onClick={closeSubDetailsModal}>
          <div className="modal-content sub-details-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '360px' }}>
            <div className="modal-header" style={{ padding: '8px 12px' }}>
              <h3 style={{ fontSize: '13px' }}>Alam-detailid ({subDetails.length})</h3>
              <button onClick={closeSubDetailsModal}>
                <FiX size={16} />
              </button>
            </div>
            <div style={{ padding: '8px', maxHeight: '350px', overflowY: 'auto' }}>
              <p style={{ margin: '0 0 6px', fontSize: '10px', color: '#64748b' }}>
                Vali mudelist või klõpsa listis. "Seo" seob alamdetaili mittevastavusega.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {subDetails.map((detail) => {
                  const isHighlighted = highlightedSubDetailId === detail.id;
                  const currentParentSubDetails = selectedSubDetailsByParent.get(currentSubDetailsParentGuid);
                  const isSelected = currentParentSubDetails?.has(detail.id) || false;
                  return (
                    <div
                      key={detail.id}
                      id={`sub-detail-${detail.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 6px',
                        background: isHighlighted ? '#dbeafe' : isSelected ? '#ecfdf5' : '#f8fafc',
                        border: `1px solid ${isHighlighted ? '#3b82f6' : isSelected ? '#a7f3d0' : '#e2e8f0'}`,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.1s'
                      }}
                      onClick={() => handleSubDetailClick(detail.id)}
                    >
                      {/* Color indicator */}
                      <div
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '2px',
                          background: `rgb(${detail.color.r}, ${detail.color.g}, ${detail.color.b})`,
                          border: '1px solid rgba(0,0,0,0.1)',
                          flexShrink: 0
                        }}
                      />

                      {/* Detail info - single line */}
                      <div style={{ flex: 1, minWidth: 0, fontSize: '11px', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ fontWeight: 500 }}>{detail.type}</span>
                        {detail.profile && <span style={{ color: '#64748b', marginLeft: '4px' }}>{detail.profile}</span>}
                      </div>

                      {/* Link button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSubDetailForIssue(detail.id);
                        }}
                        style={{
                          padding: '2px 6px',
                          fontSize: '9px',
                          fontWeight: 500,
                          background: isSelected ? '#059669' : '#e2e8f0',
                          color: isSelected ? 'white' : '#64748b',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          flexShrink: 0
                        }}
                      >
                        {isSelected ? '✓' : 'Seo'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Action buttons */}
              <div style={{ marginTop: '10px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button
                  className="secondary-button"
                  onClick={closeSubDetailsModal}
                  style={{ padding: '4px 10px', fontSize: '11px' }}
                >
                  Tühista
                </button>
                <button
                  className="primary-button"
                  onClick={closeSubDetailsModal}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px'
                  }}
                >
                  Kinnita ({selectedSubDetailsByParent.get(currentSubDetailsParentGuid)?.size || 0})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
