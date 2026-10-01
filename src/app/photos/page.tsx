'use client';

import Link from 'next/link';
import { useState } from 'react';
import PageShell from '@/components/ui/PageShell';
import PhotoUploader from '@/components/photos/PhotoUploader';
import WallPhotoGrid from '@/components/photos/WallPhotoGrid';

/**
 * The family photo library.
 *
 * Photos live on phones, so the feature needs a page as much as it needs a
 * widget: the wall itself has no keyboard and no camera roll to pick from.
 * Uploading happens here (the browser resizes before the bytes leave the
 * device), and this is also where a picture gets taken off the wall.
 *
 * Nothing here is parent-only — every family member adds pictures — but every
 * route it calls requires a signed-in session, so a guest device can't push
 * photos or list the library.
 */
export default function PhotosPage() {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <PageShell>
      <div className="px-4 pt-6 pb-6">
        <Link
          href="/"
          className="hit-44 -ml-2 mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[var(--color-accent-selected)] transition-colors hover:bg-[var(--color-accent-selected)]/10"
        >
          <span aria-hidden="true">←</span> Back to Home
        </Link>

        <h1 className="text-2xl font-bold text-text-primary">Photos</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Pictures added here rotate through the wall on a slow, quiet loop.
        </p>

        <div className="mt-5">
          <PhotoUploader onUploaded={() => setRefreshToken((token) => token + 1)} />
        </div>

        <h2 className="mt-8 mb-3 text-lg font-semibold text-text-primary">On the wall</h2>
        <WallPhotoGrid refreshToken={refreshToken} />
      </div>
    </PageShell>
  );
}
