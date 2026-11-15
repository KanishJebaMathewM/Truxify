## Problem

`generateHTMLReport()` in `backend/api/src/lib/reportGenerator.js` builds an HTML document by interpolating report data directly into template literals. The report title, summary labels and values, table titles, and every table cell can contain values that originated from orders, fleets, or user profiles. The function never encodes those values, so any `<`, `>`, quote, or ampersand is treated as markup when the exported file is opened in a browser.

## Change

- Add a single `escapeHtml()` helper that encodes `&`, `<`, `>`, `"`, and `'`.
- Apply it to the title, summary metric label and value, table title, and each rendered table cell.
- Keep the existing layout and CSV behavior unchanged; only the text nodes become encoded.

## Verification

- Render a report containing `<img src=x onerror=alert(1)>`, `</script>`, and quote characters, and assert the output contains only encoded text.
- Confirm ordinary titles and numeric values render unchanged.
- Run `node --check` on the module and the report generator unit tests.

Closes #19436
