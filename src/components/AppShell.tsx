import { useState, type ReactNode } from 'react';
import { useApp } from '../store';
import { MADHHAB_LABELS, MADHHAB_ORDER } from '../types';
import type { Madhhab } from '../types';

export type Route = 'ledger' | 'wealth' | 'assessment' | 'scenarios' | 'review' | 'rulings';

const NAV: { id: Route; label: string }[] = [
  { id: 'ledger', label: 'Ledger' },
  { id: 'wealth', label: 'Holdings' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'review', label: 'Review' },
  { id: 'rulings', label: 'Rulings' },
];

export function AppShell({ route, onRoute, children }: { route: Route; onRoute: (r: Route) => void; children: ReactNode }) {
  const { madhhab, setMadhhab, classification, blockingIds, theme, toggleTheme } = useApp();
  const reviewCount = classification.tentativeCount + classification.missingInfoCount;

  return (
    <div className="min-h-screen bg-[var(--ground)]">
      <Masthead madhhab={madhhab} onMadhhab={setMadhhab} theme={theme} onTheme={toggleTheme} />

      <nav className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--ground)_88%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1180px] gap-0.5 overflow-x-auto px-5">
          {NAV.map((item) => {
            const active = route === item.id;
            const badge = item.id === 'review' ? reviewCount : item.id === 'ledger' ? blockingIds.length : 0;
            return (
              <button
                key={item.id}
                onClick={() => onRoute(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative whitespace-nowrap px-3.5 py-3 text-[13.5px] font-medium transition-colors duration-200 ${
                  active ? 'text-[var(--ink)]' : 'text-[var(--ink-mute)] hover:text-[var(--ink-soft)]'
                }`}
              >
                {item.label}
                {badge > 0 && (
                  <span
                    className="ml-1.5 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tnum"
                    style={{
                      background: `color-mix(in oklab, var(--data-${item.id === 'ledger' ? 'mixed' : 'tentative'}) 18%, transparent)`,
                      color: `var(--data-${item.id === 'ledger' ? 'mixed' : 'tentative'})`,
                    }}
                  >
                    {badge}
                  </span>
                )}
                {active && <span className="animate-sweep absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">{children}</main>

      <Footer />
    </div>
  );
}

function Masthead({
  madhhab,
  onMadhhab,
  theme,
  onTheme,
}: {
  madhhab: Madhhab;
  onMadhhab: (m: Madhhab) => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
}) {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-5 px-5 py-4">
        <div className="flex items-center gap-3">
          <Mark />
          <div>
            <p className="font-display text-[19px] leading-none text-[var(--ink)]">Mizan</p>
            <p className="mt-1 text-[11.5px] leading-none text-[var(--ink-mute)]">Halal income &amp; zakat assessment</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <MadhhabSwitch value={madhhab} onChange={onMadhhab} />
          <button
            onClick={onTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="rounded-lg border border-[var(--line)] px-2.5 py-2 text-[var(--ink-mute)] transition-colors duration-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              {theme === 'dark' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </>
              ) : (
                <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
              )}
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M16 5v22M9 27h14" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5 11h22" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5 11l-3 7a3.2 3.2 0 006.4 0L5 11z" stroke="var(--ink-soft)" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M27 11l-3 7a3.2 3.2 0 006.4 0L27 11z" stroke="var(--ink-soft)" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="16" cy="11" r="2.1" fill="var(--accent)" />
    </svg>
  );
}

function MadhhabSwitch({ value, onChange }: { value: Madhhab; onChange: (m: Madhhab) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2.5">
      <span className="hidden text-[11px] uppercase tracking-wide text-[var(--ink-mute)] sm:inline">Following</span>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex items-center gap-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent)] transition-all duration-200 hover:brightness-105"
        >
          {MADHHAB_LABELS[value]}
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M2.5 4.5L6 8l3.5-3.5" strokeLinecap="round" />
          </svg>
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
            <ul
              role="listbox"
              className="animate-rise absolute right-0 z-40 mt-1.5 w-[190px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] py-1 [box-shadow:var(--shadow-lift)]"
            >
              {MADHHAB_ORDER.map((m) => (
                <li key={m}>
                  <button
                    role="option"
                    aria-selected={m === value}
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] transition-colors duration-150 ${
                      m === value
                        ? 'text-[var(--accent)]'
                        : 'text-[var(--ink-soft)] hover:bg-[var(--ground)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {MADHHAB_LABELS[m]}
                    {m === value && (
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M2.5 7.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-5">
        <p className="max-w-2xl text-[11.5px] leading-relaxed text-[var(--ink-mute)]">
          Mizan applies a documented rule set for the selected school and shows its working. It is a calculation
          aid, not a source of religious rulings. Unresolved cases are routed to the Review queue for a qualified
          scholar.
        </p>
        <p className="text-[11.5px] text-[var(--ink-mute)]">Fixed metal prices · no live rates</p>
      </div>
    </footer>
  );
}
