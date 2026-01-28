import { useState, useCallback } from 'react';

export function useDeliveryCalendar() {
  const [viewMode, setViewMode] = useState<'dates' | 'factories'>('dates');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [lastSelectedDate, setLastSelectedDate] = useState<string | null>(null);
  const [hidePastDates, setHidePastDates] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  const toggleDateCollapse = useCallback((date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  return {
    viewMode, setViewMode,
    currentMonth, setCurrentMonth,
    selectedDate, setSelectedDate,
    calendarCollapsed, setCalendarCollapsed,
    hoveredDate, setHoveredDate,
    selectedDates, setSelectedDates,
    lastSelectedDate, setLastSelectedDate,
    hidePastDates, setHidePastDates,
    collapsedDates, setCollapsedDates,
    toggleDateCollapse,
  };
}
