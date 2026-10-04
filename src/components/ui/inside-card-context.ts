"use client";

import { createContext, useContext } from "react";

/**
 * "This subtree is already inside a card body."
 *
 * `SectionCard` publishes it so a nested surface can drop its own chrome
 * instead of drawing a second card inside the first. The rule is contextual
 * rather than a `children`-shape sniff on purpose: /tasks' Pending card
 * passes three children (an optimistic row, a list-or-empty ternary, and an
 * inline add row), so the empty state is only the *visible* content at render
 * time — a shape test would miss it and leave the nested panel on screen.
 */
export const InsideCardContext = createContext(false);

export function useInsideCard(): boolean {
  return useContext(InsideCardContext);
}