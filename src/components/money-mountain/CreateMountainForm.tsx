'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Target } from 'lucide-react';
import type { Currency } from '@/db/features/money-mountain';
import { MOUNTAIN_THEMES } from '@/db/features/money-mountain';

interface CreateMountainFormProps {
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    description?: string;
    targetAmount: number;
    currency: Currency;
    icon: string;
    color: string;
    mountainTheme: 'snow' | 'desert' | 'forest' | 'volcano' | 'cloud';
    deadline?: string;
    matchEnabled: boolean;
    matchPercentage: number;
  }) => Promise<void>;
}

const MOUNTAIN_ICONS = ['🚲', '🎮', '📱', '🎸', '👟', '📚', '🎒', '🏕️', '✈️', '🎨', '⚽', '🎹'];
const THEMES: Array<{ id: 'snow' | 'desert' | 'forest' | 'volcano' | 'cloud'; label: string; emoji: string }> = [
  { id: 'snow', label: 'Snow', emoji: '❄️' },
  { id: 'desert', label: 'Desert', emoji: '🏜️' },
  { id: 'forest', label: 'Forest', emoji: '🌲' },
  { id: 'volcano', label: 'Volcano', emoji: '🌋' },
  { id: 'cloud', label: 'Cloud', emoji: '☁️' },
];

export function CreateMountainForm({ onClose, onSubmit }: CreateMountainFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [icon, setIcon] = useState('🚲');
  const [mountainTheme, setMountainTheme] = useState<'snow' | 'desert' | 'forest' | 'volcano' | 'cloud'>('snow');
  const [deadline, setDeadline] = useState('');
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [matchPercentage, setMatchPercentage] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    
    const amount = parseFloat(targetAmount);
    if (!amount || amount <= 0) {
      setError('Target amount must be greater than 0');
      return;
    }
    
    setLoading(true);
    
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        targetAmount: amount,
        currency,
        icon,
        color: MOUNTAIN_THEMES[mountainTheme].accent,
        mountainTheme,
        deadline: deadline || undefined,
        matchEnabled,
        matchPercentage,
      });
      onClose();
    } catch (err) {
      setError('Failed to create mountain');
    } finally {
      setLoading(false);
    }
  };
  
  const themeColors = {
    snow: '#93c5fd',
    desert: '#fbbf24',
    forest: '#4ade80',
    volcano: '#f87171',
    cloud: '#a78bfa',
  };
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">New Savings Goal</h2>
              <p className="text-sm text-muted-foreground">Set a goal and start climbing!</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Goal Name */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Goal Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., New Bike, Video Game, Trip"
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              maxLength={50}
              required
            />
          </div>
          
          {/* Description */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you saving for?"
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              maxLength={200}
            />
          </div>
          
          {/* Target Amount */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Target Amount <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-foreground focus:border-primary focus:outline-none"
              >
                <option value="USD">$ USD</option>
                <option value="EUR">€ EUR</option>
                <option value="GBP">£ GBP</option>
                <option value="CAD">$ CAD</option>
                <option value="AUD">$ AUD</option>
              </select>
              <input
                type="number"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="200.00"
                step="0.01"
                min="0.01"
                className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>
          </div>
          
          {/* Icon */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Goal Icon
            </label>
            <div className="flex flex-wrap gap-2">
              {MOUNTAIN_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setIcon(emoji)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl transition-all ${
                    icon === emoji
                      ? 'bg-primary/20 ring-2 ring-primary'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          
          {/* Mountain Theme */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Mountain Theme
            </label>
            <div className="grid grid-cols-5 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMountainTheme(t.id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-all ${
                    mountainTheme === t.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <span className="text-xl">{t.emoji}</span>
                  <span className="text-[10px] font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Deadline */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Deadline (optional)
            </label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground focus:border-primary focus:outline-none"
            />
          </div>
          
          {/* Parent Matching */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={matchEnabled}
                onChange={(e) => setMatchEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <div>
                <div className="text-sm font-medium text-foreground">Parent Match Program</div>
                <div className="text-xs text-muted-foreground">
                  Parents match a percentage of each deposit
                </div>
              </div>
            </label>
            
            {matchEnabled && (
              <div className="mt-3 ml-7">
                <label className="text-xs text-muted-foreground">Match percentage</label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={10}
                    value={matchPercentage}
                    onChange={(e) => setMatchPercentage(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-sm font-bold text-primary w-12 text-right">
                    {matchPercentage}%
                  </span>
                </div>
              </div>
            )}
          </div>
          
          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          
          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Mountain'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
