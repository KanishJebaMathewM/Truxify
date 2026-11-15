## Problem

`generateHTMLReport()` in `backend/api/src/lib/reportGenerator.js` builds an HTML document by interpolating report data directly into template literals. The report title, summary labels and values, table titles, and every table cell can contain values that originated from orders, fleets, or user profiles. The function never encodes those values, so any `<`, `>`, quote, or ampersand is treated as markup when the exported file is opened in a browser.

## Root cause

The CSV exporter applies CSV quoting, but the HTML exporter assumes report data is trusted text. Exported reports are commonly opened directly from disk or shared with operations staff, so the browser executes inline event handlers and script tags with the document's origin and any local session context.

## Impact

- A customer-controlled shipment label, company name, or note becomes stored XSS against an operations user who opens the report.
- The exported file can make authenticated same-origin requests, read page content, or redirect the operator.
- Reports are portable artifacts, so the payload can execute outside the normal application CSP once the file is downloaded.

## Proposed fix

- Add a single `escapeHtml()` helper that encodes `&`, `<`, `>`, `"`, and `'`.
- Apply it to the title, summary metric label and value, table title, and each rendered table cell.
- Keep the existing layout and CSV behavior unchanged; only the text nodes become encoded.

## Verification

- Render a report containing `<img src=x onerror=alert(1)>`, `</script>`, and quote characters, and assert the output contains only encoded text.
- Confirm ordinary titles and numeric values render unchanged.
- Run `node --check` on the module and the report generator unit tests.

Request: @Senthil455 please assign this issue.
