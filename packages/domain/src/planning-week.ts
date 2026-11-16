import { addDays, type LocalDate } from './local-date.js';

/** 7 consecutive days from `start` (inclusive), not tied to a weekday — R1. */
export interface PlanningWeek {
  readonly start: LocalDate;
}

export const DAYS_IN_PLANNING_WEEK = 7;

export function lastDayOf(week: PlanningWeek): LocalDate {
  return addDays(week.start, DAYS_IN_PLANNING_WEEK - 1);
}

export function daysOf(week: PlanningWeek): LocalDate[] {
  return Array.from({ length: DAYS_IN_PLANNING_WEEK }, (_, i) => addDays(week.start, i));
}

export function contains(week: PlanningWeek, date: LocalDate): boolean {
  return date >= week.start && date <= lastDayOf(week);
}
