import { create } from 'zustand';
import { supabase, TrimbleExUser } from '../../../supabase';
import { mapExternalRole, DEFAULT_USER_PERMISSIONS, DEFAULT_USER_ROLE } from '../../../constants/roles';
import type { TeamMember } from '../types';

interface UserFormData {
  email: string;
  name: string;
  role: 'admin' | 'moderator' | 'inspector' | 'viewer';
  can_assembly_inspection: boolean;
  can_bolt_inspection: boolean;
  is_active: boolean;
  can_view_delivery: boolean;
  can_edit_delivery: boolean;
  can_delete_delivery: boolean;
  can_view_installation_schedule: boolean;
  can_edit_installation_schedule: boolean;
  can_delete_installation_schedule: boolean;
  can_view_installations: boolean;
  can_edit_installations: boolean;
  can_delete_installations: boolean;
  can_view_organizer: boolean;
  can_edit_organizer: boolean;
  can_delete_organizer: boolean;
  can_view_inspections: boolean;
  can_edit_inspections: boolean;
  can_delete_inspections: boolean;
  can_access_admin: boolean;
  can_access_gps_search: boolean;
}

const DEFAULT_FORM_DATA: UserFormData = {
  email: '',
  name: '',
  role: DEFAULT_USER_ROLE as UserFormData['role'],
  can_assembly_inspection: true,
  can_bolt_inspection: false,
  is_active: true,
  can_view_delivery: true,
  can_edit_delivery: true,
  can_delete_delivery: false,
  can_view_installation_schedule: true,
  can_edit_installation_schedule: true,
  can_delete_installation_schedule: false,
  can_view_installations: true,
  can_edit_installations: true,
  can_delete_installations: false,
  can_view_organizer: true,
  can_edit_organizer: true,
  can_delete_organizer: false,
  can_view_inspections: true,
  can_edit_inspections: true,
  can_delete_inspections: false,
  can_access_admin: false,
  can_access_gps_search: false,
};

interface UserState {
  projectUsers: TrimbleExUser[];
  usersLoading: boolean;
  editingUser: TrimbleExUser | null;
  showUserForm: boolean;
  userFormData: UserFormData;
  message: string;

  loadProjectUsers: (projectId: string) => Promise<void>;
  saveUser: (projectId: string) => Promise<void>;
  deleteUser: (userId: string, projectId: string) => Promise<void>;
  syncTeamMembers: (api: any, projectId: string) => Promise<void>;
  openEditUserForm: (user: TrimbleExUser) => void;
  openNewUserForm: () => void;
  resetUserForm: () => void;
  setUserFormData: (data: Partial<UserFormData>) => void;
  setShowUserForm: (show: boolean) => void;
  clearMessage: () => void;
}

export const useUserStore = create<UserState>((set, get) => ({
  projectUsers: [],
  usersLoading: false,
  editingUser: null,
  showUserForm: false,
  userFormData: { ...DEFAULT_FORM_DATA },
  message: '',

  loadProjectUsers: async (projectId: string) => {
    if (!projectId) return;
    set({ usersLoading: true });
    try {
      const { data, error } = await supabase
        .from('trimble_inspection_users')
        .select('*')
        .eq('trimble_project_id', projectId)
        .order('name', { ascending: true });

      if (error) throw error;
      set({ projectUsers: data || [] });
    } catch (e: any) {
      console.error('Error loading users:', e);
      set({ message: `Error loading users: ${e.message}` });
    } finally {
      set({ usersLoading: false });
    }
  },

  saveUser: async (projectId: string) => {
    const { userFormData, editingUser } = get();
    if (!userFormData.email.trim()) {
      set({ message: 'Email is required' });
      return;
    }

    const { email, ...permissionFields } = userFormData;
    const permData = {
      name: permissionFields.name.trim() || null,
      role: permissionFields.role,
      can_assembly_inspection: permissionFields.can_assembly_inspection,
      can_bolt_inspection: permissionFields.can_bolt_inspection,
      is_active: permissionFields.is_active,
      can_view_delivery: permissionFields.can_view_delivery,
      can_edit_delivery: permissionFields.can_edit_delivery,
      can_delete_delivery: permissionFields.can_delete_delivery,
      can_view_installation_schedule: permissionFields.can_view_installation_schedule,
      can_edit_installation_schedule: permissionFields.can_edit_installation_schedule,
      can_delete_installation_schedule: permissionFields.can_delete_installation_schedule,
      can_view_installations: permissionFields.can_view_installations,
      can_edit_installations: permissionFields.can_edit_installations,
      can_delete_installations: permissionFields.can_delete_installations,
      can_view_organizer: permissionFields.can_view_organizer,
      can_edit_organizer: permissionFields.can_edit_organizer,
      can_delete_organizer: permissionFields.can_delete_organizer,
      can_view_inspections: permissionFields.can_view_inspections,
      can_edit_inspections: permissionFields.can_edit_inspections,
      can_delete_inspections: permissionFields.can_delete_inspections,
      can_access_admin: permissionFields.can_access_admin,
      can_access_gps_search: permissionFields.can_access_gps_search,
    };

    set({ usersLoading: true });
    try {
      if (editingUser) {
        const { error } = await supabase
          .from('trimble_inspection_users')
          .update({ ...permData, updated_at: new Date().toISOString() })
          .eq('id', editingUser.id);
        if (error) throw error;
        set({ message: 'User updated' });
      } else {
        const { error } = await supabase
          .from('trimble_inspection_users')
          .insert({
            trimble_project_id: projectId,
            email: email.trim().toLowerCase(),
            ...permData,
          });
        if (error) throw error;
        set({ message: 'User added' });
      }

      set({ showUserForm: false, editingUser: null, userFormData: { ...DEFAULT_FORM_DATA } });
      await get().loadProjectUsers(projectId);
    } catch (e: any) {
      console.error('Error saving user:', e);
      set({ message: `Error saving user: ${e.message}` });
    } finally {
      set({ usersLoading: false });
    }
  },

  deleteUser: async (userId: string, projectId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    set({ usersLoading: true });
    try {
      const { error } = await supabase
        .from('trimble_inspection_users')
        .delete()
        .eq('id', userId);
      if (error) throw error;
      set({ message: 'User deleted' });
      await get().loadProjectUsers(projectId);
    } catch (e: any) {
      console.error('Error deleting user:', e);
      set({ message: `Error deleting user: ${e.message}` });
    } finally {
      set({ usersLoading: false });
    }
  },

  syncTeamMembers: async (api: any, projectId: string) => {
    if (!api || !projectId) return;

    set({ usersLoading: true });
    try {
      const members = await (api.project as any).getMembers?.();
      if (!members || !Array.isArray(members)) {
        set({ message: 'Failed to load team members' });
        return;
      }

      const { data: existingUsers } = await supabase
        .from('trimble_inspection_users')
        .select('email')
        .eq('trimble_project_id', projectId);

      const existingEmails = new Set((existingUsers || []).map((u: any) => u.email.toLowerCase()));

      const newMembers = members.filter((m: any) =>
        m.email && !existingEmails.has(m.email.toLowerCase())
      );

      if (newMembers.length === 0) {
        set({ message: 'All team members are already in the database' });
        await get().loadProjectUsers(projectId);
        return;
      }

      const newUsers = newMembers.map((m: any) => ({
        trimble_project_id: projectId,
        email: m.email.toLowerCase(),
        name: m.name || `${m.firstName || ''} ${m.lastName || ''}`.trim() || null,
        role: mapExternalRole(m.role || ''),
        can_assembly_inspection: DEFAULT_USER_PERMISSIONS.can_assembly_inspection,
        can_bolt_inspection: DEFAULT_USER_PERMISSIONS.can_bolt_inspection,
        is_active: m.status === 'ACTIVE',
      }));

      const { error } = await supabase
        .from('trimble_inspection_users')
        .insert(newUsers);
      if (error) throw error;

      set({ message: `${newMembers.length} team members added` });
      await get().loadProjectUsers(projectId);
    } catch (e: any) {
      console.error('Error syncing team members:', e);
      set({ message: `Error syncing: ${e.message}` });
    } finally {
      set({ usersLoading: false });
    }
  },

  openEditUserForm: (user: TrimbleExUser) => {
    set({
      editingUser: user,
      userFormData: {
        email: user.email,
        name: user.name || '',
        role: user.role as UserFormData['role'],
        can_assembly_inspection: user.can_assembly_inspection ?? true,
        can_bolt_inspection: user.can_bolt_inspection ?? false,
        is_active: user.is_active ?? true,
        can_view_delivery: user.can_view_delivery ?? true,
        can_edit_delivery: user.can_edit_delivery ?? true,
        can_delete_delivery: user.can_delete_delivery ?? false,
        can_view_installation_schedule: user.can_view_installation_schedule ?? true,
        can_edit_installation_schedule: user.can_edit_installation_schedule ?? true,
        can_delete_installation_schedule: user.can_delete_installation_schedule ?? false,
        can_view_installations: user.can_view_installations ?? true,
        can_edit_installations: user.can_edit_installations ?? true,
        can_delete_installations: user.can_delete_installations ?? false,
        can_view_organizer: user.can_view_organizer ?? true,
        can_edit_organizer: user.can_edit_organizer ?? true,
        can_delete_organizer: user.can_delete_organizer ?? false,
        can_view_inspections: user.can_view_inspections ?? true,
        can_edit_inspections: user.can_edit_inspections ?? true,
        can_delete_inspections: user.can_delete_inspections ?? false,
        can_access_admin: user.can_access_admin ?? false,
        can_access_gps_search: user.can_access_gps_search ?? false,
      },
      showUserForm: true,
    });
  },

  openNewUserForm: () => {
    set({
      editingUser: null,
      userFormData: { ...DEFAULT_FORM_DATA },
      showUserForm: true,
    });
  },

  resetUserForm: () => {
    set({ userFormData: { ...DEFAULT_FORM_DATA } });
  },

  setUserFormData: (data: Partial<UserFormData>) => {
    set((state) => ({
      userFormData: { ...state.userFormData, ...data },
    }));
  },

  setShowUserForm: (show: boolean) => {
    set({ showUserForm: show });
  },

  clearMessage: () => {
    set({ message: '' });
  },
}));
