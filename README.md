# Mizan, Halal Income & Zakat Assessment

A client-side application that classifies income against a documented rule set, separates
impermissible earnings from assessable wealth, and calculates zakat under any of the four Sunni
schools, Hanafi, Maliki, Shafi'i, and Hanbali, as four fully isolated rule modules.

Everything runs in the browser. No network calls, no telemetry, no accounts.

## Running it

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

## Architecture

Two stages, deliberately kept apart:

**1. Classification** (`src/engine/classification.ts`), one madhhab-neutral pass that assigns
every ledger row exactly one verdict: permissible, impermissible, mixed, unresolved, incomplete,
or not-income. The schools differ on which *wealth* is assessable, not on whether a given income
stream is permissible, so this stage is shared. It also reconciles linked records: transfers
cancel, gross sale / processing fee / settlement triples count once at the net amount, refunds
reduce the sale they reverse, and a payment recorded twice under the same reference is detected
and counted once.

**2. Assessment** (`src/engine/zakat/{hanafi,maliki,shafii,hanbali}.ts`), four independent
modules. Each declares its own hawl rule shape, gold/silver inclusions, debt treatment, and
receivable handling. They share only arithmetic helpers (`shared.ts`), never rule decisions, so
no school's logic can leak into another.

### Supporting engines

| Module | Responsibility |
|---|---|
| `engine/money.ts` | Exact currency as integer cents. Floats are never used for money, `wealth × 0.025` on a six-figure balance drifts by cents that then disagree with the printed breakdown. Rounding is half-away-from-zero, applied only where a fraction is unavoidable. |
| `engine/hijri.ts` | Umm al-Qura lunar calendar via `Intl`, with a deterministic tabular fallback for stripped-ICU runtimes. The hawl is a lunar year (~354 days); measuring it in Gregorian years overshoots by ~11 days annually. |
| `engine/balanceSheet.ts` | Turns the classified ledger into a running daily balance. Zakat is assessed on wealth *held across* a year, so a single income total cannot answer whether the holding period was satisfied. |
| `engine/hawl.ts` | Evaluates the holding period from that balance series, finding the threshold crossing that starts the year, every dip, and the lunar anniversary, instead of asking the user to assert it. |
| `engine/nisab.ts` | Nisab derived from 87.48 g gold / 612.36 g silver at an operator-set fixed price. Metal holdings are entered by weight and purity, so gemstones and settings are excluded structurally rather than by hand. |

### Interface

`src/charts/` wraps ECharts, loaded on demand so the initial bundle does not carry it. Every
chart has a table view, a tooltip is never the only way to read a value. The status palette was
machine-validated for lightness band, chroma floor, protan/deutan/tritan separation, normal-vision
floor, and surface contrast in both themes; worst adjacent pair ΔE 9.9 light / 8.9 dark.

## Testing

71 tests covering exact-money arithmetic and parsing, the classification engine against a
transaction fixture, Hijri conversion and lunar-year arithmetic, balance-series derivation, both
hawl rule shapes, and twelve reference assessments, three wealth positions run through all four
schools, including a check that the four produce genuinely distinct results from identical input.

## Notes

- The rule sets are simplified working definitions, not fatwas. Unresolved cases are routed to the
  Review queue rather than decided.
- Bank interest is treated as riba and separated from assessable wealth. That is a stated
  position, not a neutral one.
- Metal prices are fixed operator inputs. Nothing reads a market rate.
- Agricultural, livestock, and mineral zakat are out of scope; this assesses monetary wealth.
