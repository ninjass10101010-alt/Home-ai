'use client';

import { useState, useEffect } from 'react';
import { Calendar, CheckCircle, AlertTriangle, TrendingUp, Clock } from 'lucide-react';
import Card from '@/components/ui/Card';
import Surface from '@/components/ui/Surface';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import type { ScheduleAnalytics, TaskCompletionStats, TimeSpentAnalytics } from '@/lib/schedule-analytics';

interface ScheduleAnalyticsDashboardProps {
  familyId: string;
  startDate: string;
  endDate: string;
}

export function ScheduleAnalyticsDashboard({ familyId, startDate, endDate }: ScheduleAnalyticsDashboardProps) {
  const [scheduleAnalytics, setScheduleAnalytics] = useState<ScheduleAnalytics | null>(null);
  const [taskStats, setTaskStats] = useState<TaskCompletionStats | null>(null);
  const [timeAnalytics, setTimeAnalytics] = useState<TimeSpentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAnalytics();
  }, [familyId, startDate, endDate]);

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);

    try {
      const [scheduleRes, taskRes, timeRes] = await Promise.all([
        fetch(`/api/schedule-analytics?type=schedule&familyId=${familyId}&startDate=${startDate}&endDate=${endDate}`),
        fetch(`/api/schedule-analytics?type=tasks&familyId=${familyId}&period=month`),
        fetch(`/api/schedule-analytics?type=time&familyId=${familyId}&period=month`),
      ]);

      if (!scheduleRes.ok || !taskRes.ok || !timeRes.ok) {
        throw new Error('Failed to load analytics');
      }

      const scheduleData = await scheduleRes.json();
      const taskData = await taskRes.json();
      const timeData = await timeRes.json();

      setScheduleAnalytics(scheduleData.analytics);
      setTaskStats(taskData.stats);
      setTimeAnalytics(timeData.analytics);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} padding="md">
              <Skeleton className="h-10 w-10 rounded-lg mb-2" />
              <Skeleton className="h-4 w-20 mb-1" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-24 mt-1" />
            </Card>
          ))}
        </div>
        <Card padding="lg">
          <Skeleton className="h-6 w-48 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </Card>
      </div>
    );
  }

  if (error || !scheduleAnalytics || !taskStats || !timeAnalytics) {
    return (
      <EmptyState
        title="Unable to Load Analytics"
        description={error || 'Failed to load analytics data. Please try again.'}
        icon="📊"
        actionLabel="Retry"
        onAction={loadAnalytics}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Calendar className="h-6 w-6" />}
          title="Total Events"
          value={scheduleAnalytics.metrics.totalEvents}
          subtitle={`${Math.round(scheduleAnalytics.metrics.averageEventsPerDay * 10) / 10} per day`}
          color="blue"
        />
        <SummaryCard
          icon={<CheckCircle className="h-6 w-6" />}
          title="Completion Rate"
          value={`${Math.round(scheduleAnalytics.metrics.completionRate)}%`}
          subtitle={`${scheduleAnalytics.metrics.completedEvents} completed`}
          color="green"
        />
        <SummaryCard
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Overbooked Days"
          value={scheduleAnalytics.metrics.overbookedDays}
          subtitle="Days with 5+ events"
          color={scheduleAnalytics.metrics.overbookedDays > 0 ? "red" : "green"}
        />
        <SummaryCard
          icon={<Clock className="h-6 w-6" />}
          title="Scheduled Time"
          value={`${Math.round(scheduleAnalytics.metrics.totalScheduledTime / 60)}h`}
          subtitle={`${scheduleAnalytics.metrics.totalScheduledTime} minutes`}
          color="purple"
        />
      </div>

      {/* Insights */}
      {scheduleAnalytics.insights.length > 0 && (
        <Card padding="lg">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[var(--color-accent-selected)]" />
            Insights & Recommendations
          </h3>
          <div className="space-y-3">
            {scheduleAnalytics.insights.map((insight, i) => (
              <InsightCard key={i} insight={insight} />
            ))}
          </div>
        </Card>
      )}

      {/* Task Completion by Member */}
      {taskStats.memberStats.length > 0 && (
        <Card padding="lg">
          <h3 className="text-lg font-semibold mb-4">Task Completion by Member</h3>
          <div className="space-y-3">
            {taskStats.memberStats.map((member) => (
              <MemberTaskCard key={member.memberId} member={member} />
            ))}
          </div>
        </Card>
      )}

      {/* Time Spent by Category */}
      {Object.keys(timeAnalytics.byCategory).length > 0 && (
        <Card padding="lg">
          <h3 className="text-lg font-semibold mb-4">Time Spent by Category</h3>
          <div className="space-y-2">
            {Object.entries(timeAnalytics.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([category, minutes]) => (
                <CategoryBar
                  key={category}
                  category={category}
                  minutes={minutes}
                  totalMinutes={timeAnalytics.totalMinutes}
                />
              ))}
          </div>
        </Card>
      )}

      {/* Peak Hours */}
      {timeAnalytics.peakHours.length > 0 && (
        <Card padding="lg">
          <h3 className="text-lg font-semibold mb-4">Peak Hours</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {timeAnalytics.peakHours.map((peak) => (
              <Surface
                key={peak.hour}
                variant="flat"
                radius="lg"
                padding="md"
                className="text-center"
              >
                <div className="text-lg font-bold text-text-primary">{formatHour(peak.hour)}</div>
                <div className="text-xs text-text-secondary mt-1">{peak.minutes} min</div>
              </Surface>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ icon, title, value, subtitle, color }: {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  subtitle: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'var(--color-accent-nori)',
    green: 'var(--color-accent-mint)',
    red: 'var(--color-accent-rose)',
    purple: 'var(--color-accent-violet)',
  };
  const accentColor = colorMap[color] || 'var(--color-accent-selected)';

  return (
    <Card padding="md">
      <div
        className="inline-flex items-center justify-center w-10 h-10 rounded-lg mb-2"
        style={{
          backgroundColor: `${accentColor}20`,
          color: accentColor,
        }}
      >
        {icon}
      </div>
      <div className="text-sm text-text-secondary mb-1">{title}</div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      <div className="text-xs text-text-secondary mt-1">{subtitle}</div>
    </Card>
  );
}

function InsightCard({ insight }: { insight: any }) {
  const severityMap: Record<string, { border: string; bg: string }> = {
    low: { border: 'var(--color-accent-cyan)', bg: 'rgba(6, 182, 212, 0.1)' },
    medium: { border: 'var(--color-accent-amber)', bg: 'rgba(245, 158, 11, 0.1)' },
    high: { border: 'var(--color-accent-rose)', bg: 'rgba(244, 63, 94, 0.1)' },
  };
  const severity = severityMap[insight.severity] || severityMap.medium;

  return (
    <div
      className="border-l-4 p-4 rounded-r-lg"
      style={{
        borderLeftColor: severity.border,
        backgroundColor: severity.bg,
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-semibold text-text-primary">{insight.title}</h4>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: severity.bg,
            color: severity.border,
          }}
        >
          {insight.severity}
        </span>
      </div>
      <p className="text-sm text-text-secondary mb-2">{insight.description}</p>
      <p className="text-sm font-medium text-[var(--color-accent-selected)]">💡 {insight.recommendation}</p>
    </div>
  );
}

function MemberTaskCard({ member }: { member: any }) {
  return (
    <Surface variant="flat" radius="lg" padding="sm" className="flex items-center justify-between">
      <div className="flex-1">
        <div className="font-medium text-text-primary">{member.memberName}</div>
        <div className="text-sm text-text-secondary">
          {member.completedTasks}/{member.assignedTasks} tasks
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold text-text-primary">{Math.round(member.completionRate)}%</div>
        {member.overdueTasks > 0 && (
          <div className="text-xs text-[var(--color-accent-rose)]">{member.overdueTasks} overdue</div>
        )}
      </div>
    </Surface>
  );
}

function CategoryBar({ category, minutes, totalMinutes }: {
  category: string;
  minutes: number;
  totalMinutes: number;
}) {
  const percentage = (minutes / totalMinutes) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium capitalize text-text-primary">{category}</span>
        <span className="text-sm text-text-secondary">{formatDuration(minutes)}</span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--color-accent-selected)] rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}${period}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
