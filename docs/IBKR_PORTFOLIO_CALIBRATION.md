# IBKR portfolio calibration boundary

The portfolio calibration replay is an offline operation. It reads the latest ignored XML under `runtime-data/portfolio-analysis/raw-flex/`, backs up the ignored SQLite database, replaces the `ibkr-flex` source rows, recalculates date-level performance, and aligns benchmarks from existing local market-history caches.

Use:

```powershell
npm.cmd run portfolio:replay
```

This command must not call `portfolio:sync`, send a Flex request, change the local Flex secret, change a Flex Query, or write any credential or real account data to the repository. Raw XML, SQLite, backups, audit output, logs, and session state remain ignored runtime data.

The date-only method is `daily_flow_adjusted_return`: only normalized `deposit` and `withdrawal` records affect `external_net_flow`. Internal transfers remain displayable cash activity; dividend, interest, withholding tax, fee, and other internal income/expense records are stored as `income_events` and are not external capital flows. A true intraday Modified Dietz method requires complete, reliable timestamp coverage and is not inferred from date-only records.

Benchmark alignment uses the intersection of portfolio dates and existing local histories for Nasdaq-100, S&P 500, and SOXX. No external market-data request is part of this replay.

Public tests use synthetic fixtures only, including `SIM000001` and `synthetic-review-fixture`. Real response values and raw activity descriptions stay outside Git.
