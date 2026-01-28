import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUserStore } from '../stores/useUserStore';

// Mock supabase
vi.mock('../../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue({
        data: [{ id: '1', email: 'test@test.com', name: 'Test', role: 'inspector' }],
        error: null,
      }),
    })),
  },
  DEFAULT_PROPERTY_MAPPINGS: {},
}));

vi.mock('../../../constants/roles', () => ({
  mapExternalRole: vi.fn(() => 'inspector'),
  DEFAULT_USER_PERMISSIONS: { can_assembly_inspection: true, can_bolt_inspection: false },
  DEFAULT_USER_ROLE: 'inspector',
}));

describe('useUserStore', () => {
  beforeEach(() => {
    useUserStore.setState({
      projectUsers: [],
      usersLoading: false,
      editingUser: null,
      showUserForm: false,
      message: '',
    });
  });

  it('should have initial state', () => {
    const { result } = renderHook(() => useUserStore());
    expect(result.current.projectUsers).toEqual([]);
    expect(result.current.usersLoading).toBe(false);
    expect(result.current.showUserForm).toBe(false);
  });

  it('should open new user form with defaults', () => {
    const { result } = renderHook(() => useUserStore());
    act(() => {
      result.current.openNewUserForm();
    });
    expect(result.current.showUserForm).toBe(true);
    expect(result.current.editingUser).toBeNull();
    expect(result.current.userFormData.email).toBe('');
  });

  it('should set user form data', () => {
    const { result } = renderHook(() => useUserStore());
    act(() => {
      result.current.setUserFormData({ email: 'new@test.com', name: 'New User' });
    });
    expect(result.current.userFormData.email).toBe('new@test.com');
    expect(result.current.userFormData.name).toBe('New User');
  });

  it('should reset user form', () => {
    const { result } = renderHook(() => useUserStore());
    act(() => {
      result.current.setUserFormData({ email: 'test@test.com' });
      result.current.resetUserForm();
    });
    expect(result.current.userFormData.email).toBe('');
  });

  it('should clear message', () => {
    const { result } = renderHook(() => useUserStore());
    act(() => {
      useUserStore.setState({ message: 'Test message' });
    });
    expect(result.current.message).toBe('Test message');
    act(() => {
      result.current.clearMessage();
    });
    expect(result.current.message).toBe('');
  });

  it('should require email for save', async () => {
    const { result } = renderHook(() => useUserStore());
    act(() => {
      result.current.setUserFormData({ email: '' });
    });
    await act(async () => {
      await result.current.saveUser('project-123');
    });
    expect(result.current.message).toBe('Email is required');
  });
});
