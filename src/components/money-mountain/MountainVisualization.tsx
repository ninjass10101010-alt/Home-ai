'use client';

import { motion } from 'framer-motion';
import type { MoneyMountain } from '@/db/features/money-mountain';
import { formatCurrency, MOUNTAIN_THEMES } from '@/db/features/money-mountain';

interface MountainVisualizationProps {
  mountain: MoneyMountain;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}

export function MountainVisualization({
  mountain,
  onDeposit,
  onWithdraw,
}: MountainVisualizationProps) {
  const theme = MOUNTAIN_THEMES[mountain.mountainTheme || 'snow'];
  const progress = mountain.percentageComplete;
  const climberY = 100 - (progress * 0.85); // climber position (0-100 scale)
  
  const isSummitReached = progress >= 100;
  
  // Format the target amount
  const targetFormatted = formatCurrency(mountain.targetAmount, mountain.currency as any);
  const currentFormatted = formatCurrency(mountain.currentAmount, mountain.currency as any);
  
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      {/* Mountain SVG */}
      <div className="relative h-80 overflow-hidden">
        <svg
          viewBox="0 0 400 300"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* Sky gradient */}
          <defs>
            <linearGradient id={`sky-${mountain.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#87CEEB" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#E0F6FF" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id={`mountain-${mountain.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={theme.accent} stopOpacity="0.6" />
              <stop offset="100%" stopColor={theme.accent} stopOpacity="0.2" />
            </linearGradient>
          </defs>
          
          {/* Sky */}
          <rect width="400" height="300" fill={`url(#sky-${mountain.id})`} />
          
          {/* Sun */}
          <circle cx="320" cy="60" r="30" fill="#FFD700" opacity="0.6" />
          
          {/* Clouds */}
          <motion.g
            animate={{ x: [0, 20, 0] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          >
            <ellipse cx="80" cy="50" rx="40" ry="15" fill="white" opacity="0.5" />
            <ellipse cx="100" cy="45" rx="30" ry="12" fill="white" opacity="0.4" />
          </motion.g>
          
          {/* Background mountains */}
          <polygon points="0,250 100,150 200,250" fill={theme.accent} opacity="0.15" />
          <polygon points="150,250 250,180 350,250" fill={theme.accent} opacity="0.1" />
          
          {/* Main mountain */}
          <polygon
            points="50,280 200,80 350,280"
            fill={`url(#mountain-${mountain.id})`}
            stroke={theme.accent}
            strokeWidth="2"
          />
          
          {/* Snow cap */}
          <polygon
            points="170,100 200,80 230,100 210,105 190,105"
            fill="white"
            opacity="0.8"
          />
          
          {/* Path/trail */}
          <path
            d="M 100,270 Q 150,200 180,180 Q 190,150 200,80"
            stroke={theme.accent}
            strokeWidth="2"
            strokeDasharray="5,5"
            fill="none"
            opacity="0.4"
          />
          
          {/* Milestone markers */}
          {[25, 50, 75].map((pct) => {
            const markerY = 280 - (pct * 2);
            return (
              <g key={pct}>
                <circle
                  cx={200}
                  cy={markerY}
                  r="4"
                  fill={progress >= pct ? '#22c55e' : theme.accent}
                  opacity={progress >= pct ? 1 : 0.4}
                />
                <text
                  x={220}
                  y={markerY + 4}
                  fontSize="10"
                  fill={progress >= pct ? '#22c55e' : '#999'}
                >
                  {pct}%
                </text>
              </g>
            );
          })}
          
          {/* Climber */}
          <motion.g
            initial={{ y: 280 }}
            animate={{ y: climberY * 2.5 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          >
            <circle cx="190" cy="0" r="6" fill="#FF6B6B" />
            <motion.text
              x="180"
              y="18"
              fontSize="12"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              🧗
            </motion.text>
          </motion.g>
          
          {/* Summit flag */}
          {isSummitReached && (
            <motion.g
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200 }}
            >
              <line x1="200" y1="70" x2="200" y2="50" stroke="#22c55e" strokeWidth="2" />
              <motion.polygon
                points="200,50 220,55 200,60"
                fill="#22c55e"
                animate={{ rotate: [0, 5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <text x="205" y="48" fontSize="14">🏁</text>
            </motion.g>
          )}
        </svg>
        
        {/* Progress overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
          <div className="flex items-center justify-between text-white">
            <div>
              <div className="text-2xl font-bold">{currentFormatted}</div>
              <div className="text-sm opacity-80">of {targetFormatted}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black">{Math.round(progress)}%</div>
              <div className="text-sm opacity-80">
                {isSummitReached ? '🏔️ Summit!' : `${100 - Math.round(progress)}% to go`}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Action buttons */}
      <div className="flex gap-3 p-4">
        <button
          onClick={onDeposit}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          💰 Add Funds
        </button>
        <button
          onClick={onWithdraw}
          disabled={mountain.currentAmount <= 0}
          className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          💸 Withdraw
        </button>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 border-t border-border p-4">
        <div className="text-center">
          <div className="text-xs text-muted-foreground">Saved</div>
          <div className="text-sm font-semibold text-foreground">{currentFormatted}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground">Matched</div>
          <div className="text-sm font-semibold text-green-500">
            {formatCurrency(mountain.matchedAmount, mountain.currency as any)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground">Days Active</div>
          <div className="text-sm font-semibold text-foreground">{mountain.daysActive}</div>
        </div>
      </div>
    </div>
  );
}
