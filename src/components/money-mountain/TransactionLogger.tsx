'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Minus } from 'lucide-react';
import type { Currency } from '@/db/features/money-mountain';

interface TransactionLoggerProps {
  type: 'deposit' | 'withdrawal';
  currency: Currency;
  maxAmount?: number;
  onClose: () => void;
  onSubmit: (data: {
    amount: number;
    description: string;
    source: string;
  }) => Promise<void>;
}

const SOURCES = {
  deposit: [
    { value: 'allowance', label: '🎁 Allowance' },
    { value: 'gift', label: '🎉 Gift' },
    { value: 'chore', label: '✅ Chore' },
    { value: 'bonus', label: '⭐ Bonus' },
    { value: 'other', label: '📦 Other' },
  ],
  withdrawal: [
    { value: 'purchase', label: '🛒 Purchase' },
    { value: 'donation', label: '💝 Donation' },
    { value: 'other', label: '📦 Other' },
  ],
};

export function TransactionLogger({
  type,
  currency,
  maxAmount,
  onClose,
  onSubmit,
}: TransactionLoggerProps) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState(type === 'deposit' ? 'allowance' : 'purchase');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isDeposit = type === 'deposit';
  const currencySymbol = { USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$' }[currency];
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    const num = parseFloat(amount);
    if (!num || num <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    
    if (!isDeposit && maxAmount !== undefined && num > maxAmount) {
      setError(`Cannot withdraw more than ${currencySymbol}${maxAmount.toFixed(2)}`);
      return;
    }
    
    setLoading(true);
    
    try {
      await onSubmit({
        amount: num,
        description: description.trim() || (isDeposit ? 'Deposit' : 'Withdrawal'),
        source,
      });
      onClose();
    } catch (err) {
      setError(`Failed to ${type} funds`);
    } finally {
      setLoading(false);
    }
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
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                isDeposit ? 'bg-green-500/20' : 'bg-red-500/20'
              }`}
            >
              {isDeposit ? (
                <Plus className="h-5 w-5 text-green-500" />
              ) : (
                <Minus className="h-5 w-5 text-red-500" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isDeposit ? 'Add Funds' : 'Withdraw'}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">Amount</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">
                {currencySymbol}
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0.01"
                max={isDeposit ? undefined : maxAmount}
                className="w-full rounded-lg border border-border bg-background pl-10 pr-4 py-3 text-lg font-bold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                autoFocus
                required
              />
            </div>
            {!isDeposit && maxAmount !== undefined && (
              <p className="mt-1 text-xs text-muted-foreground">
                Available: {currencySymbol}{maxAmount.toFixed(2)}
              </p>
            )}
          </div>
          
          {/* Description */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isDeposit ? 'What is this for?' : 'What are you buying?'}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              maxLength={100}
            />
          </div>
          
          {/* Source */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              {isDeposit ? 'Source' : 'Category'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SOURCES[type].map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSource(s.value)}
                  className={`flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-all ${
                    source === s.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <span className="text-base">{s.label.split(' ')[0]}</span>
                  <span className="text-[10px] font-medium">{s.label.split(' ')[1]}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Quick amounts for deposits */}
          {isDeposit && (
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Quick add</label>
              <div className="flex gap-2">
                {[1, 5, 10, 20].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmount(String(val))}
                    className="flex-1 rounded-lg border border-border bg-background py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    {currencySymbol}{val}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          
          {/* Actions */}
          <div className="flex gap-3 pt-3 border-t border-border">
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
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                isDeposit
                  ? 'bg-green-500 hover:bg-green-600'
                  : 'bg-red-500 hover:bg-red-600'
              }`}
            >
              {loading ? 'Processing...' : `Confirm ${isDeposit ? 'Deposit' : 'Withdrawal'}`}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
