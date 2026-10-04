/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Plus, Sparkles } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import SoftButton from '@/components/ui/SoftButton';
import Surface from '@/components/ui/Surface';
import PageHeader from '@/components/patterns/PageHeader';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import EmergencyButton from '@/components/ui/EmergencyButton';
import { AtmosphericProvider } from '@/hooks/useAtmosphericTheme';
import { TimeCapsuleCard } from '@/components/time-capsule/TimeCapsuleCard';
import { CreateCapsuleForm } from '@/components/time-capsule/CreateCapsuleForm';
import type { TimeCapsule, CreateCapsuleRequest } from '@/db/features/time-capsule';

const FogBackground = dynamic(() => import('@/components/ui/FogBackground'), { ssr: false });

export default function TimeCapsulePage() {
  const router = useRouter();
  const [capsules, setCapsules] = useState<TimeCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCapsules = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/time-capsules');

      if (response.ok) {
        const data = await response.json();
        setCapsules(data.capsules || []);
      } else {
        setError('Failed to load time capsules');
      }
    } catch (err) {
      setError('Failed to load time capsules');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCapsules();
  }, []);

  const handleCreateCapsule = async (data: CreateCapsuleRequest) => {
    const response = await fetch('/api/time-capsules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      await loadCapsules();
      setShowCreateForm(false);
    } else {
      throw new Error('Failed to create capsule');
    }
  };

  return (
    <AtmosphericProvider>
      <FogBackground />
      <PageShell style={{ backgroundColor: 'transparent' }}>
        <EmergencyButton />
        <div className="relative z-10">
          {/* Title convergence onto `PageHeader` (the serif `text-display` ramp).
              Was bold sans `text-3xl` with BOTH the title and the subtitle
              `truncate`d, so "Lock away memories for the future" was one
              character from being cut on a phone. `subtitleTone="lede"` wraps. */}
          <PageHeader
            title="Time Capsules"
            subtitle="Lock away memories for the future"
            subtitleTone="lede"
            icon={<Sparkles className="h-6 w-6 text-[var(--color-accent-violet)]" />}
            className="pb-4"
          />
          {/* The CTA sits BELOW the header, not in `PageHeader`'s action slot:
              `EmergencyButton` is `fixed top-4 right-4` on every route that
              carries it (these three), so an action in the header's top-right
              sits directly underneath it and the two overlap. */}
          <div className="px-4 pb-1">
            <SoftButton onClick={() => setShowCreateForm(true)}>
              <Plus className="h-4 w-4" />
              Create Capsule
            </SoftButton>
          </div>

          {/* Capsules Grid */}
          {loading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Surface key={i} variant="warm" padding="lg" radius="2xl">
                  <Skeleton className="h-6 w-3/4 mb-4" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-2/3 mb-4" />
                  <Skeleton className="h-10 w-full" />
                </Surface>
              ))}
            </div>
          ) : error ? (
            <ErrorState
              title="Unable to Load Capsules"
              description={error}
              retryLabel="Retry"
              onRetry={loadCapsules}
            />
          ) : capsules.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <EmptyState
                title="No Time Capsules Yet"
                description="Create your first time capsule to lock away memories for the future!"
                icon="🕰️"
                actionLabel="Create Your First Capsule"
                onAction={() => setShowCreateForm(true)}
              />
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              {capsules.map((capsule) => (
                <TimeCapsuleCard
                  key={capsule.id}
                  capsule={capsule}
                  onClick={() => {
                    router.push(`/time-capsule/${capsule.id}`);
                  }}
                />
              ))}
            </motion.div>
          )}

          {/* Create Form Modal */}
          {showCreateForm && (
            <CreateCapsuleForm
              onClose={() => setShowCreateForm(false)}
              onSubmit={handleCreateCapsule}
            />
          )}
        </div>
      </PageShell>
    </AtmosphericProvider>
  );
}
