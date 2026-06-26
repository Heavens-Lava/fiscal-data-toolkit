# Concepts & Key Data Points

A plain-English reference for everything this toolkit measures — the US fiscal picture, how money is created and circulates, banking, interest rates, and what drives stock prices. Figures are roughly as of mid-2026 (FY2025 actuals where noted); re-run the scripts for live numbers.

---

## 1. The US fiscal picture (the big one)

| Measure | Figure (FY2025) | Why it matters |
|---|---|---|
| **Total tax revenue (receipts)** | **$5.24T** | What the government takes in |
| **Total spending (outlays)** | **$7.01T** | What it spends |
| **Deficit** | **$1.78T** | The yearly shortfall → added to the debt |
| **National debt** | **~$39T** (→$40T) | Accumulated deficits |
| **Borrowed per $1 spent** | **~$0.25** | A quarter of all spending is borrowed |

**The core problem:** the government spends ~$1.34 for every $1.00 it collects. That ~$1.78T gap is borrowed every year, and the interest on it compounds.

### Where the tax money comes from (FY2025 receipts)
- Individual income taxes: **$2.66T (51%)**
- Payroll / social-insurance taxes: **$1.75T (33%)** → *income + payroll = 84% of all revenue*
- Corporate income taxes: **$0.45T (9%)**
- Tariffs (customs duties): **$0.20T (4%)** — roughly doubled from 2024
- Excise / estate / misc: ~3%

### Where it goes (FY2025 spending, by category)
| Category | Share |
|---|---|
| Social Security | ~22% |
| **Net interest on the debt** | **~14%** (now the #1 single line item at ~$1.2T) |
| Health (Medicaid/ACA) | ~13% |
| National defense | ~13% |
| Medicare | ~12% |
| Income security | ~10% |
| Veterans / education / everything else | ~16% |

**Key insight:** ~**76% is mandatory programs + interest** that no annual budget can easily cut. The political fights are over the remaining ~24% (mostly the ~11% that is non-defense discretionary). You cannot "cut waste" your way out of the debt — the money is in retirement, healthcare, and interest.

### Debt as a share of the economy (the metric that actually matters)
Debt-to-GDP, not raw dollars, is how economists judge sustainability:
- 1946 (post-WW2 peak): **106%**
- 1974 (after the boom paid it down): **22%**
- 2025: **~98%** — nearly back to the WW2 peak

**How WW2 debt was "paid off":** it mostly *wasn't* paid in dollars — the economy grew and inflated faster than the debt, helped by (1) explosive postwar growth, (2) inflation eroding the debt's real value, (3) the Fed capping interest rates, (4) the **baby boom** flooding the workforce with young taxpayers, and (5) the war spending *stopping*. Today is harder: the spending (entitlements + interest) is permanent, and the boomers flipped from paying in to drawing out.

---

## 2. How money is created and circulated — **the equation**

> **MV = PQ**  (the "equation of exchange" / quantity theory of money)

- **M** = money supply (M2 ≈ **$23T**)
- **V** = velocity — how many times each dollar is spent per year (≈ **1.4**)
- **P** = the price level (inflation)
- **Q** = real output (real GDP)
- So **M × V = P × Q = nominal GDP** (≈ $30T)

**Rearranged, it explains inflation:**

> **%ΔP ≈ %ΔM − %ΔQ + %ΔV**
> (inflation ≈ money growth − real output growth + velocity change)

If money (M) grows faster than the economy produces goods (Q), and velocity (V) is stable, **prices (P) rise.** That is exactly the 2020–2022 story.

### Who actually creates money (the surprise)
1. **Commercial banks create ~90% of money** by *lending* — a new loan creates a new deposit out of thin air. (But every created dollar is a dollar *owed* — see §3.)
2. **The Federal Reserve** (independent of the government) creates *base money / reserves*, mostly by buying bonds from banks.
3. **The government does NOT print money** — it spends by *taxing + borrowing* (selling Treasuries).

### Velocity is the hidden variable
Velocity collapsed during COVID, which is why inflation was *delayed* then *surged*:
| Date | Velocity (V) |
|---|---|
| 2019 (pre-COVID) | 1.44 |
| 2020 Q2 (printing) | **1.13** ← money created but sitting still |
| 2026 | 1.41 ← circulating again |

### The 2020–2021 "money printing"
- M2: **$15.5T (Feb 2020) → $21.5T (Dec 2021)** = +$6.0T in ~22 months
- That's **+40%** (the famous stat) — or **~28% of all dollars then existing**, depending on the denominator. Both true.
- Result: 40-year-high inflation (~9% in 2022). The Fed then *shrank* M2 in 2022–23 (first contraction since the 1940s) to fight it. In **real** terms, there's now *less* money than in 2021.

---

## 3. Banking & the 2023 crisis

### The paradox: banks create money but still go bankrupt
Two facts resolve it:
1. **Creating money = creating debt, not wealth.** A new deposit is a liability the bank *owes*. Its net worth doesn't change.
2. **Banks create deposits, but cannot create reserves.** Only the Fed creates reserves (settlement cash). When depositors flee to another bank, you must pay in *real reserves you can't conjure*.

### How SVB died (March 2023)
1. Took in a flood of deposits (2020–21), parked them in long-term bonds at ~1.5%.
2. Rates rose to ~5% → **the bond see-saw**: those bonds lost market value → assets < liabilities (**insolvent**).
3. Depositors fled ($42B in a day) → SVB needed cash → had to **sell bonds at a loss** → confirmed insolvency → failed.

Two failure modes (SVB had both): **illiquid** (no cash now) and **insolvent** (owe more than you own). The Fed stopped the panic by lending reserves against underwater bonds at face value — doing what no single bank can do for itself (**lender of last resort**).

### US banking sector (live in `banking-snapshot.mjs`)
- ~**4,350 banks** (down from ~14,000 in the 1980s; top 10 hold ~54% of assets)
- Total assets ~**$26T**; deposits ~$21T; **securities ~$5.8T** (banks are huge holders of government debt)
- #1 bank: **JPMorgan Chase (~$4T, ~15% of the sector)**

---

## 4. Interest rates & the yield curve

**The yield curve** = the interest rate the government pays to borrow for different lengths of time.
- **Short end (1mo–1yr)** is set by the **Federal Reserve**.
- **Long end (10yr–30yr)** is set by the **market**.
- **Upward slope = normal/healthy.** Inverted (short > long) has preceded most recessions.

**The single most important rule (the see-saw):**
> When interest rates go **UP**, the price of existing bonds goes **DOWN** (and vice-versa).
Because a bond's payment is fixed; if new bonds pay more, the old one's price must fall until its yield matches.

**The number to watch:** the **10-Year Treasury yield** drives mortgage rates. Mortgage ≈ 10yr + ~2%. (e.g. 10yr 4.4% → ~6.5% mortgages.) Watch the 10-year, not the Fed, for where mortgages go.

---

## 5. What determines stock prices

> **Price = Earnings × Multiple (P/E)** — and stocks price the **expected future**, not the present.

The multiple reflects expected **growth**, the **safety** of earnings, and **interest rates** (higher rates discount future earnings → lower valuations, same see-saw as bonds).

**What to read in `stock-fundamentals.mjs`:**
- **Revenue growth** = momentum
- **Gross & net margin** = pricing power and profitability (rising = healthy)
- **Net income** = actual profit (the anchor)
- **R&D** = investment in the future
- **Operating cash flow** = *real* cash (vs accounting profit)
- **Cash vs debt** = balance-sheet safety

**Case studies (real SEC data):**
- **AMD** — revenue +34%, margins *doubled*, profit *tripled* → stock 4x'd. Growth + margins = high multiple.
- **Micron (MU)** — textbook *cyclical*: profit swung -$5.8B (2023) → +$8.5B (2025) as the memory-chip cycle turned. Up ~3x.
- **UnitedHealth (UNH)** — revenue grew to $448B but **margins collapsed (6.2%→2.7%) and profit halved** → stock crashed. *Revenue growth ≠ stock gains.*
- **Intel (INTC)** — revenue *declining*, posted a **-$18.8B loss (2024)** — yet stock rose on a *turnaround/AI-foundry bet*. Pure "priced on the future."
- **Lockheed (LMT)** — steady government revenue but shrinking margins → a slow "utility" stock. Government money buys *stability*, not *upside*.

---

## 6. Other countries (context)

Debt-to-GDP, 2025 — low debt isn't always strength:
- **Ukraine 108.6%** — exploding (war + survival borrowing)
- **USA ~100%** — high but borrows cheaply (reserve currency = privilege)
- **Iran 41.9%** — low, but *forced* (sanctioned, can't borrow)
- **Russia 22.5%** — *deliberately* low (sanctions-proofed fortress)

**The lesson:** the ability to borrow cheaply is itself a form of power. The US runs high debt because the world lets it; the dollar's reserve status is the single biggest thing protecting it — and the thing most at risk if confidence ever cracks.

---

## 7. The "numbers to watch" cheat sheet

| Indicator | Where | Healthy / warning |
|---|---|---|
| **National debt & deficit** | `fiscal-snapshot.mjs` | Deficit shrinking vs growing |
| **Interest as % of taxes** | `fiscal-snapshot.mjs` | Now ~24% and rising = warning |
| **10-Year Treasury yield** | FRED `DGS10` | Drives mortgages |
| **Yield curve slope** | Treasury | Inverted = recession watch |
| **M2 + velocity** | `money-supply.mjs` | M2 growth >> output growth = inflation risk |
| **Bank securities vs equity** | `banking-snapshot.mjs` | High + rising rates = SVB-style risk |
| **A stock's margin trend** | `stock-fundamentals.mjs` | Rising = healthy; falling w/ rising revenue = trap |

---

## 8. Data sources (all free, no key except where noted)

- **Treasury Fiscal Data** — debt, receipts, outlays, interest
- **FDIC** — every US bank's financials and failures
- **FRED** (St. Louis Fed) — any economic series (keyless CSV trick)
- **SEC EDGAR** — every public company's filings (needs a User-Agent header)
- **USAspending.gov** — where federal money goes (contracts, recipients)
- **World Bank / IMF / OECD** — comparable data for every country
- **Census, BLS, BEA** — demographics, jobs, GDP

*For education and research only. Not financial advice.*
