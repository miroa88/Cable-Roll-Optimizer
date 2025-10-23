# Cable Roll Optimizer

Cable Roll Optimizer is a browser-based planning tool that helps electrical crews turn a raw cable schedule into an actionable roll plan. Import your project spreadsheet, tell the app how you want to optimize, and download a color-coded workbook that crews can follow in the field.

## Key Features

- Excel import with support for both single-column schedules and grouped multi-floor layouts.
- Automated floor detection to keep rolls organized by level whenever possible.
- Optional leftover roll inventory so partially used reels get re-used before cutting new stock.
- Multiple optimization strategies (balanced, floor isolation, waste minimization) powered by several packing algorithms.
- Detailed summary of shortages, waste, and spare cable with per-size breakdowns.
- One-click download of a ready-to-edit Excel template (`template.xlsx`) so you start with the expected column structure.
- Exportable roll plan workbook with color-coded floors and shortage warnings.

## Quick Start

1. Clone or download this repository.
2. Open `index.html` in a modern desktop browser (Chrome, Edge, Firefox, or Safari). No build step is required.
3. (Optional) Serve the folder with a static server such as `npx serve` if you prefer a local URL.

## Preparing Your Spreadsheet

- Required columns: `Units`, `Cable size`, `Length(FT)`. Header names are case-insensitive, and extra columns are ignored.
- Multi-floor layouts are supported when the sheet groups columns in repeating sets of three (Units / Cable size / Length). Each trio should represent a different floor.
- Use the **Download template (.xlsx)** button on the app to grab a validated starting file (`template.xlsx` in this repo) and fill in your project data.

## Using the App

1. **Load Cable Schedule** – Drag & drop or browse for your Excel file, then confirm the preview looks correct. The info panel lists detected cable sizes, floors, and total units.
2. **Add Leftover Rolls** (optional) – Record any partial reels on hand so the optimizer can prioritize using them.
3. **Choose Optimization Mode** – Pick the strategy that matches your priorities:
   - **Balanced (Recommended):** Mix of floor isolation and waste reduction.
   - **Floor Isolation:** Keeps each roll on a single floor even if it means more leftover cable.
   - **Minimize Waste:** Reduces leftover cable at the cost of mixing floors.
4. **Run Optimization** – Review shortage warnings, waste vs. spare metrics, and per-cable breakdowns.
5. **Export Plan** – Download the generated workbook, which includes cut lengths, shortages, colored floors, and notes for the crew.

## Optimization Details

- The app evaluates several packing algorithms (Floor Dedicated, Greedy, Best/First Fit Decreasing, Dynamic Programming, and a Genetic Algorithm) and keeps the best result for your chosen mode.
- Shortages are tracked and limited by the tolerance and tolerance count you provide.
- Waste vs. spare cable defaults to a 30 ft threshold (editable in the UI) to separate scrap from reusable leftovers.

## Exported Plan Workbook

- The `Roll Plan` worksheet includes roll IDs (`N-###` for new reels, `L-###` for leftovers), requested lengths, actual cut lengths, and notes on shortages.
- Rows are color-coded by floor to make staged cuts easy to identify.
- Status and notes flag shortages so the field team can plan stubs or schedule extra pulls.

## Technology Stack

- **Frontend:** Vanilla HTML, CSS, and JavaScript (no build tooling required).
- **Spreadsheet Handling:** [ExcelJS](https://github.com/exceljs/exceljs) loaded from a CDN.
- **Data Persistence:** In-memory state that resets when the page reloads.

## Contributing & Customization

Since the app is a static site, you can:

- Tweak styles in `styles.css` to match your branding.
- Update copy or layout in `index.html`.
- Extend optimization strategies or thresholds in `app.js`.

Pull requests are welcome. If you make major changes to the spreadsheet structure, update `template.xlsx` and the README accordingly so others stay in sync.
