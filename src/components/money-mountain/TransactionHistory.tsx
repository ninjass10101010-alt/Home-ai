'use client';

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Gift } from 'lucide-react';
import type { MountainTransaction } from '@/db/features/money-mountain';
import { formatCurrency } from '@/db/features/money-mountain';

interface TransactionHistoryProps {
  transactions: MountainTransaction[];
  currency: string;
}

export function TransactionHistory({ transactions, currency }: TransactionHistoryProps) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">No transactions yet</p>
        <p className="text-xs text-muted-foreground mt-1">Add your first deposit to get started!</p>
      </div>
    );
  }
  
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Transaction History</h3>
      </div>
      
      <div className="divide-y divide-border max-h-96 overflow-y-auto">
        {transactions.map((tx) => (
          <TransactionRow key={tx.id} transaction={tx} currency={currency} />
        ))}
      </div>
    </div>
  );
}

function TransactionRow({
  transaction,
  currency,
}: {
  transaction: MountainTransaction;
  currency: string;
}) {
  const isDeposit = transaction.type === 'deposit';
  const isMatch = transaction.type === 'match';
  const isWithdrawal = transaction.type === 'withdrawal';
  
  const icons = {
    deposit: <TrendingUp className="h-4 w-4 text-green-500" />,
    withdrawal: <TrendingDown className="h-4 w-4 text-red-500" />,
    match: <Gift className="h-4 w-4 text-purple-500" />,
  };
  
  const colors = {
    deposit: 'text-green-500',
    withdrawal: 'text-red-500',
    match: 'text-purple-500',
  };
  
  const labels = {
    allowance: '🎁 Allowance',
    gift: '🎉 Gift',
    chore: '✅ Chore',
    bonus: '⭐ Bonus',
    match: '🤝 Parent Match',
    purchase: '🛒 Purchase',
    donation: '💝 Donation',
    other: '📦 Other',
  };
  
  const sourceLabel = isMatch
    ? '🤝 Parent Match'
    : labels[transaction.source as keyof typeof labels] || transaction.source;
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3 px-4 py-3"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
        {icons[transaction.type]}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {transaction.description}
          </span>
          {transaction.isMatch && (
            <span className="text-[10px] font-medium text-purple-500 bg-purple-500/10 px-1.5 py-0.5 rounded">
              MATCH
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{sourceLabel}</span>
          <span>·</span>
          <span>
            {new Date(transaction.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      </div>
      
      <div className={`text-sm font-bold ${colors[transaction.type]}`}>
        {isDeposit || isMatch ? '+' : '-'}
        {formatCurrency(transaction.amount, currency as any)}
      </div>
    </motion.div>
  );
}
