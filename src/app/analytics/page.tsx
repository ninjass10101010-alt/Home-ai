'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Calendar, TrendingUp, Repeat } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import EmergencyButton from '@/components/ui/EmergencyButton';
import { AtmosphericProvider } from '@/hooks/useAtmosphericTheme';
import { ScheduleAnalyticsDashboard } from '@/components/analytics/ScheduleAnalyticsDashboard';
import { RecurringPatternsWidget } from '@/components/analytics/RecurringPatternsWidget';

const FogBackground = dynamic(() => import('@/components/ui/FogBackground'), { ssr: false });

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<'schedule' | 'patterns'>('schedule');
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  });

  const familyId = 'demo-family'; // Would come from auth

  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: 'transparent' }}>
        <EmergencyButton />
        <div className="relative z-10 px-4 pt-10 pb-6">
          {/* Header */}
          <div className="mb-8 flex items-center gap-4">
            <Surface variant="warm" radius="xl" padding="md" className="flex h-14 w-14 items-center justify-center floating">
              <TrendingUp className="h-7 w-7 text-[var(--color-accent-cyan)]" />
            </Surface>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">Family Analytics</h1>
              <p className="text-text-secondary">Insights and patterns to optimize your family schedule</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-2">
            <Button
              variant={activeTab === 'schedule' ? 'primary' : 'secondary'}
              onClick={() => setActiveTab('schedule')}
            >
              Schedule Analytics
            </Button>
            <Button
              variant={activeTab === 'patterns' ? 'primary' : 'secondary'}
              onClick={() => setActiveTab('patterns')}
            >
              <Repeat className="h-4 w-4" />
              Recurring Patterns
            </Button>
          </div>

          {/* Date Range Picker */}
          {activeTab === 'schedule' && (
            <Surface variant="glass-subtle" padding="md" radius="xl" className="mb-6">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-text-secondary" />
                  <span className="text-sm font-medium text-text-primary">Date Range:</span>
                </label>
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-[var(--color-surface-2)] text-text-primary border border-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
                />
                <span className="text-text-secondary">to</span>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-[var(--color-surface-2)] text-text-primary border border-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
                />
              </div>
            </Surface>
          )}

          {/* Content */}
          {activeTab === 'schedule' ? (
            <ScheduleAnalyticsDashboard
              familyId={familyId}
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
            />
          ) : (
            <RecurringPatternsWidget familyId={familyId} />
          )}
        </div>
      </PageShell>
    </AtmosphericProvider>
  );
}
