'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, MotionConfig } from 'framer-motion';
import { Plus, Mountain } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import SoftButton from '@/components/ui/SoftButton';
import Surface from '@/components/ui/Surface';
import Chip from '@/components/ui/Chip';
import PageHeader from '@/components/patterns/PageHeader';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import EmergencyButton from '@/components/ui/EmergencyButton';
import Toast from '@/components/ui/Toast';
import { AtmosphericProvider } from '@/hooks/useAtmosphericTheme';
import { useAuth } from '@/hooks/useAuth';
import { MountainVisualization } from '@/components/money-mountain/MountainVisualization';
import { MountainCard } from '@/components/money-mountain/MountainCard';
import { CreateMountainForm } from '@/components/money-mountain/CreateMountainForm';
import { TransactionLogger } from '@/components/money-mountain/TransactionLogger';
import { MilestoneBadge } from '@/components/money-mountain/MilestoneBadge';
import { TransactionHistory } from '@/components/money-mountain/TransactionHistory';
import {
  canManageMountains,
  detailError,
  emptyHistoryHint,
  emptyState,
  headerSubtitle,
  loadError,
  readOnlyReason,
  writeDenialNotice,
  type MountainDetailFailure,
} from '@/components/money-mountain/viewer';
import { formatCurrency } from '@/db/features/money-mountain';
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
  const [listFailed, setListFailed] = useState(false);
  const [detailFailure, setDetailFailure] = useState<{ id: string; failure: MountainDetailFailure } | null>(null);
  /**
   * Set when a write comes back refused for IDENTITY reasons (`adult_only` /
   * `unauthorized`). The page's role claim came from the signed cookie, and the
   * server re-reads the LIVE PocketBase role — so a stale claim is possible and
   * the server is the only authority on it. Once it has answered, the UI stops
   * offering the control instead of inviting the viewer to press it again.
   */
  const [writeReadOnly, setWriteReadOnly] = useState<string | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string; tone: 'success' | 'neutral' }>({ open: false, message: '', tone: 'neutral' });

  const { currentUser, hydrated } = useAuth();
  const role = currentUser?.role ?? null;

  /**
   * The write gate on this page. `hydrated` is in the conjunction on purpose:
   * `role` is `null` until `useAuth` resolves, and `canManageMountains(null)` is
   * false, so nothing parent-shaped can paint during that window — the same
   * reason `CapsuleNav` waits for `hydrated` before drawing a parent's caps.
   */
  const canManage = hydrated && canManageMountains(role) && writeReadOnly === null;
  // `readOnlyReason` is never empty, so this can never hand the visualization a
  // blank note: a silent gap is the one outcome this page is not allowed to
  // produce, not even in the transient pre-hydration window.
  const readOnlyNote = canManage ? undefined : (writeReadOnly ?? readOnlyReason(role));

  useEffect(() => {
    loadMountains();
  }, []);

  // Auto-dismiss celebration toasts so they never linger.
  useEffect(() => {
    if (!toast.open) return;
    const timer = setTimeout(() => setToast((t) => ({ ...t, open: false })), 4000);
    return () => clearTimeout(timer);
  }, [toast.open]);

  const loadMountains = async () => {
    setLoading(true);
    setListFailed(false);
    try {
      const response = await fetch('/api/money-mountain');

      if (response.ok) {
        const data = await response.json();
        setMountains(data.mountains || []);
        setDetailFailure(null);

        // Auto-select first mountain
        if (data.mountains?.length > 0 && !selectedMountain) {
          selectMountain(data.mountains[0].id);
        }
      } else {
        setListFailed(true);
      }
    } catch (err) {
      setListFailed(true);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectMountain = async (id: string) => {
    try {
      const response = await fetch(`/api/money-mountain/${id}`);

      if (response.ok) {
        const data = await response.json();
        setSelectedMountain(data);
        setDetailFailure(null);
        return;
      }
      // A refusal is a real answer and gets named. This used to be swallowed,
      // which left the pane reading "Select a mountain to view details"
      // forever — indistinguishable from a broken page.
      setSelectedMountain(null);
      setDetailFailure({ id, failure: response.status === 403 ? 'forbidden' : 'unavailable' });
    } catch (err) {
      setSelectedMountain(null);
      setDetailFailure({ id, failure: 'unavailable' });
      console.error('Failed to load mountain:', err);
    }
  };

  /**
   * Resolve a refused write to a read-only explanation, or `null` when the
   * refusal is not about who the viewer is (a 400 is the form's own business
   * and must stay the form's error).
   */
  const readRefusal = async (response: Response): Promise<string | null> => {
    if (response.status !== 401 && response.status !== 403) return null;
    let code: string | null = null;
    try {
      const body = await response.json();
      code = typeof body?.error === 'string' ? body.error : null;
    } catch {
      code = null;
    }
    return writeDenialNotice(code);
  };

  const handleCreateMountain = async (data: any) => {
    const response = await fetch('/api/money-mountain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      await loadMountains();
      setShowCreateForm(false);
      return;
    }

    // The gate said no: go read-only and let the form close cleanly, rather
    // than showing "Failed to create mountain" for a permission that will
    // never be granted to this session.
    const notice = await readRefusal(response);
    if (notice) {
      setWriteReadOnly(notice);
      setShowCreateForm(false);
      return;
    }

    throw new Error('Failed to create mountain');
  };

  const handleTransaction = async (type: 'deposit' | 'withdrawal', data: any) => {
    if (!selectedMountain) return;

    const response = await fetch(`/api/money-mountain/${selectedMountain.mountain.id}/transaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
        setToast({ open: true, message: `🎉 Parent match! +${formatCurrency(result.matchAmount)} added to your mountain!`, tone: 'success' });
      }
      return;
    }

    const notice = await readRefusal(response);
    if (notice) {
      setWriteReadOnly(notice);
      setShowTransactionLogger(null);
      return;
    }

    throw new Error('Failed to add transaction');
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

  const listErrorCopy = loadError(role);
  const emptyCopy = emptyState(role);

  return (
    <MotionConfig reducedMotion="user">
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: 'transparent' }}>
        <EmergencyButton />
        <div className="relative z-10">
          {/* Title convergence onto `PageHeader` (the serif `text-display` ramp
              used by meals / tasks / suggestions / settings). This was the third
              system: bold sans `text-2xl sm:text-3xl`, and its `truncate`d
              subtitle cut "Set goals, save money, climb mountai…" mid-word on a
              390px phone. `subtitleTone="lede"` wraps instead. The subtitle
              ITSELF is role-aware: "Set goals…" is a task, and a child sets no
              goal here — they watch one climb. */}
          <PageHeader
            title="Money Mountain"
            subtitle={headerSubtitle(role)}
            subtitleTone="lede"
            icon={<Mountain className="h-6 w-6 text-[var(--color-accent-mint)]" />}
            className="pb-4"
          />
          {/* The CTA sits BELOW the header, not in `PageHeader`'s action slot:
              `EmergencyButton` is `fixed top-4 right-4` on every route that
              carries it (these three), so an action in the header's top-right
              sits directly underneath it and the two overlap.

              A read-only viewer gets a `Chip as="span"` marker instead — a
              passive label with no button semantics and no hit area, so it cannot
              read as something to tap. This is the whole fix in one line: every
              write on this domain is parent-only, so for a child or a pet this
              page is a designed, permanent read-only view — and it now says so
              at the top rather than hiding a control that would 403. */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-1">
            {canManage ? (
              <SoftButton onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4" />
                New Goal
              </SoftButton>
            ) : (
              <Chip as="span" tone="neutral" size="sm">
                🔒 View only
              </Chip>
            )}
          </div>

          {writeReadOnly && (
            <div className="px-4 pb-3">
              <p className="rounded-2xl border border-border bg-[var(--color-surface-0)]/30 px-4 py-3 text-xs leading-5 text-text-secondary backdrop-blur-xl">
                {writeReadOnly}
              </p>
            </div>
          )}

          {listFailed ? (
            <EmptyState
              title={listErrorCopy.title}
              description={listErrorCopy.description}
              icon="🏔️"
              actionLabel="Retry"
              onAction={loadMountains}
            />
          ) : mountains.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {/* `actionLabel` is `null` for a read-only viewer, so `EmptyState`
                  renders NO button at all — the old "Create Your First Mountain"
                  was a 403 with a friendly coat on. */}
              <EmptyState
                title={emptyCopy.title}
                description={emptyCopy.description}
                icon="🏔️"
                {...(emptyCopy.actionLabel
                  ? { actionLabel: emptyCopy.actionLabel, onAction: () => setShowCreateForm(true) }
                  : {})}
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
                {detailFailure ? (
                  <EmptyState
                    {...detailError(role, detailFailure.failure)}
                    icon="🏔️"
                    actionLabel="Try Again"
                    onAction={() => selectMountain(detailFailure.id)}
                  />
                ) : selectedMountain ? (
                  <>
                    {/* Mountain Visualization. The callbacks are only handed
                        over to a viewer who can actually make them, and the
                        component drops any control it has no callback for, so
                        there is no path by which a button appears that would
                        come back 403. */}
                    <MountainVisualization
                      mountain={selectedMountain.mountain}
                      {...(canManage
                        ? {
                            onDeposit: () => setShowTransactionLogger('deposit'),
                            onWithdraw: () => setShowTransactionLogger('withdrawal'),
                          }
                        : { readOnlyNote })}
                    />

                    {/* Milestones */}
                    <Surface variant="warm" padding="md" radius="2xl">
                      <h3 className="text-sm font-semibold text-text-primary mb-4">Milestones</h3>
                      <div className="flex flex-wrap items-center justify-around gap-x-2 gap-y-4">
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
                      emptyHint={emptyHistoryHint(role)}
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

          {/* Create Form Modal — parent-only, and re-checked here rather than
              trusted from the trigger, so no state can open a write surface a
              read-only viewer is not entitled to. */}
          {canManage && showCreateForm && (
            <CreateMountainForm
              onClose={() => setShowCreateForm(false)}
              onSubmit={handleCreateMountain}
            />
          )}

          {/* Transaction Logger Modal — same parent-only re-check. */}
          {canManage && showTransactionLogger && selectedMountain && (
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
    </MotionConfig>
  );
}