import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  getHours,
  parseISO,
  set,
  isBefore,
} from "date-fns";
import { fr } from "date-fns/locale";
import type { CalendarDay, ScheduledPost, TimeSlot } from "@/types";

/** Generate the grid of days for a given month (Monday-start weeks). */
export function getCalendarDays(
  month: Date,
  selectedDate: Date,
  postsMap: Map<string, ScheduledPost[]>,
): CalendarDay[] {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  return eachDayOfInterval({ start: calendarStart, end: calendarEnd }).map(
    (date) => {
      const dateKey = format(date, "yyyy-MM-dd");
      return {
        date,
        isCurrentMonth: isSameMonth(date, month),
        isToday: isToday(date),
        isSelected: isSameDay(date, selectedDate),
        hasEvents: postsMap.has(dateKey),
      };
    },
  );
}

/** Group posts by date key (yyyy-MM-dd). */
export function groupPostsByDate(
  posts: ScheduledPost[],
): Map<string, ScheduledPost[]> {
  const map = new Map<string, ScheduledPost[]>();
  for (const post of posts) {
    const key = format(parseISO(post.scheduledAt), "yyyy-MM-dd");
    const existing = map.get(key) || [];
    existing.push(post);
    map.set(key, existing);
  }
  return map;
}

/** Get posts for a specific date, sorted by time. */
export function getPostsForDate(
  posts: ScheduledPost[],
  date: Date,
): ScheduledPost[] {
  return posts
    .filter((p) => isSameDay(parseISO(p.scheduledAt), date))
    .sort(
      (a, b) =>
        parseISO(a.scheduledAt).getTime() - parseISO(b.scheduledAt).getTime(),
    );
}

/** Generate time slots from startHour to endHour. */
export function generateTimeSlots(
  startHour: number = 0,
  endHour: number = 23,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let h = startHour; h <= endHour; h++) {
    slots.push({
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
    });
  }
  return slots;
}

/** Get the hour (0-23) from a post's scheduledAt. */
export function getPostHour(post: ScheduledPost): number {
  return getHours(parseISO(post.scheduledAt));
}

/** Format date for display: "mer. 24 févr." */
export function formatSelectedDate(date: Date): string {
  return format(date, "EEE d MMM", { locale: fr });
}

/** Format date for detail display: "26 février 2026 09:00" */
export function formatPostDateTime(isoString: string): string {
  return format(parseISO(isoString), "d MMMM yyyy HH:mm", { locale: fr });
}

/** Format month name: "Février" */
export function formatMonthName(date: Date): string {
  const name = format(date, "MMMM", { locale: fr });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Check if a date is in the past. */
export function isDatePassed(date: Date): boolean {
  return isBefore(date, new Date());
}

export { addMonths, subMonths, isSameDay, parseISO, format, set };
