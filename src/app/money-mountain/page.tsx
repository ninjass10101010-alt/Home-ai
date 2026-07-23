'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Plus, Mountain } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import EmergencyButton from '@/components/ui/EmergencyButton';
import Toast from '@/components/ui/Toast';
import { AtmosphericProvider } from '@/hooks/useAtmosphericTheme';
import { MountainVisualization } from '@/components/money-mountain/MountainVisualization';
import { MountainCard } from '@/components/money-mountain/MountainCard';
import { CreateMountainForm } from '@/components/money-mountain/CreateMountainForm';
import { TransactionLogger } from '@/components/money-mountain/TransactionLogger';
import { MilestoneBadge } from '@/components/money-mountain/MilestoneBadge';
import { TransactionHistory } from '@/components/money-mountain/TransactionHistory';
import type { MoneyMountain, MountainTransaction } from '@/db/features/money-mountain';

const FogBackground = dynamic(() => import('@/components/ui/FogBackground'), { ssr: false });

interface MountainData {
  mountain: MoneyMountain;
  milestones: any[];
  transactions: MountainTransaction[];
}

export default function MoneyMountainPage() {
  const [mountains, setMountains] = useState<MoneyMountain[]>([]);
  const [selectedMountain, setSelectedMountain] = useState<MountainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showTransactionLogger, setShowTransactionLogger] = useState<'deposit' | 'withdrawal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string; tone: 'success' | 'neutral' }>({ open: false, message: '', tone: 'neutral' });

  useEffect(() => {
    loadMountains();
  }, []);

  const loadMountains = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/money-mountain', {
        headers: { 'x-user-id': 'demo-user' },
      });

      if (response.ok) {
        const data = await response.json();
        setMountains(data.mountains || []);

        // Auto-select first mountain
        if (data.mountains?.length > 0 && !selectedMountain) {
          selectMountain(data.mountains[0].id);
        }
      } else {
        setError('Failed to load mountains');
      }
    } catch (err) {
      setError('Failed to load mountains');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectMountain = async (id: string) => {
    try {
      const response = await fetch(`/api/money-mountain/${id}`, {
        headers: { 'x-user-id': 'demo-user' },
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedMountain(data);
      }
    } catch (err) {
      console.error('Failed to load mountain:', err);
    }
  };

  const handleCreateMountain = async (data: any) => {
    const response = await fetch('/api/money-mountain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'demo-user',
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      await loadMountains();
      setShowCreateForm(false);
    } else {
      throw new Error('Failed to create mountain');
    }
  };

  const handleTransaction = async (type: 'deposit' | 'withdrawal', data: any) => {
    if (!selectedMountain) return;

    const response = await fetch(`/api/money-mountain/${selectedMountain.mountain.id}/transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'demo-user',
      },
      body: JSON.stringify({ type, ...data }),
    });

    if (response.ok) {
      const result = await response.json();
      await selectMountain(selectedMountain.mountain.id);
      await loadMountains();
      setShowTransactionLogger(null);

      if (result.milestoneReached) {
        setToast({ open: true, message: `🏔️ Milestone reached: ${result.milestoneReached.label}!`, tone: 'success' });
      } else if (result.matchAmount) {
        setToast({ open: true, message: `🎉 Parent match! +$${result.matchAmount.toFixed(2)} added to your mountain!`, tone: 'success' });
      }
    } else {
      throw new Error('Failed to add transaction');
    }
  };

  if (loading) {
    return (
      <AtmosphericProvider>
        <FogBackground />
        <PageShell style={{ backgroundColor: 'transparent' }}>
          <EmergencyButton />
          <div className="relative z-10 px-4 pt-10 pb-6">
            <Surface variant="warm" padding="lg" radius="2xl">
              <div className="flex items-center gap-4 mb-6">
                <Skeleton className="h-14 w-14 rounded-2xl" />
                <div>
                  <Skeleton className="h-8 w-48 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </div>
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-32 mb-3" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </div>
                <div className="lg:col-span-2 space-y-6">
                  <Skeleton className="h-64" />
                  <Skeleton className="h-32" />
                  <Skeleton className="h-48" />
                </div>
              </div>
            </Surface>
          </div>
        </PageShell>
      </AtmosphericProvider>
    );
  }

  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: 'transparent' }}>
        <EmergencyButton />
        <div className="relative z-10 px-4 pt-10 pb-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Surface variant="warm" radius="xl" padding="md" className="flex h-14 w-14 items-center justify-center floating">
                  <Mountain className="h-7 w-7 text-[var(--color-accent-mint)]" />
                </Surface>
                <div>
                  <h1 className="text-3xl font-bold text-text-primary">Money Mountain</h1>
                  <p className="text-text-secondary">Set goals, save money, climb mountains!</p>
                </div>
              </div>

              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4" />
                New Goal
              </Button>
            </div>
          </motion.div>

          {error ? (
            <EmptyState
              title="Unable to Load Mountains"
              description={error}
              icon="🏔️"
              actionLabel="Retry"
              onAction={loadMountains}
            />
          ) : mountains.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <EmptyState
                title="No Savings Goals Yet"
                description="Create your first savings goal and start climbing! Parents can match your deposits to help you reach the summit faster."
                icon="🏔️"
                actionLabel="Create Your First Mountain"
                onAction={() => setShowCreateForm(true)}
              />
            </motion.div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Mountain List */}
              <div className="lg:col-span-1 space-y-3">
                <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                  Your Goals ({mountains.length})
                </h3>
                <div className="space-y-3">
                  {mountains.map((mountain) => (
                    <MountainCard
                      key={mountain.id}
                      mountain={mountain}
                      onClick={() => selectMountain(mountain.id)}
                    />
                  ))}
                </div>
              </div>

              {/* Selected Mountain Detail */}
              <div className="lg:col-span-2 space-y-6">
                {selectedMountain ? (
                  <>
                    {/* Mountain Visualization */}
                    <MountainVisualization
                      mountain={selectedMountain.mountain}
                      onDeposit={() => setShowTransactionLogger('deposit')}
                      onWithdraw={() => setShowTransactionLogger('withdrawal')}
                    />

                    {/* Milestones */}
                    <Surface variant="warm" padding="md" radius="2xl">
                      <h3 className="text-sm font-semibold text-text-primary mb-4">Milestones</h3>
                      <div className="flex items-center justify-around">
                        {selectedMountain.milestones.map((milestone: any) => (
                          <MilestoneBadge
                            key={milestone.id}
                            milestone={milestone}
                            currentPercentage={selectedMountain.mountain.percentageComplete}
                          />
                        ))}
                      </div>
                    </Surface>

                    {/* Transaction History */}
                    <TransactionHistory
                      transactions={selectedMountain.transactions}
                      currency={selectedMountain.mountain.currency}
                    />
                  </>
                ) : (
                  <Surface variant="glass-subtle" padding="xl" radius="2xl" className="flex items-center justify-center">
                    <p className="text-text-secondary">Select a mountain to view details</p>
                  </Surface>
                )}
              </div>
            </div>
          )}

          {/* Create Form Modal */}
          {showCreateForm && (
            <CreateMountainForm
              onClose={() => setShowCreateForm(false)}
              onSubmit={handleCreateMountain}
            />
          )}

          {/* Transaction Logger Modal */}
          {showTransactionLogger && selectedMountain && (
            <TransactionLogger
              type={showTransactionLogger}
              currency={selectedMountain.mountain.currency as any}
              maxAmount={showTransactionLogger === 'withdrawal' ? selectedMountain.mountain.currentAmount : undefined}
              onClose={() => setShowTransactionLogger(null)}
              onSubmit={(data) => handleTransaction(showTransactionLogger, data)}
            />
          )}
        </div>

        {/* Toast Notifications */}
        <Toast open={toast.open} tone={toast.tone}>
          {toast.message}
        </Toast>
      </PageShell>
    </AtmosphericProvider>
  );
}
