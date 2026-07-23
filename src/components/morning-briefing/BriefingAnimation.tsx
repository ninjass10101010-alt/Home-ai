'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface BriefingAnimationProps {
  children: ReactNode;
  isVisible: boolean;
}

export function BriefingAnimation({ children, isVisible }: BriefingAnimationProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: isVisible ? 1 : 0 }}
      transition={{ duration: 0.5 }}
    >
      {children}
    </motion.div>
  );
}
