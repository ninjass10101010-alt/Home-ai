/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Calendar, TrendingUp, Repeat } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import Skeleton from '@/components/ui/Skeleton';
import EmergencyButton from '@/components/ui/EmergencyButton';
import { AtmosphericProvider } from '@/hooks/useAtmosphericTheme';
import { ScheduleAnalyticsDashboard } from '@/components/analytics/ScheduleAnalyticsDashboard';
import { RecurringPatternsWidget } from '@/components/analytics/RecurringPatternsWidget';

const FogBackground = dynamic(() => import('@/components/ui/FogBackground'), { ssr: false });

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'patterns'>('schedule');
  const [dateRange, setDateRange] = useState<{ startDate: string; endDate: string } | null>(null);

  // Dates are computed after mount — Date.now() during render differs between
  // server and client (timezone/midnight) and would hydration-mismatch.
  useEffect(() => {
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setDateRange({ startDate: start, endDate: end });
  }, []);

  const familyId = 'demo-family'; // Would come from auth

  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: 'transparent' }}>
        <EmergencyButton />
        <div className="relative z-10 px-4 pt-10 pb-6">
          {/* Header */}
          <div className="mb-8 flex items-center gap-4">
            <Surface variant="warm" radius="xl" padding="md" className="flex h-14 w-14 shrink-0 items-center justify-center floating">
              <TrendingUp className="h-7 w-7 text-[var(--color-accent-cyan)]" />
            </Surface>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-text-primary">Family Analytics</h1>
              <p className="text-text-secondary">Insights and patterns to optimize your family schedule</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex flex-wrap gap-2">
            <Button
              variant={activeTab === 'schedule' ? 'primary' : 'secondary'}
              aria-pressed={activeTab === 'schedule'}
              onClick={() => setActiveTab('schedule')}
            >
              Schedule Analytics
            </Button>
            <Button
              variant={activeTab === 'patterns' ? 'primary' : 'secondary'}
              aria-pressed={activeTab === 'patterns'}
              onClick={() => setActiveTab('patterns')}
            >
              <Repeat className="h-4 w-4" />
              Recurring Patterns
            </Button>
          </div>

          {/* Date Range Picker */}
          {activeTab === 'schedule' && (
            <Surface variant="glass-subtle" padding="md" radius="xl" className="mb-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label htmlFor="analytics-start" className="flex shrink-0 items-center gap-2 text-sm font-medium text-text-primary">
                  <Calendar className="h-5 w-5 text-text-secondary" />
                  Date Range:
                </label>
                <input
                  id="analytics-start"
                  type="date"
                  value={dateRange?.startDate ?? ''}
                  onChange={(e) => setDateRange((prev) => ({ startDate: e.target.value, endDate: prev?.endDate ?? '' }))}
                  className="min-w-0 flex-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-text-primary border border-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
                />
                <span className="text-text-secondary">to</span>
                <input
                  id="analytics-end"
                  type="date"
                  aria-label="End date"
                  value={dateRange?.endDate ?? ''}
                  onChange={(e) => setDateRange((prev) => ({ startDate: prev?.startDate ?? '', endDate: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-text-primary border border-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
                />
              </div>
            </Surface>
          )}

          {/* Content */}
          {activeTab === 'schedule' ? (
            dateRange ? (
              <ScheduleAnalyticsDashboard
                familyId={familyId}
                startDate={dateRange.startDate}
                endDate={dateRange.endDate}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <Surface key={i} variant="warm" padding="md" radius="xl">
                    <Skeleton className="h-10 w-10 rounded-lg mb-2" />
                    <Skeleton className="h-4 w-20 mb-1" />
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-3 w-24 mt-1" />
                  </Surface>
                ))}
              </div>
            )
          ) : (
            <RecurringPatternsWidget familyId={familyId} />
          )}
        </div>
      </PageShell>
    </AtmosphericProvider>
  );
}
