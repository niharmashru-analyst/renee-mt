# Modern Trade Analytics — V4

Flask + HTML/CSS/JavaScript analytical dashboard.

## Local run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m flask --app app.app run --debug
```

Open http://127.0.0.1:5000

If activation is blocked, use the venv interpreter directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m flask --app app.app run --debug
```

## V4 changes

- Dark, high-contrast analytical UI.
- Searchable checkbox multi-select filters.
- User-selectable table columns.
- Server-side filtering/pagination for Order Tracking.
- CSV export respects filters and selected columns.
- KPI cards, monthly trend charts, status chart and data labels.
- Interactive Explorer with Chain/Customer/Category/Product lenses and drill-down.
- Stock Gap reads the actual uploaded/local Excel headers before comparison and lets the user select key and quantity columns.
- Central JSON-safe conversion for Pandas Timestamp, NumPy values, NaN and NaT.
- Five-minute in-memory cache by default.
- Optional SharePoint URL environment variables for deployment.

## V4.7 — regression fixes + new features

**Monthly trend chart went blank (the real cause):** the "default to current
month" filter from v4.5 had a side effect nobody caught — the Month filter
was slicing the entire dataset down to just "Aug" *before* the monthly trend
was computed, so the trend chart legitimately had only one point to draw
(exactly what the screenshot showed: an empty chart with just "Aug" on the
axis). Fixed at the root: the Month filter now only pins which month counts
as "Current" for the KPI cards — it no longer restricts which months appear
in the trend/volume charts. Picking "Jun" now correctly shows Jun as
current, May as previous, and still plots the full Apr–Aug trend line.

**Teal buttons / colors after the RENÉE reskin:** the CSS itself has zero
leftover teal — confirmed by grep. This was the browser serving a **stale
cached copy** of the pre-rebrand CSS/JS, which also likely explains the
"filter card behind main card" symptom (a mismatched pairing of old-cached-JS
with new-cached-CSS, or vice versa). Added a `?v=4.7` cache-busting query
parameter to both asset URLs, so this class of issue won't recur on future
updates — do one hard refresh (Ctrl+Shift+R / Cmd+Shift+R) after updating to
clear out anything already cached from before this fix.

**"Cannot set properties of null" crash on Explorer:** a real architectural
gap — if you navigated to a different tab while a page's data was still
loading, that page's fetch would resolve later and try to update DOM
elements that had already been replaced by the page you'd since switched to.
Fixed with a navigation-token guard: every page's async work now checks
whether you're still on that page before touching the DOM, and silently
no-ops if you've moved on. This was possible on any page, not just Explorer.

**Delivery Status donut — overlapping labels:** removed the legend (which
was competing for the same space as the on-slice labels) and switched to
ECharts' `moveOverlap: shiftY`, which nudges colliding labels apart
vertically instead of stacking them on top of each other.

**Stock Gap — status/search filtering:** results now have filter chips for
each status found (OK / Low / Stockout / Not Found, with live counts) plus a
product/key search box, so you can jump straight to just the Stockout rows
without scrolling. (Note: "Category" wasn't added as a filter — the Stock
File itself has no category column, only EAN/product/stock-by-location, so
there's nothing to filter by yet. If your order file's category column
should drive this, let me know which column and I'll wire it in.)

**Explorer — fill rate distribution summary:** each breakdown level now
shows a quick count of how many rows fall into 100%+, 70–100%, 50–70%, and
0–50% fill rate bands, recomputed live from whatever's currently on screen
(so it respects your active filters and drill-down scope).

## V4.6 — RENÉE brand theme

Reskinned to match RENÉE Cosmetics' actual brand identity instead of the
generic dark-teal dashboard look, based on the live site
(reneecosmetics.in) and product packaging:

- **Palette** — warm near-black background (`#0e0a0c`) instead of a
  blue-tinted dark mode, with **rose-gold** (`#c9976a`) as the primary accent
  and **blush** (`#e7aebb`) as the secondary — this mirrors the actual foil
  lettering on RENÉE's matte-black packaging, not an arbitrary "nice" color.
  A deep **wine** tone (`#7a2e3d`) is available for emphasis, echoing shade
  names like "Rage of Red." Every previously-hardcoded blue-gray in the CSS
  (borders, hovers, panel fills — 48 of them) was hue-shifted to a matching
  warm tone so nothing clashes.
- **Semantic colors kept separate from brand colors on purpose** — KPI
  deltas and status indicators still use plain green/red/amber, not
  rose-gold, so "good vs bad" stays instantly readable regardless of theme.
- **Typography** — added Playfair Display (an elegant serif) for the page
  title, card titles, KPI numbers, and the sidebar wordmark — echoing RENÉE's
  editorial, "Timelessly inspired, endlessly enhanced" tone. Inter stays for
  tables and dense data, since a serif at that density would hurt legibility.
- **Sidebar mark** — replaced the generic "MT" placeholder with a circular
  rose-gold-bordered "R" monogram and the RENÉE wordmark, plus the brand's
  real tagline in the footer.
- **Chart palette** — ECharts' default blue/green series colors are now the
  same rose-gold/blush/wine palette, so charts match the rest of the UI.

## V4.5 — batch of fixes and new features

**Stock Gap dropdown bug (the actual root cause):** the Order key/quantity
`<select>` elements start with the `disabled` attribute in the markup (so
they're visibly inert before a file loads). Nothing ever cleared that
attribute once headers arrived — so both dropdowns stayed permanently
unclickable, showing only the auto-guessed value with no way to open the
list, even after headers loaded successfully. Fixed: `fillSelect()` now
explicitly re-enables the control after populating it.

**Explorer — sortable columns, per-level column selection, persisted state:**
- Every column header is now clickable with a 3-state cycle: ascending →
  descending → back to unsorted.
- Each level (Chain / Shop / Category / Product) now has its own "Columns"
  picker, and — this was the specific ask — your column and sort choices are
  remembered **per dimension**, not per visit. Drill into Product, change
  columns, go back to Chain, drill into a different Shop, then into Product
  again — the Product-level table still shows the columns/sort you set
  earlier. Nothing resets just from navigating the breadcrumb.
- The Explorer chart is now a horizontal bar chart instead of vertical bars
  with rotated labels — this is what was cutting off names like "Health &
  Glow" / "Shoppers Stop". Horizontal bars give every label its own full-width
  row, so nothing needs to be rotated, truncated by overlap, or squeezed.

**Filters added to Overview, Fill Rate, Cancelled Orders, and Explorer** (Fill
Rate and Order Tracking already had them). All of them now also **default to
the current month** (the latest month present in your data — "Aug" as of this
build) instead of "All", so the page opens already scoped to now. Filters are
built once per page visit and never torn down on Apply, so — unlike before —
your checked filters stay checked after you click Apply instead of resetting.

**Cancelled Orders — filters + selectable cancellation reasons:** the Month/
Category/etc. filter bar is now present, and the five matching terms ("Order
below 7k", "Below 7k Value Cancel", "Cancel Under 5K Value", "Low Qty Not
Processed", "Out Of Stock") are shown as toggle chips — all on by default,
uncheck any to narrow the list to only the reasons you want.

**Monthly Fill Rate chart — missing data labels:** ECharts' default label
layout silently hides labels it judges as "overlapping," which is exactly
what happens with two close line series over only 5 months. Fixed by
offsetting the two series' labels (one above the line, one below) and
explicitly turning off ECharts' auto-hide behavior, so all labels now show.

**Stock Gap layout:** the controls grid was defined for 5 columns but had 7
controls in it, causing an uneven wrap (visible in the reported screenshot).
Rebuilt as a clean 4-column grid.

*One item I couldn't pin down without a screenshot:* the reported table
overlap. I hardened the general table/card layout defensively, but if it's
still visible after this update, a screenshot of exactly where it happens
will make it a five-minute fix instead of a guess.

## V4.4 — Order Tracking & Fill Rate temporarily hidden

Both pages are hidden from the sidebar for now (commented out in
`app/templates/index.html`, not deleted). Their code, routes, and API
endpoints are all untouched — to bring either page back, just uncomment its
`<button>` line in the nav.

## V4.3 — multi-level Explorer drill-down

**Before:** Explorer had one fixed level per lens (Chain/Customer/Category/
Product), and clicking a row just opened a raw, non-clickable list in a modal
— a dead end.

**Now:** Explorer supports true N-level drill-down in either direction:
- Start at Chain (or Shop/Category/Product) level.
- Click any row to fix that value, then pick **which dimension to break it
  down by next** (Shop, Product, Category — whichever aren't already fixed)
  via the pill buttons.
- Click again to go a level deeper — e.g. Chain → Product → Shop shows
  exactly which stores are short on that SKU within that chain. Chain → Shop
  → Product works the same way in reverse.
- A breadcrumb trail ("All › Life Style › RENEE Kohl Pencil") shows the
  current path and lets you jump back to any earlier level.
- Backed by one generalized `/api/explorer/breakdown` endpoint that accepts
  an arbitrary `scope` (already-fixed dimensions) and `by` (next dimension),
  rather than a fixed set of lens/drill pairs — so any dimension combination
  works, not just the ones explicitly wired up.

## V4.2 fix — Stock Gap column selection

**The bug:** the Stock Gap column dropdowns weren't showing every header from
the uploaded/local order file — they were silently filtered down to a narrow
"looks like a key/qty column" guess. On a real production file whose headers
don't happen to contain expected words (e.g. `DC_CODE`, `QTY_PER_PACK_OF_
ORDERING_UOM`), the right column could be excluded from the dropdown entirely,
or the wrong one could get auto-picked with no way to see what else was
available.

**The fix**, brought in line with the logic already proven on the live
Streamlit version (`pages/2_Stock_Gap_Dashboard.py`):
- Both dropdowns now **always list every column** in the file — never a
  filtered subset. The backend only *guesses* which one to pre-select; you can
  always pick any other column yourself.
- The key-column guess now depends on **Match mode**: EAN/SKU mode hints on
  `ean`/`barcode`/`upc`/`gtin`; Product Name mode hints on
  `product`/`name`/`description`/`item` — matching the reference app exactly.
- Added a **Header row #** field, matching the Streamlit page — protects
  against real files that have a title/blank row before the actual header row
  (you'd otherwise see `Unnamed: 0`, `Unnamed: 1`... as "columns").
- Added a **data preview** (first 5 rows) under the controls, exactly like the
  Streamlit page's "Loaded order data preview" — so a wrong file or wrong
  header row is obvious immediately, before you run the comparison.

## V4.1 fixes (this revision)

- **Charts/visualisations were silently missing** because ECharts loaded from an
  external CDN (`cdn.jsdelivr.net`) with no error handling — if that domain is
  blocked (corporate proxy, ad-blocker, offline), every chart call threw and
  nothing rendered, with no visible error. ECharts is now **vendored locally**
  under `app/static/js/echarts.min.js` and loaded from `/static/js/echarts.min.js`,
  so charts no longer depend on any external network call at runtime. The
  `chart()` helper also now catches failures and shows a visible message instead
  of failing silently.
- **Native `<select>` dropdowns (Stock Gap's Location/Match mode/Order key/Order
  quantity) could render with a white background and hard-to-read text on
  Windows**, because the open option list is OS-drawn chrome that ignores
  regular CSS. Added `color-scheme: dark` (both as a `<meta>` tag and in CSS),
  which tells modern Chrome/Edge/Firefox to theme native form controls dark by
  default. This is a browser-level fix, not a CSS override — it's the correct
  way to theme native `<select>` option lists.
- **Column selection only existed on Order Tracking and Cancelled Orders.**
  Added the same "Columns" picker to the Fill Rate Customer/Category tables and
  the Stock Gap results table.
- **Explorer row clicks and Orders row clicks used per-row `onclick` binding**,
  which is fragile if a table re-renders mid-flight. Switched both to event
  delegation on the table body, and made the "click to drill down" hint more
  visible in the Explorer.
- **Explorer's Product-lens drill-down ignored active filters** (Month,
  Category, etc.) — drilling into a GTIN always showed unfiltered results, even
  though the Explorer's aggregate view respected filters. Fixed so drill-down
  results are restricted to the same filtered order set.
- Added a 25MB upload cap (`MAX_CONTENT_LENGTH`) so the Stock Gap file-upload
  endpoints can't be handed an unbounded file.
- Removed a duplicate 4MB Excel file (`53a2c3ae-...xlsx`) that was an exact
  copy of `Dispatch Tracker.xlsx` and wasn't referenced by any code path.
