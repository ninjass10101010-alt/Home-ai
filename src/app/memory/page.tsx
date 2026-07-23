'use client';

import { FamilyMemoryBrowser } from '@/components/analytics/FamilyMemoryBrowser';

export default function MemoryPage() {
  const familyId = 'demo-family'; // Would come from auth

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <FamilyMemoryBrowser familyId={familyId} />
      </div>
    </div>
  );
}
