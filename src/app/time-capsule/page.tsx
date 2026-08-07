'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Plus, Sparkles } from 'lucide-react';
import PageShell from '@/components/ui/PageShell';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import EmergencyButton from '@/components/ui/EmergencyButton';
import SectionCard from '@/components/patterns/SectionCard';
import Toast from '@/components/ui/Toast';
import { AtmosphericProvider } from '@/hooks/useAtmosphericTheme';
import { TimeCapsuleCard } from '@/components/time-capsule/TimeCapsuleCard';
import { CreateCapsuleForm } from '@/components/time-capsule/CreateCapsuleForm';
import type { TimeCapsule, CreateCapsuleRequest } from '@/db/features/time-capsule';

const FogBackground = dynamic(() => import('@/components/ui/FogBackground'), { ssr: false });

export default function TimeCapsulePage() {
  const [capsules, setCapsules] = useState<TimeCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCapsules();
  }, []);

  const loadCapsules = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/time-capsules', {
        headers: {
          'x-user-id': 'demo-user',
        },
      });

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

  const handleCreateCapsule = async (data: CreateCapsuleRequest) => {
    const response = await fetch('/api/time-capsules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'demo-user',
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
                  <Sparkles className="h-7 w-7 text-[var(--color-accent-violet)]" />
                </Surface>
                <div>
                  <h1 className="text-3xl font-bold text-text-primary">Time Capsules</h1>
                  <p className="text-text-secondary">Lock away memories for the future</p>
                </div>
              </div>

              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4" />
                Create Capsule
              </Button>
            </div>
          </motion.div>

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
            <EmptyState
              title="Unable to Load Capsules"
              description={error}
              icon="🕰️"
              actionLabel="Retry"
              onAction={loadCapsules}
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
                    window.location.href = `/time-capsule/${capsule.id}`;
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
