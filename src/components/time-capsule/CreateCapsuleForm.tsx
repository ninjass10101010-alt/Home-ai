'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Calendar, Users, Tag, Sparkles, Pencil, AlignLeft, MessageSquare, Check } from 'lucide-react';
import type { CreateCapsuleRequest } from '@/db/features/time-capsule';
import useDialogA11y from "@/components/ui/useDialogA11y";

/** The row IS the control: a native unchecked checkbox paints a solid white
 *  square whatever `accent-color` / `color-scheme` say (verified in Chromium),
 *  so it was a hard white chip in a dark card at a 16px target. */
function CapsuleCheck({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`tap flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors ${
        checked ? 'bg-primary/10' : 'hover:bg-muted/60'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid h-5 w-5 shrink-0 place-items-center rounded border-2 transition-colors ${
          checked
            ? 'border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)] text-white'
            : 'border-[var(--color-border)] bg-[var(--color-surface-1)]'
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3.5} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

interface CreateCapsuleFormProps {
  onClose: () => void;
  onSubmit: (data: CreateCapsuleRequest) => Promise<void>;
  familyMembers?: Array<{ id: string; name: string }>;
}

export function CreateCapsuleForm({
  onClose,
  onSubmit,
  familyMembers = [],
}: CreateCapsuleFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unlockDate, setUnlockDate] = useState('');
  const [unlockMessage, setUnlockMessage] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [isFamilyWide, setIsFamilyWide] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [currentTag, setCurrentTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape is inert while the capsule write is in flight.
  const panelRef = useDialogA11y<HTMLDivElement>({ active: true, onClose, escapeDisabled: loading });

  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    // Validation
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    
    if (!unlockDate) {
      setError('Unlock date is required');
      return;
    }
    
    // Check if unlock date is in the future
    const unlock = new Date(unlockDate);
    if (unlock <= new Date()) {
      setError('Unlock date must be in the future');
      return;
    }
    
    setLoading(true);
    
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        unlockDate,
        unlockMessage: unlockMessage.trim(),
        recipients: isFamilyWide ? [] : recipients,
        isFamilyWide,
        tags,
        color: '#3b82f6', // Default color
      });
      
      onClose();
    } catch (err) {
      setError('Failed to create time capsule');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleAddTag = () => {
    if (currentTag.trim() && !tags.includes(currentTag.trim())) {
      setTags([...tags, currentTag.trim()]);
      setCurrentTag('');
    }
  };
  
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };
  
  // Get minimum date (tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];
  
  // Portaled to <body> at z-[80]: rendered inline this sheet inherited
  // PageShell's `relative z-10` <main> stacking context, so the portaled
  // z-50 CapsuleNav painted straight over the footer and Cancel / Create
  // Capsule were physically untappable. The max-h + sticky header/actions
  // keeps a form taller than the viewport fully reachable.
  return createPortal(
    <motion.div
      ref={panelRef}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-4 backdrop-blur-md outline-none sm:items-center" role="dialog" aria-modal="true" aria-label="Create time capsule"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="material-thick flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 p-5 shadow-2xl sm:p-6"
        style={{ background: "color-mix(in srgb, var(--color-surface-1) 94%, transparent)" }}
      >
        {/* Header */}
        <div className="mb-5 flex shrink-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">Create Time Capsule</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Memories sealed until their date
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">
          {/* Title */}
          <div>
            <label htmlFor="title" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Pencil className="h-4 w-4" />
              Title <span className="text-[var(--color-text-muted)]" aria-hidden="true">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Summer 2024 Memories"
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              maxLength={100}
              required
            />
          </div>
          
          {/* Description */}
          <div>
            <label htmlFor="description" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <AlignLeft className="h-4 w-4" />
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's inside this capsule?"
              className="w-full resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              rows={3}
              maxLength={500}
            />
          </div>
          
          {/* Unlock Date */}
          <div>
            <label htmlFor="unlockDate" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Calendar className="h-4 w-4" />
              Unlock Date <span className="text-[var(--color-text-muted)]" aria-hidden="true">*</span>
            </label>
            <input
              id="unlockDate"
              type="date"
              value={unlockDate}
              onChange={(e) => setUnlockDate(e.target.value)}
              min={minDate}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground [color-scheme:dark] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-calendar-picker-indicator]:opacity-60"
              required
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Choose when this capsule should be unlocked
            </p>
          </div>
          
          {/* Recipients */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="h-4 w-4" />
              Who can view this capsule?
            </label>
            
            <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-2">
              {/* Family-wide option */}
              <CapsuleCheck
                checked={isFamilyWide}
                onChange={(next) => {
                  setIsFamilyWide(next);
                  if (next) {
                    setRecipients([]);
                  }
                }}
                title="Entire family"
                hint="All family members can view and contribute"
              />
              
              {/* Individual recipients */}
              {!isFamilyWide && familyMembers.length > 0 && (
                <div className="space-y-1 border-t border-border pt-2">
                  <div className="px-2 text-xs text-muted-foreground">
                    Or select specific members:
                  </div>
                  {familyMembers.map((member) => (
                    <CapsuleCheck
                      key={member.id}
                      checked={recipients.includes(member.id)}
                      onChange={(next) => {
                        if (next) {
                          setRecipients([...recipients, member.id]);
                        } else {
                          setRecipients(recipients.filter((id) => id !== member.id));
                        }
                      }}
                      title={member.name}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Unlock Message */}
          <div>
            <label htmlFor="unlockMessage" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <MessageSquare className="h-4 w-4" />
              Unlock Message
            </label>
            <textarea
              id="unlockMessage"
              value={unlockMessage}
              onChange={(e) => setUnlockMessage(e.target.value)}
              placeholder="A special message to show when the capsule is unlocked..."
              className="w-full resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              rows={2}
              maxLength={300}
            />
          </div>
          
          {/* Tags */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Tag className="h-4 w-4" />
              Tags
            </label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={currentTag}
                  onChange={(e) => setCurrentTag(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Add a tag..."
                  className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  maxLength={30}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="tap min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Add
                </button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hit-44 -mr-1 grid h-6 w-6 place-items-center rounded-full hover:bg-primary/20"
                        aria-label={`Remove ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Error */}
          {error && (
            <div className="rounded-lg border border-[var(--color-accent-rose)]/20 bg-[var(--color-accent-rose)]/10 p-3 text-sm text-[var(--color-accent-rose)]">
              {error}
            </div>
          )}
          </div>

          {/* Actions — pinned outside the scroll area so the primary action is
              never below the fold on a short phone. */}
          <div className="mt-4 flex shrink-0 gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="tap min-h-11 flex-1 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="tap min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Capsule'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>,
    document.body
  );
}
