import { TrimbleExUser } from '../supabase';

/**
 * User Role Constants
 * Use these constants instead of hardcoded string literals for role comparisons
 */
export const USER_ROLES = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  INSPECTOR: 'inspector',
  VIEWER: 'viewer',
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

/**
 * External role constants (e.g., from Trimble Connect)
 * These are the uppercase role strings used in external systems
 */
export const EXTERNAL_ROLES = {
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
  INSPECTOR: 'INSPECTOR',
  VIEWER: 'VIEWER',
} as const;

/**
 * Role mapping for external systems (e.g., Trimble)
 */
export const EXTERNAL_ROLE_MAPPING: Record<string, UserRole> = {
  [EXTERNAL_ROLES.ADMIN]: USER_ROLES.ADMIN,
  [EXTERNAL_ROLES.MODERATOR]: USER_ROLES.MODERATOR,
  [EXTERNAL_ROLES.INSPECTOR]: USER_ROLES.INSPECTOR,
  [EXTERNAL_ROLES.VIEWER]: USER_ROLES.VIEWER,
};

/**
 * Convert external role string to internal role
 */
export const mapExternalRole = (externalRole: string): UserRole => {
  const upperRole = externalRole.toUpperCase();
  return EXTERNAL_ROLE_MAPPING[upperRole] || USER_ROLES.INSPECTOR;
};

/**
 * Role-based permission checks
 */
export const isAdmin = (user: TrimbleExUser | null | undefined): boolean => {
  return user?.role === USER_ROLES.ADMIN;
};

export const isModerator = (user: TrimbleExUser | null | undefined): boolean => {
  return user?.role === USER_ROLES.MODERATOR;
};

export const isInspector = (user: TrimbleExUser | null | undefined): boolean => {
  return user?.role === USER_ROLES.INSPECTOR;
};

export const isViewer = (user: TrimbleExUser | null | undefined): boolean => {
  return user?.role === USER_ROLES.VIEWER;
};

export const isAdminOrModerator = (user: TrimbleExUser | null | undefined): boolean => {
  return user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.MODERATOR;
};

export const hasAdminPrivileges = (user: TrimbleExUser | null | undefined): boolean => {
  return user?.role === USER_ROLES.ADMIN;
};

export const hasModeratorPrivileges = (user: TrimbleExUser | null | undefined): boolean => {
  return user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.MODERATOR;
};

/**
 * Super Admin Configuration
 * Super admins are defined via environment variable and always have full access
 */
export const SUPER_ADMIN_EMAILS = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map((email: string) => email.trim().toLowerCase())
  .filter((email: string) => email.length > 0);

export const isSuperAdminEmail = (email: string): boolean => {
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
};

/**
 * Super Admin User ID
 * Used when creating a super admin user that doesn't exist in the database
 */
export const SUPER_ADMIN_USER_ID = 'super-admin';

/**
 * Default permissions for new users
 */
export const DEFAULT_USER_PERMISSIONS = {
  can_assembly_inspection: true,
  can_bolt_inspection: false,
  is_active: true,
  can_access_admin: false,
  can_view_delivery: true,
  can_edit_delivery: false,
  can_delete_delivery: false,
  can_view_installation_schedule: true,
  can_edit_installation_schedule: false,
  can_delete_installation_schedule: false,
  can_view_installations: true,
  can_edit_installations: false,
  can_delete_installations: false,
  can_view_organizer: true,
  can_edit_organizer: false,
  can_delete_organizer: false,
  can_view_inspections: true,
  can_edit_inspections: false,
  can_delete_inspections: false,
  can_view_issues: true,
  can_edit_issues: false,
  can_delete_issues: false,
} as const;

/**
 * Full permissions for super admin users
 */
export const SUPER_ADMIN_PERMISSIONS = {
  role: USER_ROLES.ADMIN as UserRole,
  can_assembly_inspection: true,
  can_bolt_inspection: true,
  is_active: true,
  can_access_admin: true,
  can_view_delivery: true,
  can_edit_delivery: true,
  can_delete_delivery: true,
  can_view_installation_schedule: true,
  can_edit_installation_schedule: true,
  can_delete_installation_schedule: true,
  can_view_installations: true,
  can_edit_installations: true,
  can_delete_installations: true,
  can_view_organizer: true,
  can_edit_organizer: true,
  can_delete_organizer: true,
  can_view_inspections: true,
  can_edit_inspections: true,
  can_delete_inspections: true,
  can_view_issues: true,
  can_edit_issues: true,
  can_delete_issues: true,
} as const;

/**
 * Create a super admin user object
 */
export const createSuperAdminUser = (
  email: string,
  projectId: string,
  existingDbUser?: TrimbleExUser | null
): TrimbleExUser => {
  if (existingDbUser) {
    return {
      ...existingDbUser,
      ...SUPER_ADMIN_PERMISSIONS,
    };
  }

  return {
    id: SUPER_ADMIN_USER_ID,
    project_id: '',
    trimble_project_id: projectId,
    email: email,
    name: 'Super Admin',
    created_at: new Date().toISOString(),
    ...SUPER_ADMIN_PERMISSIONS,
  };
};

/**
 * Default role for new users
 */
export const DEFAULT_USER_ROLE: UserRole = USER_ROLES.INSPECTOR;
