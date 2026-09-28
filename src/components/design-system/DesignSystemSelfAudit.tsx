"use client";

import { useEffect, useState, type CSSProperties } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SoftButton from "@/components/ui/SoftButton";

/**
 * The design system's **live self-audit** (UI audit 5.6): the four checks the
 * audit doc keeps asking for, run against the mounted page in the browser —
 * no axe dependency, no CI needed to see drift:
 *
 *  1. sub-12px text (the type floor),
 *  2. tap targets under 44×44 that do not carry `hit-44` (whose ::before
 *     expands the real hit area — jsdom and synthetic rects are skipped),
 *  3. interactive elements with no accessible name (aria-label /
 *     aria-labelledby / title / own text / wrapped label),
 *  4. resting inset box-shadows — the ban; sanctioned pressed states opt out
 *     with `data-ds-shadow-exempt` (the demo chrome carries it).
 */

export type AuditCategory = "sub-12px" | "tap-target" | "no-accessible-name" | "inset-shadow";

export interface AuditFinding {
  category: AuditCategory;
  detail: string;
}

const INTERACTIVE = "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='radio'], [role='switch']";

const LABELS: Record<AuditCategory, string> = {
  "sub-12px": "Text below the 12px floor",
  "tap-target": "Tap targets under 44×44 without hit-44",
  "no-accessible-name": "Controls with no accessible name",
  "inset-shadow": "Resting inset box-shadows (banned)",
};

function hasAccessibleName(el: Element): boolean {
  if (el.getAttribute("aria-label")?.trim()) return true;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) return true;
  if (el.getAttribute("title")?.trim()) return true;
  if (el.closest("label")) return true;
  if (el.textContent?.trim()) return true;
  return Array.from(el.querySelectorAll("img[alt]")).some((img) => (img.getAttribute("alt") ?? "").trim().length > 0);
}

/** Pure scanner — exported so tests can run it over a synthetic root. */
export function scanDesignSystem(root: ParentNode = document): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (el.closest("[data-ds-audit-ignore]")) continue;

    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isNaN(fontSize) && fontSize > 0 && fontSize < 12) {
      findings.push({ category: "sub-12px", detail: `${el.tagName.toLowerCase()} at ${fontSize}px` });
    }

    const shadow = getComputedStyle(el).boxShadow ?? "";
    if (shadow.includes("inset") && !el.closest("[data-ds-shadow-exempt]")) {
      const label = el.id
        ? `#${el.id}`
        : el.className?.toString().trim().slice(0, 48) || el.tagName.toLowerCase();
      findings.push({ category: "inset-shadow", detail: label });
    }

    if (el.matches(INTERACTIVE)) {
      if (!hasAccessibleName(el)) {
        findings.push({ category: "no-accessible-name", detail: el.outerHTML.slice(0, 60) });
      }
      if (!el.classList.contains("hit-44")) {
        const rect = el.getBoundingClientRect();
        // Skip unrendered elements (jsdom, display:none) — nothing to measure.
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          findings.push({ category: "tap-target", detail: `${Math.round(rect.width)}×${Math.round(rect.height)} ${el.outerHTML.slice(0, 40)}` });
        }
      }
    }
  }
  return findings;
}

export default function DesignSystemSelfAudit() {
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // The DOM must exist before it can be audited (and the rule that objects
    // to setState-in-effect has no alternative for a post-mount DOM read).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- audit runs after the page mounts.
    setFindings(scanDesignSystem());
  }, [nonce]);

  const counts = (Object.keys(LABELS) as AuditCategory[]).map((category) => ({
    category,
    label: LABELS[category],
    count: findings.filter((f) => f.category === category).length,
  }));
  const total = findings.length;

  return (
    <div data-ds-self-audit>
      <SectionCard
        title="Live self-audit"
        description="The four house rules, checked against this very page in the browser."
        headingLevel="h2"
        action={
          <SoftButton size="sm" variant="secondary" onClick={() => setNonce((n) => n + 1)}>
            Re-scan
          </SoftButton>
        }
      >
        <p
          className="text-sm font-bold"
          style={{ color: total === 0 ? "var(--color-accent-mint)" : "var(--color-accent-amber)" } as CSSProperties}
        >
          {total === 0 ? "Clean — no findings on this page." : `${total} finding${total === 1 ? "" : "s"} on this page`}
        </p>
        <ul className="mt-3 space-y-2">
          {counts.map((row) => (
            <li key={row.category} className="text-sm text-text-secondary">
              <span className="font-bold text-text-primary">{row.count}</span> · {row.label}
              {row.count > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-text-muted">
                  {findings
                    .filter((f) => f.category === row.category)
                    .slice(0, 3)
                    .map((f, i) => (
                      <li key={`${f.category}-${i}`} className="truncate">
                        {f.detail}
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
