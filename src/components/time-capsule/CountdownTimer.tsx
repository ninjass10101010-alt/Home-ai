'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getDaysUntilUnlock } from '@/db/features/time-capsule';

interface CountdownTimerProps {
  unlockDate: string;
  compact?: boolean;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function calculateTimeLeft(unlockDate: string): TimeLeft {
  const now = new Date().getTime();
  const unlock = new Date(unlockDate).getTime();
  const difference = unlock - now;
  
  if (difference <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  }
  
  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
    total: difference,
  };
}

export function CountdownTimer({ unlockDate, compact = false }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(calculateTimeLeft(unlockDate));
  
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(unlockDate));
    }, 1000);
    
    return () => clearInterval(timer);
  }, [unlockDate]);
  
  const daysUntilUnlock = getDaysUntilUnlock(unlockDate);
  
  if (timeLeft.total <= 0) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-green-600">
        <Clock className="h-4 w-4" />
        <span>Ready to unlock!</span>
      </div>
    );
  }
  
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span>
          {daysUntilUnlock > 0
            ? `${daysUntilUnlock} day${daysUntilUnlock !== 1 ? 's' : ''} until unlock`
            : 'Less than a day'}
        </span>
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Clock className="h-4 w-4 text-primary" />
        <span>Unlocks in:</span>
      </div>
      
      <div className="grid grid-cols-4 gap-2">
        <TimeUnit value={timeLeft.days} label="Days" />
        <TimeUnit value={timeLeft.hours} label="Hours" />
        <TimeUnit value={timeLeft.minutes} label="Mins" />
        <TimeUnit value={timeLeft.seconds} label="Secs" />
      </div>
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <motion.div 
      className="flex flex-col items-center rounded-lg bg-[var(--color-surface-3)]/50 backdrop-blur-xl p-2 ring-1 ring-white/10"
      whileHover={{ scale: 1.05, y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      <motion.span 
        className="text-2xl font-bold text-text-primary tabular-nums"
        key={value}
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        {value.toString().padStart(2, '0')}
      </motion.span>
      <span className="text-xs text-text-secondary">{label}</span>
    </motion.div>
  );
}
