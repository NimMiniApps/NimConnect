# Admin Stats Chart

## Goal

Make the admin stats page trend-first while preserving exact daily data on
demand.

The daily table is replaced in the default view by a chart. The complete table
remains available inside a closed disclosure.

## Chart interaction

The chart displays one metric at a time:

- Opens
- Wallets
- Handles

Opens is selected initially. A compact tab-like button group changes the
metric. Showing one series avoids placing larger open counts and smaller
wallet/handle counts on a misleading shared scale.

The chart covers the latest 30 UTC calendar days ending on the newest day in
the stats response. Missing dates are filled with zero values. If the response
has no days, the chart renders a quiet empty state.

The visualization is a responsive SVG line/area chart implemented locally
without a chart dependency. It includes:

- a zero baseline and a maximum-value guide;
- visible point markers;
- sparse date labels that remain legible at narrow widths;
- an accessible text alternative naming the selected metric and values; and
- points that expose exact date/value text through keyboard focus, pointer
  hover, and tap.

Motion is unnecessary; metric changes update immediately and respect the
existing static dashboard feel.

## Exact-data disclosure

A native `<details>` element follows the chart. Its summary reads
`View daily table` while closed. Opening it reveals the existing complete daily
table in newest-first order.

The native disclosure supplies keyboard behavior and state semantics without
custom JavaScript. The table is not removed from the accessibility tree while
open and retains all existing headings and values.

## Visual system

The chart uses the current NimConnect theme tokens, Mulish typography, card
surface, border, and focus treatment. Metric controls have a minimum 40-pixel
target, visible focus, and text labels so color is never the only indicator.

The chart sits between the total cards and the handle directory. The handle
directory remains unchanged.

## Verification

Component tests cover:

- Opens selected initially;
- switching among all three metric series;
- a 30-day UTC sequence with missing dates filled as zero;
- exact point labels;
- no-data handling; and
- the daily table being closed initially and present when opened.

After focused red-green verification, rerun the service/page tests, complete
frontend suite, production build, and backend tests before integration.
