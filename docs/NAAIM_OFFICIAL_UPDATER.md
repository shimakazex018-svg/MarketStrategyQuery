# NAAIM Official Weekly Updater

The active access mode is `public_official_workbook`. Every Friday at 07:30 Asia/Shanghai the internal scheduler checks only the official NAAIM Exposure Index page. If no newer source date is found, it can make one Saturday 07:30 follow-up check. A calendar week permits at most two official-page checks and one workbook download.

The updater follows only the page's explicit HTTPS `.xlsx` link on `naaim.org`; it never guesses upload URLs, uses MacroMicro, cookies, login, passwords, browser profiles, or subscription workarounds. Authentication, subscription, and missing-link conditions preserve the last successful local series.

Downloaded workbooks are temporary ignored runtime files and are normalized by the existing importer. A newer source date is required before atomic canonical replacement. Equal-date revisions are recorded as `source_revision_detected` and are not automatically applied. Manual import remains available through `npm.cmd run data:import:naaim -- <relative-runtime-path>`.

The one-shot administrative check is `npm.cmd run data:update:naaim`. It applies the same bounded discovery and validation policy. No Excel workbook, canonical NAAIM history, updater state, or audit record is tracked by Git.
