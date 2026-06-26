# Fiscal Data Toolkit

One-command Node scripts that pull **live US fiscal, banking, money-supply, and company-financials data** straight from official government APIs. **No API keys required.** Each script cites its source.

Built as a learning toolkit for understanding how the US economy actually works — the national debt, where tax money goes, how banks and money creation work, and what really drives stock prices. See **[CONCEPTS.md](CONCEPTS.md)** for the full write-up and the key data points to watch.

## Requirements

- Node.js 18+ (uses built-in `fetch`; no dependencies to install)

## Scripts

| Command | What it prints | Source API |
|---|---|---|
| `node scripts/fiscal-snapshot.mjs` | National debt, receipts, outlays, deficit, interest | [Treasury Fiscal Data](https://fiscaldata.treasury.gov/) |
| `node scripts/banking-snapshot.mjs` | All ~4,350 US banks: assets, deposits, securities, capital | [FDIC](https://banks.data.fdic.gov/docs/) |
| `node scripts/money-supply.mjs` | M2, cash in circulation, the 2020–21 "money printing" | [FRED](https://fred.stlouisfed.org/) (St. Louis Fed) |
| `node scripts/trade-balance.mjs` | Current-account deficit, trade balance, net international investment position | [FRED](https://fred.stlouisfed.org/) / BEA |
| `node scripts/stock-fundamentals.mjs TICKER` | Revenue, margins, profit, R&D, cash flow, balance sheet, **stock price**, a current trailing-12-month (TTM) row, and **valuation** (market cap, P/S, P/E, P/CF) | [SEC EDGAR](https://www.sec.gov/edgar/search/) + [Yahoo Finance](https://finance.yahoo.com/) |
| `node scripts/revenue-growth.mjs [TICKERS...]` | Screen a watchlist by revenue growth + margin trend; flags 20%+ growers | [SEC EDGAR](https://www.sec.gov/edgar/search/) |

Or via npm: `npm run fiscal`, `npm run banks`, `npm run money`, `npm run stock -- AMD`.

## Examples

```bash
node scripts/fiscal-snapshot.mjs          # how much the govt owes / spends / borrows
node scripts/banking-snapshot.mjs         # the whole US banking sector in one screen
node scripts/money-supply.mjs             # how much money exists + how much was printed
node scripts/stock-fundamentals.mjs MU    # Micron's real financials from its SEC filings
node scripts/stock-fundamentals.mjs NVDA  # compare a growth rocket...
node scripts/stock-fundamentals.mjs LMT   # ...to a steady government contractor
```

## How it works

Every number comes from a **public, authoritative government API** — the same data the news reports, pulled live. The scripts are plain JavaScript with zero dependencies. Two reusable tricks worth knowing:

- **FRED keyless CSV:** `https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES` returns any of FRED's hundreds of thousands of economic series with no key (e.g. `M2SL`, `UNRATE`, `CPIAUCSL`, `MORTGAGE30US`).
- **SEC EDGAR** needs no key but **requires a `User-Agent` header** identifying you, or it blocks the request.

## Data sources (human-readable versions)

- **Treasury:** [fiscaldata.treasury.gov](https://fiscaldata.treasury.gov/) · [America's Finance Guide](https://fiscaldata.treasury.gov/americas-finance-guide/)
- **FDIC:** [fdic.gov/quarterly-banking-profile](https://www.fdic.gov/analysis/quarterly-banking-profile/)
- **FRED:** [fred.stlouisfed.org](https://fred.stlouisfed.org/)
- **SEC EDGAR:** [sec.gov/edgar/search](https://www.sec.gov/edgar/search/)
- **Spending detail:** [USAspending.gov](https://www.usaspending.gov/)

## Disclaimer

For education and research only. Not financial advice. Figures are pulled live and may be revised by the issuing agencies.
