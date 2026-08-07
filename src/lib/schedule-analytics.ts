/**
 * Schedule Analytics Dashboard
 * Tracks task completion rates, time spent on activities, overbooking detection,
 * and provides insights for better family planning
 */

import { getPB } from './pb';

export interface ScheduleAnalytics {
  familyId: string;
  dateRange: {
    start: string;
    end: string;
  };
  metrics: ScheduleMetrics;
  insights: ScheduleInsight[];
  trends: ScheduleTrend[];
}

export interface ScheduleMetrics {
  totalEvents: number;
  completedEvents: number;
  cancelledEvents: number;
  completionRate: number; // percentage
  averageEventsPerDay: number;
  busiestDay: string;
  quietestDay: string;
  averageDuration: number; // minutes
  totalScheduledTime: number; // minutes
  overbookedDays: number;
  underbookedDays: number;
  categoryBreakdown: Record<string, number>;
  memberBreakdown: Record<string, number>;
}

export interface ScheduleInsight {
  type: 'overbooking' | 'underbooking' | 'pattern' | 'suggestion';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  affectedDays: string[];
  recommendation: string;
}

export interface ScheduleTrend {
  date: string;
  events: number;
  completionRate: number;
  scheduledMinutes: number;
}

export interface TaskCompletionStats {
  familyId: string;
  period: 'week' | 'month' | 'year';
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionRate: number;
  averageCompletionTime: number; // hours
  memberStats: MemberTaskStats[];
}

export interface MemberTaskStats {
  memberId: string;
  memberName: string;
  assignedTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionRate: number;
  averageCompletionTime: number;
  onTimeRate: number; // percentage
}

export interface TimeSpentAnalytics {
  familyId: string;
  period: 'week' | 'month' | 'year';
  totalMinutes: number;
  byCategory: Record<string, number>;
  byMember: Record<string, number>;
  byDayOfWeek: Record<string, number>;
  peakHours: Array<{ hour: number; minutes: number }>;
}

/**
 * Calculate schedule analytics for a date range
 */
export async function calculateScheduleAnalytics(
  familyId: string,
  startDate: string,
  endDate: string
): Promise<ScheduleAnalytics> {
  try {
    const pb = getPB();
    
    // Fetch events in date range
    const events = await pb.collection('consuela_events').getFullList({
      filter: `familyId = "${familyId}" && date >= "${startDate}" && date <= "${endDate}"`,
      requestKey: null,
    });

    // Calculate metrics
    const metrics = await calculateMetrics(events, startDate, endDate);
    
    // Generate insights
    const insights = generateInsights(events, metrics);
    
    // Calculate trends
    const trends = calculateTrends(events, startDate, endDate);

    return {
      familyId,
      dateRange: { start: startDate, end: endDate },
      metrics,
      insights,
      trends,
    };
  } catch (error) {
    console.error('Failed to calculate schedule analytics:', error);
    throw error;
  }
}

/**
 * Calculate basic metrics from events
 */
async function calculateMetrics(
  events: any[],
  startDate: string,
  endDate: string
): Promise<ScheduleMetrics> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysInRange = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  const completedEvents = events.filter((e: any) => e.status === 'completed').length;
  const cancelledEvents = events.filter((e: any) => e.status === 'cancelled').length;

  // Calculate day of week breakdown
  const dayCounts: Record<string, number> = {
    Sunday: 0, Monday: 0, Tuesday: 0, Wednesday: 0,
    Thursday: 0, Friday: 0, Saturday: 0,
  };

  const categoryCounts: Record<string, number> = {};
  const memberCounts: Record<string, number> = {};

  let totalDuration = 0;

  events.forEach((event: any) => {
    const eventDate = new Date(event.date);
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][eventDate.getDay()];
    dayCounts[dayName]++;

    const category = event.category || 'other';
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    const member = event.member || 'unassigned';
    memberCounts[member] = (memberCounts[member] || 0) + 1;

    if (event.duration) {
      totalDuration += event.duration;
    }
  });

  const busiestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
  const quietestDay = Object.entries(dayCounts).sort((a, b) => a[1] - b[1])[0]?.[0] || 'None';

  // Detect overbooking (more than 5 events in a day)
  const dayEventCounts: Record<string, number> = {};
  events.forEach((event: any) => {
    const date = event.date.split('T')[0];
    dayEventCounts[date] = (dayEventCounts[date] || 0) + 1;
  });

  const overbookedDays = Object.values(dayEventCounts).filter(count => count > 5).length;
  const underbookedDays = Object.values(dayEventCounts).filter(count => count === 0).length;

  return {
    totalEvents: events.length,
    completedEvents,
    cancelledEvents,
    completionRate: events.length > 0 ? (completedEvents / events.length) * 100 : 0,
    averageEventsPerDay: daysInRange > 0 ? events.length / daysInRange : 0,
    busiestDay,
    quietestDay,
    averageDuration: events.length > 0 ? totalDuration / events.length : 0,
    totalScheduledTime: totalDuration,
    overbookedDays,
    underbookedDays,
    categoryBreakdown: categoryCounts,
    memberBreakdown: memberCounts,
  };
}

/**
 * Generate insights from metrics
 */
function generateInsights(events: any[], metrics: ScheduleMetrics): ScheduleInsight[] {
  const insights: ScheduleInsight[] = [];

  // Overbooking insight
  if (metrics.overbookedDays > 0) {
    insights.push({
      type: 'overbooking',
      severity: 'high',
      title: 'Schedule Overbooking Detected',
      description: `You have ${metrics.overbookedDays} day(s) with more than 5 events scheduled. This may lead to stress and missed commitments.`,
      affectedDays: getOverbookedDays(events),
      recommendation: 'Consider rescheduling or delegating some events to balance your schedule.',
    });
  }

  // Underbooking insight
  if (metrics.underbookedDays > 3) {
    insights.push({
      type: 'underbooking',
      severity: 'low',
      title: 'Schedule Underbooking',
      description: `You have ${metrics.underbookedDays} days with no scheduled events. This is good for flexibility, but you might be missing opportunities.`,
      affectedDays: [],
      recommendation: 'Consider planning some activities or keeping these days open for spontaneous plans.',
    });
  }

  // Low completion rate
  if (metrics.completionRate < 70 && metrics.totalEvents > 10) {
    insights.push({
      type: 'pattern',
      severity: 'medium',
      title: 'Low Event Completion Rate',
      description: `Only ${Math.round(metrics.completionRate)}% of scheduled events are completed. This suggests overcommitment.`,
      affectedDays: [],
      recommendation: 'Try scheduling fewer events or adding buffer time between commitments.',
    });
  }

  // Busiest day pattern
  if (metrics.busiestDay && metrics.averageEventsPerDay > 0) {
    const busiestCount = events.filter((e: any) => {
      const day = new Date(e.date).toLocaleDateString('en-US', { weekday: 'long' });
      return day === metrics.busiestDay;
    }).length;

    if (busiestCount > metrics.averageEventsPerDay * 2) {
      insights.push({
        type: 'pattern',
        severity: 'medium',
        title: `${metrics.busiestDay} is Your Busiest Day`,
        description: `${metrics.busiestDay} has significantly more events than other days. This pattern may cause burnout.`,
        affectedDays: [metrics.busiestDay],
        recommendation: `Consider redistributing some ${metrics.busiestDay} events to other days.`,
      });
    }
  }

  return insights;
}

/**
 * Get list of overbooked days
 */
function getOverbookedDays(events: any[]): string[] {
  const dayCounts: Record<string, number> = {};
  
  events.forEach((event: any) => {
    const date = event.date.split('T')[0];
    dayCounts[date] = (dayCounts[date] || 0) + 1;
  });

  return Object.entries(dayCounts)
    .filter(([_, count]) => count > 5)
    .map(([date, _]) => date);
}

/**
 * Calculate trends over time
 */
function calculateTrends(events: any[], startDate: string, endDate: string): ScheduleTrend[] {
  const trends: ScheduleTrend[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Group events by day
  const eventsByDay: Record<string, any[]> = {};
  events.forEach((event: any) => {
    const date = event.date.split('T')[0];
    if (!eventsByDay[date]) eventsByDay[date] = [];
    eventsByDay[date].push(event);
  });

  // Calculate daily metrics
  const currentDate = new Date(start);
  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayEvents = eventsByDay[dateStr] || [];
    const completed = dayEvents.filter((e: any) => e.status === 'completed').length;
    const totalMinutes = dayEvents.reduce((sum: number, e: any) => sum + (e.duration || 0), 0);

    trends.push({
      date: dateStr,
      events: dayEvents.length,
      completionRate: dayEvents.length > 0 ? (completed / dayEvents.length) * 100 : 0,
      scheduledMinutes: totalMinutes,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return trends;
}

/**
 * Get task completion statistics
 */
export async function getTaskCompletionStats(
  familyId: string,
  period: 'week' | 'month' | 'year' = 'month'
): Promise<TaskCompletionStats> {
  try {
    const pb = getPB();
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    if (period === 'week') startDate.setDate(startDate.getDate() - 7);
    else if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
    else startDate.setFullYear(startDate.getFullYear() - 1);

    // Fetch tasks
    const tasks = await pb.collection('consuela_tasks').getFullList({
      filter: `familyId = "${familyId}" && createdAt >= "${startDate.toISOString()}"`,
      requestKey: null,
    });

    const completedTasks = tasks.filter((t: any) => t.status === 'completed').length;
    const overdueTasks = tasks.filter((t: any) => {
      if (t.status === 'completed') return false;
      const dueDate = new Date(t.dueDate);
      return dueDate < new Date();
    }).length;

    // Calculate member stats
    const memberMap: Record<string, any[]> = {};
    tasks.forEach((task: any) => {
      const member = task.assignedTo || 'unassigned';
      if (!memberMap[member]) memberMap[member] = [];
      memberMap[member].push(task);
    });

    const memberStats: MemberTaskStats[] = Object.entries(memberMap).map(([memberId, memberTasks]) => {
      const completed = memberTasks.filter((t: any) => t.status === 'completed').length;
      const overdue = memberTasks.filter((t: any) => {
        if (t.status === 'completed') return false;
        const dueDate = new Date(t.dueDate);
        return dueDate < new Date();
      }).length;

      return {
        memberId,
        memberName: memberId, // Would fetch actual name
        assignedTasks: memberTasks.length,
        completedTasks: completed,
        overdueTasks: overdue,
        completionRate: memberTasks.length > 0 ? (completed / memberTasks.length) * 100 : 0,
        averageCompletionTime: 0, // Would calculate from completed timestamps
        onTimeRate: 0, // Would calculate from on-time completions
      };
    });

    return {
      familyId,
      period,
      totalTasks: tasks.length,
      completedTasks,
      overdueTasks,
      completionRate: tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0,
      averageCompletionTime: 0,
      memberStats,
    };
  } catch (error) {
    console.error('Failed to get task completion stats:', error);
    throw error;
  }
}

/**
 * Get time spent analytics
 */
export async function getTimeSpentAnalytics(
  familyId: string,
  period: 'week' | 'month' | 'year' = 'month'
): Promise<TimeSpentAnalytics> {
  try {
    const pb = getPB();
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    if (period === 'week') startDate.setDate(startDate.getDate() - 7);
    else if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
    else startDate.setFullYear(startDate.getFullYear() - 1);

    // Fetch events with duration
    const events = await pb.collection('consuela_events').getFullList({
      filter: `familyId = "${familyId}" && date >= "${startDate.toISOString()}" && duration > 0`,
      requestKey: null,
    });

    const totalMinutes = events.reduce((sum: number, e: any) => sum + (e.duration || 0), 0);

    // Breakdown by category
    const byCategory: Record<string, number> = {};
    const byMember: Record<string, number> = {};
    const byDayOfWeek: Record<string, number> = {
      Sunday: 0, Monday: 0, Tuesday: 0, Wednesday: 0,
      Thursday: 0, Friday: 0, Saturday: 0,
    };

    events.forEach((event: any) => {
      const category = event.category || 'other';
      byCategory[category] = (byCategory[category] || 0) + event.duration;

      const member = event.member || 'unassigned';
      byMember[member] = (byMember[member] || 0) + event.duration;

      const eventDate = new Date(event.date);
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][eventDate.getDay()];
      byDayOfWeek[dayName] = (byDayOfWeek[dayName] || 0) + event.duration;
    });

    // Peak hours
    const hourCounts: Record<number, number> = {};
    events.forEach((event: any) => {
      const eventDate = new Date(event.date);
      const hour = eventDate.getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + event.duration;
    });

    const peakHours = Object.entries(hourCounts)
      .map(([hour, minutes]) => ({ hour: parseInt(hour), minutes }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5);

    return {
      familyId,
      period,
      totalMinutes,
      byCategory,
      byMember,
      byDayOfWeek,
      peakHours,
    };
  } catch (error) {
    console.error('Failed to get time spent analytics:', error);
    throw error;
  }
}
