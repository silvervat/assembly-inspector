import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeliveryCalendar } from './useDeliveryCalendar';

describe('useDeliveryCalendar', () => {
  it('should initialize with default state', () => {
    const { result } = renderHook(() => useDeliveryCalendar());
    expect(result.current.viewMode).toBe('dates');
    expect(result.current.selectedDate).toBeNull();
    expect(result.current.calendarCollapsed).toBe(false);
    expect(result.current.hidePastDates).toBe(false);
  });

  it('should toggle date collapse', () => {
    const { result } = renderHook(() => useDeliveryCalendar());
    act(() => {
      result.current.toggleDateCollapse('2026-01-28');
    });
    expect(result.current.collapsedDates.has('2026-01-28')).toBe(true);

    act(() => {
      result.current.toggleDateCollapse('2026-01-28');
    });
    expect(result.current.collapsedDates.has('2026-01-28')).toBe(false);
  });

  it('should switch view mode', () => {
    const { result } = renderHook(() => useDeliveryCalendar());
    act(() => {
      result.current.setViewMode('factories');
    });
    expect(result.current.viewMode).toBe('factories');
  });
});
