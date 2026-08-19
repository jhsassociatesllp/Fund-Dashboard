/*
 * Fund Dashboard - frontend application logic.
 * Handles tab switching, drill-down navigation (Fund -> Client -> Client file
 * and Scheme -> Category), and all communication with the FastAPI backend.
 *
 * No build step required: this is loaded directly by index.html.
 */

const API_BASE = "/api";

const mainEl = document.getElementById("app-main");
const trailEl = document.getElementById("trail");
const menuBtn = document.getElementById("primary-menu-btn");
const navDrawer = document.getElementById("nav-drawer");
const navDrawerBackdrop = document.getElementById("nav-drawer-backdrop");
const navDrawerClose = document.getElementById("nav-drawer-close");
const brandHomeBtn = document.getElementById("brand-home-btn");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalPanel = document.getElementById("modal-panel");
const modalBody = document.getElementById("modal-body");
const modalTitle = document.getElementById("modal-title");
const modalClose = document.getElementById("modal-close");
const sidePanelBackdrop = document.getElementById("side-panel-backdrop");
const sidePanelEyebrow = document.getElementById("side-panel-eyebrow");
const sidePanelTitle = document.getElementById("side-panel-title");
const sidePanelBody = document.getElementById("side-panel-body");
const sidePanelSidebar = document.getElementById("side-panel-sidebar");
const sidePanelResizer = document.getElementById("side-panel-resizer");
const sidePanelClose = document.getElementById("side-panel-close");

// Application navigation state
const state = {
  tab: "dashboard",          // 'dashboard' | 'fund-name' | 'fund-scheme'
  fund: null,                 // { id, name }
  companySubTab: "client-master", // 'client-master' | 'corpus-movement' | 'income' | 'other-expense' | 'management-fees' | 'soa'
  incomeSubTab: null,           // null | 'realised-gain' | 'unrealised-gain' | 'corporate-action' - null until clicked
  soaSubTab: null,             // null | 'transaction' | 'closing' | 'xirr' - null until a section is clicked
  scheme: null,                // { id, name }
  category: null,               // { id, name }
  dashboardDateFrom: "",        // Dashboard date-range filter (yyyy-mm-dd from <input type="date">, "" = unbounded)
  dashboardDateTo: "",
  tableDateFilters: {},          // Per-table date-range filters elsewhere in the app (Client Master,
                                  // Corpus Movement, NAV/SOA categories, ...), keyed by a short id unique
                                  // to each view - see getTableDateFilter/dateFilterInlineHtml.
};

// Columns shown in the Fund -> Company -> Clients register, in display order.
const CLIENT_COLUMNS = [
  { key: "investor_name", label: "Investor Name" },
  { key: "client_class", label: "Class" },
  { key: "management_fees", label: "Management Fees", render: (value) => escapeHtml(formatPercentCell(value)) },
  { key: "client_code", label: "Client ID" },
  { key: "dp_id", label: "DP ID" },
  { key: "im_signing_date", label: "IM Signing Date" },
  { key: "status", label: "Status" },
  { key: "nominee_1_name", label: "Nominee 1 Name" },
  { key: "dob_or_incorporation_date", label: "DOB / Date of Incorporation" },
  { key: "joint_holder_name", label: "Joint Holder Name" },
  { key: "mobile_no", label: "Mobile No", raw: true },
  { key: "email_id", label: "Email ID" },
  { key: "address_1", label: "Address 1" },
  { key: "city", label: "City" },
  { key: "pin_code", label: "Pin Code", raw: true },
  { key: "country", label: "Country" },
  { key: "bank_name", label: "Bank Name" },
  { key: "bank_account_no", label: "Bank Account No", raw: true, render: (value) => escapeHtml(maskBankAccount(value)) },
  { key: "bank_account_type", label: "Bank Account Type" },
  { key: "bank_ifsc_code", label: "Bank IFSC Code" },
  { key: "commitment_amount", label: "Commitment Amount", currency: true },
  { key: "top_up_amount", label: "Top Up Amount", currency: true },
  { key: "commitment_reduced", label: "Commitment Reduced", currency: true },
  { key: "total_commitment", label: "Total Commitment", currency: true },
  { key: "initial_contribution", label: "Initial Contribution", currency: true },
  { key: "distributor_name", label: "Distributor Name" },
  { key: "distributor_code", label: "Distributor Code" },
  { key: "side_letters", label: "Side Letters" },
  { key: "remarks", label: "Remarks" },
  { key: "scheme", label: "Scheme" },
];

// Checklist of validating-document types for categories whose checklist isn't derived
// from the upload - kept in sync with FIXED_VALIDATION_TYPES in frontend/js/admin.js,
// where an admin edits which document satisfies each one plus any extra types they've
// added. Corpus In/Out start with a fixed list; the SOA categories start empty (an
// admin-added type is the only thing that'll ever show for those). Shown wherever the
// relevant view is rendered so the list still displays (with "Not specified" for gaps)
// even before the admin has ever saved anything - see openInvestorMovementDetail and
// renderSoaValidatedChecklist.
const FIXED_VALIDATION_TYPES = {
  "corpus-in": ["Capital Amt received", "Class Allocation", "Unit Allocation"],
  "corpus-out": ["Redemption Request", "Class Allocation", "Exit load applicability", "Bank Details"],
  transaction: [],
  closing: [],
  xirr: [],
  "performance-fees": [],
};

// Columns shown in the Corpus Movement register: one row per investor, aggregating their
// Corpus In and Corpus Out uploads (two separate files - see buildInvestorMovementSummary).
// The "Movements IN / OUT" column renders two clickable pills rather than a plain count;
// each opens that investor's full raw rows from just the one file (see
// openInvestorMovementDetail), since Corpus In and Corpus Out have entirely different
// column layouts and don't belong in one combined ledger table.
const INVESTOR_MOVEMENT_SUMMARY_COLUMNS = [
  { key: "investor_code", label: "Investor Code" },
  { key: "investor_name", label: "Investor Name" },
  { key: "client_class", label: "Class" },
  { key: "bank_account", label: "Bank A/c", raw: true },
  { key: "total_in", label: "Total In", currency: true },
  { key: "total_out", label: "Total Out", currency: true },
  { key: "net_movement", label: "Net Movement", currency: true },
  {
    key: "movements",
    label: "Movements IN / OUT",
    render: (value, record) => `
      <span class="movement-pill movement-pill--in" data-investor="${escapeHtml(record.investor_code)}" data-type="In">IN (${record.in_count})</span>
      <span class="movement-pill movement-pill--out" data-investor="${escapeHtml(record.investor_code)}" data-type="Out">OUT (${record.out_count})</span>
    `,
  },
];

// NAV tab: Income / Expense categories, each revealed via a hover flyout off its parent.
// Columns for these categories aren't standardized yet, so leaf views render whatever
// columns were present in the admin's uploaded file (see loadNavCategoryView).
const NAV_GROUPS = [
  {
    key: "income",
    label: "Income",
    categories: [
      { slug: "realised-gain", label: "Realised Gain" },
      { slug: "unrealised-gain", label: "Unrealised Gain" },
      { slug: "corporate-action", label: "Corporate Action" },
    ],
  },
  {
    key: "expense",
    label: "Expense",
    categories: [
      { slug: "other-expense", label: "Other Expense" },
      { slug: "performance-fees", label: "Performance Fees" },
      { slug: "management-fees", label: "Management Fees" },
    ],
  },
];

function buildInvestorMovementSummary(movements) {
  const byInvestor = new Map();

  movements.forEach((m) => {
    if (!byInvestor.has(m.investor_code)) {
      byInvestor.set(m.investor_code, {
        id: m.investor_code,
        investor_code: m.investor_code,
        investor_name: m.investor_name,
        client_class: "",
        bank_account: "",
        total_in: 0,
        total_out: 0,
        in_count: 0,
        out_count: 0,
      });
    }
    const entry = byInvestor.get(m.investor_code);
    if (m.movement_type === "In") {
      entry.total_in += m.amount;
      entry.in_count += 1;
    } else {
      entry.total_out += m.amount;
      entry.out_count += 1;
    }
    // Corpus In has no bank account column and Corpus Out doesn't always carry Class -
    // take whichever file actually has a value rather than letting a blank from the
    // other one win.
    if (!entry.client_class && m.client_class) entry.client_class = m.client_class;
    if (!entry.bank_account && m.bank_account) entry.bank_account = m.bank_account;
  });

  return Array.from(byInvestor.values()).map((entry) => ({
    ...entry,
    net_movement: entry.total_in - entry.total_out,
    movements: `IN (${entry.in_count}) / OUT (${entry.out_count})`,
  }));
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const message = res.status === 404 ? "Record not found." : "Unable to reach the server.";
    throw new Error(message);
  }
  return res.json();
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Shared formatter for any plain (non-currency) number shown in the UI - caps decimals
// at 2 places so a raw float from an upload (e.g. "3654021.1900000004") never reaches
// the screen with full floating-point precision.
const NUMBER_FORMAT_2DP = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

// Formats a table-cell value that *might* be numeric: an uploaded sheet's columns are
// a mix of numbers (Amount, Quantity), dates, IDs, and free text, and only the numeric
// ones should get decimal-rounding + thousands separators applied. Returns null for
// anything that isn't a plain number (dates, ISINs, "0:0" ratios, etc.) so the caller
// falls back to showing the original string untouched.
//
// A leading "'" is stripped before parsing - Excel's own "store as text" marker for a
// cell (typically added so a negative number, leading zero, or the like isn't
// auto-reformatted), which some uploads carry through into the cell value itself
// (e.g. "'-3496762.71") rather than being purely a display-only marker in Excel. Without
// stripping it, Number() sees a non-numeric string and this whole function bails out,
// leaving the raw "'-3496762.71" showing verbatim instead of a formatted number - this
// fixes it everywhere at once since every numeric cell in the app renders through here.
function formatNumericDisplay(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/^'/, "");
  if (raw === "" || Number.isNaN(Number(raw))) return null;
  return NUMBER_FORMAT_2DP.format(Number(raw));
}

// Strips a redundant midnight time-of-day from a date-only value that was uploaded as a
// full timestamp (e.g. "2024-01-03 00:00:00" -> "2024-01-03") - Excel/pandas serializes
// date columns that way, and the all-zero time is never meaningful, just visual noise.
function stripMidnightTime(value) {
  return String(value).replace(/^(\d{4}-\d{2}-\d{2}) 00:00:00(\.0+)?$/, "$1");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="m7.5 10 4.5 4.5L16.5 10"/><path d="M4 18h16"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`;

// Stat-chip icons (Corpus Movement's Total In / Total Out / Net Movement row).
const STAT_ICON_IN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></svg>`;
const STAT_ICON_OUT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 5h16"/></svg>`;
const STAT_ICON_NET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 8h14"/><path d="M5 8l-3 6a3 3 0 0 0 6 0z"/><path d="M19 8l-3 6a3 3 0 0 0 6 0z"/></svg>`;

// Icon-only - an arrow reads as "go back" on its own, no label needed. A single fixed id
// is safe here since only one drill-down view (fund detail, scheme categories, category
// detail) is ever mounted into mainEl at a time.
function backButtonHtml() {
  return `<button type="button" class="btn back-btn" id="view-back-btn" aria-label="Back" title="Back">${BACK_ICON}</button>`;
}

function wireBackButton(onClick) {
  const btn = document.getElementById("view-back-btn");
  if (btn) btn.addEventListener("click", onClick);
}

function csvCellValue(record, column) {
  const value = record[column.key];
  return value === null || value === undefined ? "" : String(value);
}

// Exports the given rows as a CSV file download - uses raw field values (not the
// currency-formatted/rendered display text) so the numbers stay usable in a spreadsheet.
function downloadCsv(filename, columns, rows) {
  const escapeCsvField = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [
    columns.map((col) => escapeCsvField(col.label)).join(","),
    ...rows.map((row) => columns.map((col) => escapeCsvField(csvCellValue(row, col))).join(",")),
  ];

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Primary navigation (Dashboard is the app's home page - Fund Name/Fund Scheme live
// behind this hamburger-triggered slide-in drawer instead of always-visible tabs,
// since they're secondary to the Dashboard landing view rather than equal peers of it).
// ---------------------------------------------------------------------------

function closePrimaryMenu() {
  navDrawer.classList.remove("is-open");
  navDrawerBackdrop.classList.remove("is-open");
  navDrawer.setAttribute("aria-hidden", "true");
  menuBtn.setAttribute("aria-expanded", "false");
}

function openPrimaryMenu() {
  navDrawer.classList.add("is-open");
  navDrawerBackdrop.classList.add("is-open");
  navDrawer.setAttribute("aria-hidden", "false");
  menuBtn.setAttribute("aria-expanded", "true");
}

menuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (navDrawer.classList.contains("is-open")) closePrimaryMenu();
  else openPrimaryMenu();
});

navDrawerBackdrop.addEventListener("click", closePrimaryMenu);
navDrawerClose.addEventListener("click", closePrimaryMenu);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePrimaryMenu();
});

function goToTab(tab) {
  closePrimaryMenu();
  if (tab === state.tab) return;

  state.tab = tab;
  state.fund = null;
  state.scheme = null;
  state.category = null;

  document.querySelectorAll(".nav-drawer__item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tab);
  });

  render();
}

navDrawer.addEventListener("click", (event) => {
  const button = event.target.closest(".nav-drawer__item");
  if (!button) return;
  goToTab(button.dataset.tab);
});

brandHomeBtn.addEventListener("click", () => goToTab("dashboard"));

// ---------------------------------------------------------------------------
// Trail (breadcrumb / drill path)
// ---------------------------------------------------------------------------

function renderTrail() {
  const nodes = [];

  if (state.tab === "dashboard") {
    nodes.push({ label: "Dashboard", onClick: () => navigateToDashboard() });
  } else if (state.tab === "fund-name") {
    nodes.push({ label: "Fund Name", onClick: () => navigateToFundRoot() });
    if (state.fund) nodes.push({ label: state.fund.name, onClick: () => navigateToFundClients(state.fund) });
  } else {
    nodes.push({ label: "Fund Scheme", onClick: () => navigateToSchemeRoot() });
    if (state.scheme) nodes.push({ label: state.scheme.name, onClick: () => navigateToSchemeCategories(state.scheme) });
    if (state.category) nodes.push({ label: state.category.name, onClick: () => navigateToCategoryDetail(state.category) });
  }

  trailEl.innerHTML = "";
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const el = document.createElement(isLast ? "span" : "button");
    el.className = "trail__node" + (isLast ? " is-current" : " is-link");
    el.textContent = node.label;
    if (!isLast) el.addEventListener("click", node.onClick);
    trailEl.appendChild(el);

    if (!isLast) {
      const sep = document.createElement("span");
      sep.className = "trail__sep";
      sep.textContent = "/";
      trailEl.appendChild(sep);
    }
  });
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function setLoading(message = "Loading records...") {
  mainEl.innerHTML = `<div class="loading-state">${escapeHtml(message)}</div>`;
}

function setError(message) {
  mainEl.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
}

// `subtitle` callers still pass a description string, but it's no longer rendered -
// kept as a parameter rather than stripped from every call site so a future page can
// still opt back into a subtitle without re-plumbing every heading() call.
function heading(title, subtitle) {
  return `
    <div class="view-heading">
      <h1>${escapeHtml(title)}</h1>
    </div>
  `;
}

function cardGridToolbarHtml(prefix, placeholder) {
  return `
    <div class="table-toolbar">
      <div class="search-field">
        <input type="search" id="${prefix}-search" class="search-input" placeholder="${escapeHtml(placeholder)}" aria-label="Search" />
      </div>
      <span class="table-toolbar__count" id="${prefix}-count"></span>
    </div>
  `;
}

// Wires a search box above a card-grid (Fund Name / Fund Scheme roots) the same way
// wireTableSearch does for the register tables: filters `items` client-side and re-renders.
function wireCardGridSearch(prefix, items, matchFn, renderFn) {
  const searchInput = document.getElementById(`${prefix}-search`);
  const countEl = document.getElementById(`${prefix}-count`);
  const updateCount = (shown) => {
    countEl.textContent = `${shown} of ${items.length} ${items.length === 1 ? "result" : "results"}`;
  };

  renderFn(items);
  updateCount(items.length);

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = !query ? items : items.filter((item) => matchFn(item, query));
    renderFn(filtered);
    updateCount(filtered.length);
  });
}

// ---------------------------------------------------------------------------
// Fund Name tab: Funds -> Clients -> Client file
// ---------------------------------------------------------------------------

async function navigateToFundRoot() {
  state.fund = null;
  renderTrail();
  setLoading("Loading funds...");
  try {
    const funds = await apiGet("/funds");
    mainEl.innerHTML =
      backButtonHtml() +
      heading("Fund Name", "Select a fund to view its client register.") +
      (funds.length ? cardGridToolbarHtml("fund", "Search funds...") : "") +
      `<div class="card-grid" id="fund-grid"></div>`;
    wireBackButton(() => goToTab("dashboard"));

    const grid = document.getElementById("fund-grid");
    if (funds.length === 0) {
      grid.innerHTML = `<div class="empty-state">No funds have been recorded yet.</div>`;
      return;
    }

    const renderFunds = (list) => {
      if (list.length === 0) {
        grid.innerHTML = `<div class="empty-state">No matching funds found.</div>`;
        return;
      }
      grid.innerHTML = "";
      list.forEach((fund) => {
        const card = document.createElement("button");
        card.className = "entity-card";
        card.innerHTML = `
          <span class="entity-card__eyebrow">Fund</span>
          <span class="entity-card__title">${escapeHtml(fund.name)}</span>
          <span class="entity-card__meta">View client register</span>
        `;
        card.addEventListener("click", () => navigateToFundClients(fund));
        grid.appendChild(card);
      });
    };

    wireCardGridSearch("fund", funds, (fund, query) => fund.name.toLowerCase().includes(query), renderFunds);
  } catch (err) {
    setError(err.message);
  }
}

// Bank account numbers are masked everywhere they're displayed on screen - table cell
// and the client detail panel - showing only the first 4 digits, the rest as X's. CSV
// export is untouched: downloadCsv/csvCellValue read the raw field directly (same as
// every other column - see downloadCsv's comment), since that's an explicit admin
// export rather than on-screen display.
function maskBankAccount(value) {
  const str = String(value ?? "").trim();
  if (!str || str === "-") return "-";
  return str.length <= 4 ? str : str.slice(0, 4) + "X".repeat(str.length - 4);
}

// Appends "%" for display to a value that's a plain decimal number/string with no unit
// in the data itself - e.g. XIRR's "SOA" column (the base rate the auditor's own
// recalculation cross-checks, see XIRR_FIELD_ALIASES in file_import.py) or Client
// Master's Management Fees. Reuses formatCellValue so it still goes through the same
// raw-value handling (empty -> "-", number formatting, ...) as every other cell rather
// than reimplementing it.
function formatPercentCell(value) {
  const text = formatCellValue({ value }, { key: "value" });
  return text === "-" ? text : `${text}%`;
}

function formatCellValue(record, column) {
  const value = record[column.key];
  if (column.currency) return formatCurrency(Number(value) || 0);
  if (column.number) return NUMBER_FORMAT_2DP.format(Number(value) || 0);
  if (value === null || value === undefined || value === "") return "-";
  if (column.raw) return stripMidnightTime(value);
  return formatNumericDisplay(value) ?? stripMidnightTime(value);
}

// `narrow` uses client-table--summary (width 100%, no forced min-width) instead of the
// default client-table's min-width: 2400px - meant for registers with a small number of
// columns (e.g. Corpus Movement's investor summary), where that min-width stretches short
// values apart with a lot of dead space between them. Client Master genuinely has ~27
// columns and needs the full-width horizontal-scroll layout instead.
// Always includes an empty pager slot below the table for wirePaginatedTableSearch to
// fill in once the row count clears its page size. `statusFilterHtml` is an optional
// All/Correct/Incorrect dropdown (see statusFilterSelectHtml) for tables whose rows
// carry auditor validation status - passing one also relocates the record-count/
// page-position text below the pager instead of the toolbar (see .table-footer-count
// in style.css), since a status filter plus a date filter already crowds that row.
function tableSectionHtml(prefix, columns, placeholder, narrow, hideDownload, extraToolbarHtml = "", statusFilterHtml = "") {
  const headCells = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join("");
  const countBelowPager = Boolean(statusFilterHtml);
  const countSpan = `<span class="table-toolbar__count" id="${prefix}-count"></span>`;
  return `
    <div class="table-toolbar">
      <div class="search-field">
        <input type="search" id="${prefix}-search" class="search-input" placeholder="${escapeHtml(placeholder)}" aria-label="Search" />
      </div>
      ${extraToolbarHtml}
      <div class="table-toolbar__right">
        ${statusFilterHtml}
        ${countBelowPager ? "" : countSpan}
        ${hideDownload ? "" : `<button type="button" class="btn" id="${prefix}-download">${DOWNLOAD_ICON}Download CSV</button>`}
      </div>
    </div>
    <div class="table-scroll">
      <table class="client-table${narrow ? " client-table--summary" : ""}">
        <thead><tr>${headCells}</tr></thead>
        <tbody id="${prefix}-table-body"></tbody>
      </table>
    </div>
    <div class="table-pager" id="${prefix}-pager"></div>
    ${countBelowPager ? `<div class="table-footer-count">${countSpan}</div>` : ""}
  `;
}

// The All/Correct/Incorrect status filter dropdown - same markup as the one already
// used by Management Fees' hand-rolled summary table, factored out so any paginated
// table with a __status column (see wirePaginatedTableSearch) can opt in the same way.
function statusFilterSelectHtml(prefix) {
  return `
    <select id="${prefix}-status-filter" class="search-input status-filter-select" aria-label="Filter by validation status">
      <option value="all">All Status</option>
      <option value="correct">Correct only</option>
      <option value="incorrect">Incorrect only</option>
    </select>
  `;
}

function renderTableRows(prefix, columns, records, onRowClick) {
  const tbody = document.getElementById(`${prefix}-table-body`);
  const countEl = document.getElementById(`${prefix}-count`);
  if (!tbody) return;

  countEl.textContent = `${records.length} record${records.length === 1 ? "" : "s"}`;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td class="empty-state" colspan="${columns.length}">No matching records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records
    .map((record) => {
      const cells = columns
        .map((col) => `<td>${col.render ? col.render(record[col.key], record) : escapeHtml(formatCellValue(record, col))}</td>`)
        .join("");
      const rowAttrs = onRowClick ? ` class="client-table__row" data-row-id="${escapeHtml(record.id)}"` : "";
      return `<tr${rowAttrs}>${cells}</tr>`;
    })
    .join("");

  if (onRowClick) {
    tbody.querySelectorAll("tr[data-row-id]").forEach((row) => {
      row.addEventListener("click", () => onRowClick(row.dataset.rowId));
    });
  }
}

function staticTableHtml(columns, records, emptyMessage, compact) {
  const headCells = columns.map((col) => `<th>${escapeHtml(col.label)}</th>`).join("");
  const rows = records
    .map((record) => {
      const cells = columns
        .map((col) => `<td>${col.render ? col.render(record[col.key], record) : escapeHtml(formatCellValue(record, col))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="table-scroll${compact ? " table-scroll--fit" : ""}">
      <table class="client-table${compact ? " client-table--compact" : ""}">
        <thead><tr>${headCells}</tr></thead>
        <tbody>${rows || `<tr><td class="empty-state" colspan="${columns.length}">${escapeHtml(emptyMessage || "No records found.")}</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

// Fills `pagerEl` with Prev/Next controls for a `currentPage` of `totalPages`, or empties
// it when there's only one page. `onChange(page)` is called with the newly clicked page -
// shared by wirePaginatedTableSearch and any other custom table (e.g. Management Fees'
// grouped summary) that paginates outside that helper.
function renderPagerControls(pagerEl, currentPage, totalPages, onChange) {
  if (!pagerEl) return;
  if (totalPages <= 1) {
    pagerEl.innerHTML = "";
    return;
  }
  pagerEl.innerHTML = `
    <button type="button" class="btn table-pager__btn" id="${pagerEl.id}-prev" ${currentPage === 1 ? "disabled" : ""}>Prev</button>
    <span class="table-pager__label">Page ${currentPage} of ${totalPages}</span>
    <button type="button" class="btn table-pager__btn" id="${pagerEl.id}-next" ${currentPage === totalPages ? "disabled" : ""}>Next</button>
  `;
  document.getElementById(`${pagerEl.id}-prev`).addEventListener("click", () => onChange(currentPage - 1));
  document.getElementById(`${pagerEl.id}-next`).addEventListener("click", () => onChange(currentPage + 1));
}

// Only renders `pageSize` rows at a time with Prev/Next
// controls (see tableSectionHtml's `paginate` flag for the pager slot this fills) -
// for registers long enough that showing every matching row at once is unwieldy.
// Also wires an All/Correct/Incorrect status filter (statusFilterSelectHtml) when the
// caller rendered one - detected by id convention (`${prefix}-status-filter`) rather
// than a parameter, since most callers don't have one, matching Management Fees'
// existing filter-by-record.__status behavior.
function wirePaginatedTableSearch(prefix, columns, allRecords, onRowClick, downloadFilename, pageSize) {
  const searchInput = document.getElementById(`${prefix}-search`);
  const statusFilterEl = document.getElementById(`${prefix}-status-filter`);
  const countEl = document.getElementById(`${prefix}-count`);
  const pagerEl = document.getElementById(`${prefix}-pager`);
  let currentRecords = allRecords;
  let currentPage = 1;

  function renderPage() {
    const totalPages = Math.max(1, Math.ceil(currentRecords.length / pageSize));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = (currentPage - 1) * pageSize;

    renderTableRows(prefix, columns, currentRecords.slice(start, start + pageSize), onRowClick);
    countEl.textContent = `${currentRecords.length} record${currentRecords.length === 1 ? "" : "s"}${
      totalPages > 1 ? ` — page ${currentPage} of ${totalPages}` : ""
    }`;

    renderPagerControls(pagerEl, currentPage, totalPages, (page) => {
      currentPage = page;
      renderPage();
    });
  }

  function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const status = statusFilterEl ? statusFilterEl.value : "all";
    currentRecords = allRecords.filter((record) => {
      if (status === "correct" && record.__status !== "correct") return false;
      if (status === "incorrect" && record.__status !== "incorrect") return false;
      if (!query) return true;
      return columns.some((col) => String(record[col.key] ?? "").toLowerCase().includes(query));
    });
    currentPage = 1;
    renderPage();
  }

  renderPage();

  searchInput.addEventListener("input", applyFilters);
  if (statusFilterEl) statusFilterEl.addEventListener("change", applyFilters);

  const downloadBtn = document.getElementById(`${prefix}-download`);
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => downloadCsv(downloadFilename, columns, currentRecords));
  }
}

async function navigateToFundClients(fund) {
  const isNewFund = !state.fund || state.fund.id !== fund.id;
  state.fund = fund;
  if (isNewFund) state.companySubTab = "client-master";
  renderTrail();
  renderCompanyView(fund);
}

function renderCompanyView(fund) {
  mainEl.innerHTML =
    backButtonHtml() +
    heading(fund.name, "Select a register to view.") +
    `
    <div class="subtabs" id="company-subtabs">
      <button class="subtab-button" data-subtab="client-master">Client Master</button>
      <button class="subtab-button" data-subtab="corpus-movement">Corpus Movement</button>
      <button class="subtab-button" data-subtab="income">Income</button>
      <button class="subtab-button" data-subtab="other-expense">Other Expense</button>
      <button class="subtab-button" data-subtab="performance-fees">Performance Fees</button>
      <button class="subtab-button" data-subtab="management-fees">Management Fees</button>
      <button class="subtab-button" data-subtab="soa">SOA</button>
    </div>
    <div id="company-subview"></div>
    `;

  wireBackButton(() => navigateToFundRoot());

  document.querySelectorAll(".subtab-button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.subtab === state.companySubTab);
    btn.addEventListener("click", () => {
      if (state.companySubTab === btn.dataset.subtab) return;
      state.companySubTab = btn.dataset.subtab;
      document.querySelectorAll(".subtab-button").forEach((b) => b.classList.toggle("is-active", b === btn));
      loadCompanySubView(fund);
    });
  });

  loadCompanySubView(fund);
}

async function loadCompanySubView(fund) {
  const container = document.getElementById("company-subview");
  container.innerHTML = `<div class="loading-state">Loading records...</div>`;

  try {
    if (state.companySubTab === "client-master") {
      const allClients = await apiGet(`/funds/${fund.id}/clients`);
      const filter = getTableDateFilter("client-master");
      const clients = filterRowsByDateRange(allClients, filter.from, filter.to, "im_signing_date");

      container.innerHTML = tableSectionHtml(
        "client",
        CLIENT_COLUMNS,
        "Search investor, client ID, city, bank, distributor...",
        false,
        false,
        dateFilterInlineHtml("client-master", allClients)
      );
      wireDateFilterBar("client-master", () => loadCompanySubView(fund));
      wirePaginatedTableSearch("client", CLIENT_COLUMNS, clients, openClientFile, `${fund.name} - Client Master.csv`, 40);
    } else if (state.companySubTab === "income") {
      // Income still groups 3 categories behind one tab (Realised/Unrealised Gain,
      // Corporate Action) - always land on the picker, nothing pre-selected, mirrors
      // SOA below.
      state.incomeSubTab = null;
      const group = NAV_GROUPS.find((g) => g.key === "income");
      container.innerHTML = navGroupMenuHtml(group) + `<div id="nav-category-view"></div>`;
      wireNavGroupMenu(fund, group);
    } else if (
      state.companySubTab === "other-expense" ||
      state.companySubTab === "performance-fees" ||
      state.companySubTab === "management-fees"
    ) {
      // Expense's 3 categories are each their own top-level tab (no picker) - the tab
      // itself is the category, so load it straight away.
      const category = state.companySubTab;
      const label = NAV_GROUPS.find((g) => g.key === "expense").categories.find((c) => c.slug === category).label;
      container.innerHTML = `<div id="nav-category-view"></div>`;
      await loadNavCategoryView(fund, category, label);
    } else if (state.companySubTab === "soa") {
      // Always land on the picker, nothing pre-selected - mirrors NAV, which never
      // auto-opens a category either.
      state.soaSubTab = null;
      container.innerHTML = soaMenuHtml() + `<div id="soa-category-view"></div>`;
      wireSoaMenu(fund);
    } else {
      const allMovements = await apiGet(`/funds/${fund.id}/corpus-movements`);
      const filter = getTableDateFilter("corpus-movement");
      const movements = filterRowsByDateRange(allMovements, filter.from, filter.to);
      const totalIn = movements.filter((m) => m.movement_type === "In").reduce((sum, m) => sum + m.amount, 0);
      const totalOut = movements.filter((m) => m.movement_type === "Out").reduce((sum, m) => sum + m.amount, 0);
      const net = totalIn - totalOut;
      const investorSummary = buildInvestorMovementSummary(movements);

      container.innerHTML =
        `
        <div class="stat-row">
          <div class="stat-chip stat-chip--icon stat-chip--in">
            <span class="stat-chip__icon">${STAT_ICON_IN}</span>
            <span class="stat-chip__body">
              <span class="stat-chip__label">Total In</span>
              <span class="stat-chip__value">${formatCurrency(totalIn)}</span>
            </span>
          </div>
          <div class="stat-chip stat-chip--icon stat-chip--out">
            <span class="stat-chip__icon">${STAT_ICON_OUT}</span>
            <span class="stat-chip__body">
              <span class="stat-chip__label">Total Out</span>
              <span class="stat-chip__value">${formatCurrency(totalOut)}</span>
            </span>
          </div>
          <div class="stat-chip stat-chip--icon stat-chip--net">
            <span class="stat-chip__icon">${STAT_ICON_NET}</span>
            <span class="stat-chip__body">
              <span class="stat-chip__label">Net Movement</span>
              <span class="stat-chip__value">${formatCurrency(net)}</span>
            </span>
          </div>
        </div>
        ` +
        tableSectionHtml(
          "corpus",
          INVESTOR_MOVEMENT_SUMMARY_COLUMNS,
          "Search investor, code, bank, class...",
          true,
          false,
          dateFilterInlineHtml("corpus-movement", allMovements)
        );
      wireDateFilterBar("corpus-movement", () => loadCompanySubView(fund));
      // No whole-row click handler - Corpus In and Corpus Out are different files with
      // different columns, so each has its own "IN (n)" / "OUT (n)" pill (rendered by the
      // "movements" column) rather than one combined row-click ledger.
      wirePaginatedTableSearch("corpus", INVESTOR_MOVEMENT_SUMMARY_COLUMNS, investorSummary, null, `${fund.name} - Corpus Movement.csv`, 40);
      document.getElementById("corpus-table-body").addEventListener("click", (event) => {
        const pill = event.target.closest(".movement-pill");
        if (!pill) return;
        openInvestorMovementDetail(fund, pill.dataset.investor, movements, pill.dataset.type);
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="error-state">${escapeHtml(err.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Dashboard tab: NAV growth chart, XIRR chart - the fund's landing view, built from
// one multi-sheet admin upload (Fund NAV / XIRR / Client Master sheets, see
// file_import.parse_dashboard_workbook on the backend). Client Master is uploaded and
// stored but not displayed here - see the per-fund Client Master tab instead.
// ---------------------------------------------------------------------------

const DASHBOARD_CHART_WIDTH = 640;
const DASHBOARD_CHART_HEIGHT = 220;
const DASHBOARD_CHART_PADDING = { top: 16, right: 16, bottom: 28, left: 56 };
const DASHBOARD_COMPACT_NUMBER_FORMAT = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoDateStartOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

// Quick date-range presets shown in the Dashboard filter bar, next to the From/To
// inputs - each is just a concrete "from" value with "to" left open-ended (through
// today), so clicking one sets exactly what typing the same range by hand would.
const DASHBOARD_RANGE_PRESETS = [
  { label: "1M", from: () => isoDateOffset(30) },
  { label: "3M", from: () => isoDateOffset(91) },
  { label: "6M", from: () => isoDateOffset(182) },
  { label: "YTD", from: () => isoDateStartOfYear() },
  { label: "1Y", from: () => isoDateOffset(365) },
  { label: "All", from: () => "" },
];

function formatDashboardDate(value) {
  const d = new Date(String(value ?? "").trim());
  if (Number.isNaN(d.getTime())) return String(value ?? "");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// A real header row is a set of column labels (a Date column, an amount column, ...);
// these finders match by intent rather than exact wording since the uploaded sheet's
// wording isn't guaranteed to stay identical release to release.
function findDashboardHeader(headers, pattern) {
  return headers.find((h) => pattern.test(h)) || null;
}

// Prefers a per-unit NAV figure (e.g. "NAV/Per pre tax and fee") over a total-AUM column
// like "Adjt. Closing NAV" - a per-unit value is what "NAV growth" means; a total-AUM
// figure conflates growth with capital in/outflows (a big contribution would look like
// a NAV jump it isn't).
function detectNavGrowthKey(headers) {
  return (
    findDashboardHeader(headers, /nav.*per|per.*nav|nav\s*\/\s*unit/i) ||
    findDashboardHeader(headers, /closing.*nav/i) ||
    findDashboardHeader(headers, /\bnav\b/i)
  );
}

// Finds a row set's date-ish column (Date, or a Year/From/Start column) by header name -
// shared by filterRowsByDateRange below and every other table's date filter (see
// dateFilterInlineHtml), so "what counts as the date column" stays one rule app-wide.
function detectDateColumn(rows) {
  if (!rows || rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  return (
    findDashboardHeader(headers, /^date$/i) ||
    findDashboardHeader(headers, /date/i) ||
    findDashboardHeader(headers, /^year$/i) ||
    findDashboardHeader(headers, /from|start/i)
  );
}

// Ascending sort by a row set's date column (detectDateColumn, or dateKeyOverride to pin
// one - same override rule filterRowsByDateRange below documents). A row whose date
// doesn't parse sorts to the end rather than disappearing or landing somewhere
// arbitrary - Array.prototype.sort is stable, so ties (including a run of unparseable
// rows) keep their original relative order.
function sortRowsByDate(rows, dateKeyOverride) {
  if (!rows || rows.length <= 1) return rows;
  const dateKey = dateKeyOverride || detectDateColumn(rows);
  if (!dateKey) return rows;
  return [...rows].sort((a, b) => {
    const da = new Date(String(a[dateKey] ?? "").trim()).getTime();
    const db = new Date(String(b[dateKey] ?? "").trim()).getTime();
    return (Number.isNaN(da) ? Infinity : da) - (Number.isNaN(db) ? Infinity : db);
  });
}

// Filters a row set to a date range using its date column, then sorts the result
// ascending by that same column (sortRowsByDate) so every table built from this - which
// is effectively every table in the app, see the call sites below - reads oldest-first
// by default rather than in whatever order Mongo happened to return. `dateKeyOverride`
// pins a specific column (e.g. Client Master's "im_signing_date", which must win over the
// row's other date-ish columns like DOB) instead of relying on detectDateColumn's
// auto-detection, which only looks at header wording and can't tell "signing date"
// from "date of birth" apart. Rows whose date column doesn't parse are kept (not
// dropped) by the range filter, since a bad date shouldn't silently make a row
// disappear from the filtered view - sortRowsByDate then pushes those to the end.
function filterRowsByDateRange(rows, fromDate, toDate, dateKeyOverride) {
  if (rows.length === 0) return rows;
  if (!fromDate && !toDate) return sortRowsByDate(rows, dateKeyOverride);

  const dateKey = dateKeyOverride || detectDateColumn(rows);
  if (!dateKey) return rows;

  const filtered = rows.filter((r) => {
    const d = new Date(String(r[dateKey] ?? "").trim());
    if (Number.isNaN(d.getTime())) return true;
    // Compared as local calendar-date strings (not Date objects) - the row's
    // "YYYY-MM-DD HH:MM:SS" value parses as local time while the <input type="date">
    // fromDate/toDate strings parse as UTC, so comparing Date objects directly shifts
    // by the local UTC offset and can wrongly drop rows that land exactly on the
    // range's start date (e.g. IST's +5:30 makes local midnight "earlier" than UTC
    // midnight on the same calendar day).
    const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (fromDate && dKey < fromDate) return false;
    if (toDate && dKey > toDate) return false;
    return true;
  });
  return sortRowsByDate(filtered, dateKey);
}

// Per-view state for the generic "every table" date-range filters below
// (state.tableDateFilters), keyed by a short id unique to each view (e.g.
// "client-master", "corpus-movement", "nav:realised-gain", "soa:transaction").
// Dashboard keeps its own separate dashboardDateFrom/dashboardDateTo (with quick-range
// presets) since that's a more elaborate filter bar - this is the compact version
// reused everywhere else.
function getTableDateFilter(key) {
  if (!state.tableDateFilters[key]) state.tableDateFilters[key] = { from: "", to: "" };
  return state.tableDateFilters[key];
}

// Renders "" (nothing) when `rows` has no detectable date-ish column, rather than
// showing a filter that could never do anything - same "only show it if it's useful"
// approach as the Dashboard's Investor Snapshot cards. Sits inline inside a table's own
// .table-toolbar row (next to the search field) rather than a separate card above it.
function dateFilterInlineHtml(key, rows) {
  if (!detectDateColumn(rows)) return "";
  const { from, to } = getTableDateFilter(key);
  return `
    <div class="table-toolbar__dates">
      <label for="${key}-date-from">From</label>
      <input type="date" id="${key}-date-from" value="${escapeHtml(from)}" />
      <label for="${key}-date-to">To</label>
      <input type="date" id="${key}-date-to" value="${escapeHtml(to)}" />
      <button type="button" class="btn table-toolbar__dates-clear" id="${key}-date-clear">Clear</button>
    </div>
  `;
}

// Wires a dateFilterInlineHtml(key, rows) instance's inputs/clear button - `onChange` is
// called (typically re-running the view's load function) whenever the range changes.
// No-ops if the filter bar wasn't rendered (dateFilterInlineHtml found no date column).
function wireDateFilterBar(key, onChange) {
  const fromInput = document.getElementById(`${key}-date-from`);
  if (!fromInput) return;
  const toInput = document.getElementById(`${key}-date-to`);
  const clearBtn = document.getElementById(`${key}-date-clear`);

  fromInput.addEventListener("change", () => {
    getTableDateFilter(key).from = fromInput.value;
    onChange();
  });
  toInput.addEventListener("change", () => {
    getTableDateFilter(key).to = toInput.value;
    onChange();
  });
  clearBtn.addEventListener("click", () => {
    const filter = getTableDateFilter(key);
    filter.from = "";
    filter.to = "";
    onChange();
  });
}

function computeLineGeometry(points) {
  const { top, right, bottom, left } = DASHBOARD_CHART_PADDING;
  const innerW = DASHBOARD_CHART_WIDTH - left - right;
  const innerH = DASHBOARD_CHART_HEIGHT - top - bottom;
  const values = points.map((p) => p.value);
  let minY = Math.min(...values);
  let maxY = Math.max(...values);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const spanY = maxY - minY;
  const plotted = points.map((p, i) => ({
    ...p,
    x: left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2),
    y: top + innerH - ((p.value - minY) / spanY) * innerH,
  }));
  return { plotted, minY, maxY, innerW, innerH };
}

function lineChartSvgHtml(points, chartId, color, axisFormatter) {
  const { top, left } = DASHBOARD_CHART_PADDING;
  const { plotted, minY, maxY, innerH } = computeLineGeometry(points);

  const pathD = plotted.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

  const gridCount = 3;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const value = minY + ((maxY - minY) * i) / gridCount;
    const y = top + innerH - (i / gridCount) * innerH;
    return `
      <line x1="${left}" y1="${y.toFixed(2)}" x2="${DASHBOARD_CHART_WIDTH - DASHBOARD_CHART_PADDING.right}" y2="${y.toFixed(2)}" class="trend-chart__gridline" />
      <text x="${left - 8}" y="${y.toFixed(2)}" class="trend-chart__axis-label trend-chart__axis-label--y">${escapeHtml(axisFormatter(value))}</text>
    `;
  }).join("");

  const xLabelIndexes = [...new Set(plotted.length > 1 ? [0, Math.floor((plotted.length - 1) / 2), plotted.length - 1] : [0])];
  const xLabels = xLabelIndexes
    .map(
      (i) =>
        `<text x="${plotted[i].x.toFixed(2)}" y="${DASHBOARD_CHART_HEIGHT - 6}" class="trend-chart__axis-label trend-chart__axis-label--x">${escapeHtml(
          formatDashboardDate(plotted[i].date)
        )}</text>`
    )
    .join("");

  const last = plotted[plotted.length - 1];

  return `
    <div class="trend-chart" id="${chartId}">
      <svg viewBox="0 0 ${DASHBOARD_CHART_WIDTH} ${DASHBOARD_CHART_HEIGHT}" class="trend-chart__svg">
        ${gridLines}
        <path d="${pathD}" class="trend-chart__line" style="stroke:${color}" />
        <circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="4" class="trend-chart__end-dot" style="fill:${color}" />
        ${xLabels}
        <line class="trend-chart__crosshair" x1="0" y1="${top}" x2="0" y2="${top + innerH}" hidden />
      </svg>
      <div class="trend-chart__tooltip" hidden></div>
    </div>
  `;
}

// The line/crosshair/tooltip already exist in the DOM from lineChartSvgHtml - this only
// attaches the hover behavior, per the dataviz skill's "ship a crosshair+tooltip by
// default" rule for line charts.
function wireLineChart(chartId, points, valueFormatter) {
  const container = document.getElementById(chartId);
  if (!container) return;
  const svg = container.querySelector(".trend-chart__svg");
  const tooltip = container.querySelector(".trend-chart__tooltip");
  const crosshair = container.querySelector(".trend-chart__crosshair");
  const { plotted } = computeLineGeometry(points);

  svg.addEventListener("mousemove", (event) => {
    const rect = svg.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * DASHBOARD_CHART_WIDTH;
    let nearest = plotted[0];
    let nearestDist = Infinity;
    plotted.forEach((p) => {
      const dist = Math.abs(p.x - svgX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = p;
      }
    });

    crosshair.setAttribute("x1", nearest.x);
    crosshair.setAttribute("x2", nearest.x);
    crosshair.removeAttribute("hidden");

    tooltip.innerHTML = `
      <div class="trend-chart__tooltip-label">${escapeHtml(formatDashboardDate(nearest.date))}</div>
      <div class="trend-chart__tooltip-value">${escapeHtml(valueFormatter(nearest.value))}</div>
    `;
    tooltip.style.left = `${(nearest.x / DASHBOARD_CHART_WIDTH) * 100}%`;
    tooltip.style.top = `${(nearest.y / DASHBOARD_CHART_HEIGHT) * 100}%`;
    tooltip.removeAttribute("hidden");
  });

  svg.addEventListener("mouseleave", () => {
    crosshair.setAttribute("hidden", "");
    tooltip.setAttribute("hidden", "");
  });
}

function renderNavGrowthChart(rows, emptyMessage) {
  if (rows.length === 0) {
    return { html: `<div class="empty-state">${escapeHtml(emptyMessage || "No Fund NAV data uploaded yet.")}</div>`, wire: () => {} };
  }

  const headers = Object.keys(rows[0]);
  const dateKey = findDashboardHeader(headers, /^date$/i) || findDashboardHeader(headers, /date/i);
  const navKey = detectNavGrowthKey(headers);
  if (!dateKey || !navKey) {
    return { html: `<div class="empty-state">Couldn't find a Date and NAV column in the Fund NAV sheet.</div>`, wire: () => {} };
  }

  const points = rows
    .map((r) => ({ date: r[dateKey], value: Number(r[navKey]) }))
    .filter((p) => p.date && !Number.isNaN(p.value))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (points.length === 0) {
    return { html: `<div class="empty-state">No usable NAV rows found.</div>`, wire: () => {} };
  }

  const chartId = "dashboard-nav-chart";
  return {
    html: lineChartSvgHtml(points, chartId, "var(--blue-700)", (v) => DASHBOARD_COMPACT_NUMBER_FORMAT.format(v)),
    wire: () => wireLineChart(chartId, points, (v) => NUMBER_FORMAT_2DP.format(v)),
  };
}

function computeBarGeometry(bars) {
  const { top, right, bottom, left } = DASHBOARD_CHART_PADDING;
  const innerW = DASHBOARD_CHART_WIDTH - left - right;
  const innerH = DASHBOARD_CHART_HEIGHT - top - bottom;
  const maxY = Math.max(...bars.map((b) => b.value), 0);
  const gap = 10;
  const barWidth = bars.length > 0 ? (innerW - gap * (bars.length - 1)) / bars.length : 0;
  const plotted = bars.map((b, i) => {
    const barHeight = maxY > 0 ? (b.value / maxY) * innerH : 0;
    return {
      ...b,
      x: left + i * (barWidth + gap),
      y: top + innerH - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });
  return { plotted, maxY, innerH };
}

function barChartSvgHtml(bars, chartId, color) {
  const { top, left } = DASHBOARD_CHART_PADDING;
  const { plotted, maxY, innerH } = computeBarGeometry(bars);

  const gridCount = 3;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const value = (maxY * i) / gridCount;
    const y = top + innerH - (i / gridCount) * innerH;
    return `
      <line x1="${left}" y1="${y.toFixed(2)}" x2="${DASHBOARD_CHART_WIDTH - DASHBOARD_CHART_PADDING.right}" y2="${y.toFixed(2)}" class="trend-chart__gridline" />
      <text x="${left - 8}" y="${y.toFixed(2)}" class="trend-chart__axis-label trend-chart__axis-label--y">${(value * 100).toFixed(1)}%</text>
    `;
  }).join("");

  const barsHtml = plotted
    .map(
      (b, i) => `
      <rect x="${b.x.toFixed(2)}" y="${b.y.toFixed(2)}" width="${Math.max(b.width, 1).toFixed(2)}" height="${Math.max(b.height, 0).toFixed(2)}" rx="3" class="trend-chart__bar" style="fill:${color}" data-bar-index="${i}" />`
    )
    .join("");

  const xLabels = plotted
    .map(
      (b) =>
        `<text x="${(b.x + b.width / 2).toFixed(2)}" y="${DASHBOARD_CHART_HEIGHT - 6}" class="trend-chart__axis-label trend-chart__axis-label--x">${escapeHtml(
          formatDashboardDate(b.periodStart)
        )}</text>`
    )
    .join("");

  return `
    <div class="trend-chart" id="${chartId}">
      <svg viewBox="0 0 ${DASHBOARD_CHART_WIDTH} ${DASHBOARD_CHART_HEIGHT}" class="trend-chart__svg">
        ${gridLines}
        ${barsHtml}
        ${xLabels}
      </svg>
      <div class="trend-chart__tooltip" hidden></div>
    </div>
  `;
}

// Bar chart hover is per-mark (one tooltip target per bar) rather than a shared
// crosshair, per the dataviz skill's interaction rules for discrete-period data.
function wireBarChart(chartId, bars) {
  const container = document.getElementById(chartId);
  if (!container) return;
  const tooltip = container.querySelector(".trend-chart__tooltip");
  const { plotted } = computeBarGeometry(bars);

  container.querySelectorAll(".trend-chart__bar").forEach((rect, i) => {
    const b = plotted[i];
    rect.addEventListener("mouseenter", () => {
      tooltip.innerHTML = `
        <div class="trend-chart__tooltip-label">${escapeHtml(formatDashboardDate(b.periodStart))} – ${escapeHtml(formatDashboardDate(b.periodEnd))}</div>
        <div class="trend-chart__tooltip-value">${(b.value * 100).toFixed(2)}%</div>
      `;
      tooltip.style.left = `${((b.x + b.width / 2) / DASHBOARD_CHART_WIDTH) * 100}%`;
      tooltip.style.top = `${(b.y / DASHBOARD_CHART_HEIGHT) * 100}%`;
      tooltip.removeAttribute("hidden");
    });
    rect.addEventListener("mouseleave", () => tooltip.setAttribute("hidden", ""));
  });
}

function renderXirrChart(rows, emptyMessage) {
  if (rows.length === 0) {
    return { html: `<div class="empty-state">${escapeHtml(emptyMessage || "No XIRR data uploaded yet.")}</div>`, wire: () => {} };
  }

  const headers = Object.keys(rows[0]);
  const startKey = findDashboardHeader(headers, /^year$/i) || findDashboardHeader(headers, /from|start/i);
  const endKey = findDashboardHeader(headers, /^to$/i) || findDashboardHeader(headers, /end/i);
  const returnKey = findDashboardHeader(headers, /return/i);
  if (!startKey || !returnKey) {
    return { html: `<div class="empty-state">Couldn't find a period and Return column in the XIRR sheet.</div>`, wire: () => {} };
  }

  const bars = rows
    .map((r) => ({ periodStart: r[startKey], periodEnd: endKey ? r[endKey] : r[startKey], value: Number(r[returnKey]) }))
    .filter((b) => b.periodStart && !Number.isNaN(b.value))
    .sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));

  if (bars.length === 0) {
    return { html: `<div class="empty-state">No usable XIRR rows found.</div>`, wire: () => {} };
  }

  const chartId = "dashboard-xirr-chart";
  return {
    html: barChartSvgHtml(bars, chartId, "var(--blue-700)"),
    wire: () => wireBarChart(chartId, bars),
  };
}

// Investor-level insights derived from the Dashboard's Client Master sheet
// (raw.client_master) - the sheet is uploaded and stored but otherwise unused on the
// Dashboard (see the per-fund Client Master tab for the full register). Column wording
// isn't guaranteed, same as the other Dashboard sheets, so keys are detected by intent
// rather than required to match exactly; the section is skipped entirely if neither a
// Class nor a Commitment-shaped column is found, rather than showing an empty/useless card.
const INVESTOR_COUNT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const COMMITMENT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.25"/></svg>`;
const AVG_COMMITMENT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>`;

function detectClientMasterInsightKeys(rows) {
  const headers = Object.keys(rows[0]);
  return {
    nameKey:
      findDashboardHeader(headers, /invest.*name/i) ||
      findDashboardHeader(headers, /client.*name/i) ||
      findDashboardHeader(headers, /^name$/i),
    classKey: findDashboardHeader(headers, /class/i),
    commitmentKey:
      findDashboardHeader(headers, /total.*commitment/i) ||
      findDashboardHeader(headers, /commitment.*amount/i) ||
      findDashboardHeader(headers, /commitment/i),
    statusKey: findDashboardHeader(headers, /status/i),
    schemeKey: findDashboardHeader(headers, /scheme/i),
  };
}

function insightBarRowHtml(label, value, maxValue, displayValue) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return `
    <div class="insight-bar-row">
      <span class="insight-bar-row__label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="insight-bar-row__track"><span class="insight-bar-row__fill" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="insight-bar-row__value">${escapeHtml(displayValue)}</span>
    </div>
  `;
}

// Groups rows by `categoryKey` (Class, Status, Scheme, City, Distributor, ...), summed
// by `commitmentKey` when there is one or simply counted when there isn't. Shared by
// both the ranked bar-list and donut renderers below, sorted largest-first.
function groupByCategory(rows, categoryKey, commitmentKey) {
  if (!categoryKey) return [];
  const byCategory = new Map();
  rows.forEach((r) => {
    const cat = String(r[categoryKey] || "").trim();
    if (!cat) return;
    const amount = commitmentKey ? Number(r[commitmentKey]) || 0 : 1;
    byCategory.set(cat, (byCategory.get(cat) || 0) + amount);
  });
  return [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
}

// Ranked bar-list card - the right shape for a category with a long tail (City,
// Distributor, ...) where a reader wants to compare many entries at once.
function buildCategoryBarListCard(entries, title, commitmentKey, limit = 8) {
  if (entries.length === 0) return "";
  const top = entries.slice(0, limit);
  const maxValue = Math.max(...top.map(([, v]) => v), 1);
  const rowsHtml = top
    .map(([cat, value]) =>
      insightBarRowHtml(cat, value, maxValue, commitmentKey ? formatCurrency(value) : `${value} investor${value === 1 ? "" : "s"}`)
    )
    .join("");

  return `
    <div class="dashboard-chart-card">
      <span class="dashboard-chart-card__title">${escapeHtml(title)}</span>
      <div class="insight-bar-list">${rowsHtml}</div>
    </div>
  `;
}

function truncateLabel(label, maxLen) {
  const s = String(label);
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

// On-theme (navy -> light blue) sequential palette for the donut cards below - not the
// rainbow CHART_PALETTE used by the NAV Gain donut, since these are neutral proportion
// breakdowns rather than a many-instrument-type legend.
const DASHBOARD_DONUT_PALETTE = ["#0A1F44", "#16407A", "#2E5C96", "#4A7AB3", "#7FA3CB", "#B7CBE2"];
const DASHBOARD_DONUT_OTHER_COLOR = "#94A3B8";

// Donut/pie card - the right shape for a small number of categories representing parts
// of one whole (Status, Class), where the proportion each takes up matters more than
// comparing a long tail of individual values (that's what the bar-list cards are for).
// `asPie` collapses the inner radius to 0 (donutSegmentPath still works - the inner arc
// just degenerates to the center point), for a plain pie instead of a ring.
function renderCategoryDonutCard(title, entries, commitmentKey, limit = 6, asPie = false, showOther = true) {
  if (entries.length === 0) return "";
  const top = entries.slice(0, limit);
  const rest = entries.slice(limit);
  const restTotal = rest.reduce((sum, [, v]) => sum + v, 0);
  const slices = top.map(([label, value], i) => ({ label, value, color: DASHBOARD_DONUT_PALETTE[i % DASHBOARD_DONUT_PALETTE.length] }));
  if (showOther && rest.length > 0 && restTotal > 0) {
    slices.push({ label: `Other (${rest.length})`, value: restTotal, color: DASHBOARD_DONUT_OTHER_COLOR });
  }

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return "";

  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = asPie ? 0 : rOuter - 26;
  const gapDeg = slices.length > 1 ? 2 : 0;

  let angle = 0;
  const arcs = slices
    .map((s) => {
      const sweep = (s.value / total) * 360;
      const start = angle + gapDeg / 2;
      let end = angle + sweep - gapDeg / 2;
      angle += sweep;
      if (end <= start) return null;
      const pct = (s.value / total) * 100;
      return { ...s, d: donutSegmentPath(cx, cy, rOuter, rInner, start, end), pct };
    })
    .filter(Boolean);

  const formatValue = (v) => (commitmentKey ? formatCurrency(v) : `${v} investor${v === 1 ? "" : "s"}`);

  const svgPaths = arcs
    .map(
      (a) => `
      <path class="insight-donut__slice" d="${a.d}" fill="${a.color}">
        <title>${escapeHtml(a.label)}: ${escapeHtml(formatValue(a.value))} (${a.pct.toFixed(1)}%)</title>
      </path>`
    )
    .join("");

  const legendRows = arcs
    .map(
      (a) => `
      <li class="insight-donut__legend-row">
        <span class="insight-donut__legend-swatch" style="background:${a.color}"></span>
        <span class="insight-donut__legend-label" title="${escapeHtml(a.label)}">${escapeHtml(a.label)}</span>
        <span class="insight-donut__legend-value">${escapeHtml(formatValue(a.value))}</span>
      </li>`
    )
    .join("");

  return `
    <div class="dashboard-chart-card">
      <span class="dashboard-chart-card__title">${escapeHtml(title)}</span>
      <div class="insight-donut">
        <svg class="insight-donut__svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${svgPaths}</svg>
        <ul class="insight-donut__legend">${legendRows}</ul>
      </div>
    </div>
  `;
}

// Top N individual investors by commitment, rather than grouped by category.
function buildTopInvestorsCard(rows, nameKey, commitmentKey, limit = 8) {
  if (!nameKey || !commitmentKey) return "";
  const byInvestor = new Map();
  rows.forEach((r) => {
    const name = String(r[nameKey] || "").trim();
    if (!name) return;
    byInvestor.set(name, (byInvestor.get(name) || 0) + (Number(r[commitmentKey]) || 0));
  });
  if (byInvestor.size === 0) return "";

  const entries = [...byInvestor.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const maxValue = Math.max(...entries.map(([, v]) => v), 1);
  const rowsHtml = entries.map(([name, value]) => insightBarRowHtml(name, value, maxValue, formatCurrency(value))).join("");

  return `
    <div class="dashboard-chart-card">
      <span class="dashboard-chart-card__title">Top Investors by Commitment</span>
      <div class="insight-bar-list">${rowsHtml}</div>
    </div>
  `;
}

function renderInvestorInsights(rows) {
  if (rows.length === 0) return null;
  const { nameKey, classKey, commitmentKey, statusKey, schemeKey } = detectClientMasterInsightKeys(rows);
  if (!classKey && !commitmentKey) return null;

  const totalInvestors = nameKey ? new Set(rows.map((r) => r[nameKey]).filter(Boolean)).size : rows.length;
  const totalCommitment = commitmentKey ? rows.reduce((sum, r) => sum + (Number(r[commitmentKey]) || 0), 0) : null;
  const avgCommitment = totalCommitment !== null && totalInvestors > 0 ? totalCommitment / totalInvestors : null;

  const statsHtml = `
    <div class="stat-row dashboard-stat-row">
      <div class="stat-chip stat-chip--icon stat-chip--in">
        <span class="stat-chip__icon">${INVESTOR_COUNT_ICON}</span>
        <span class="stat-chip__body">
          <span class="stat-chip__label">Total Investors</span>
          <span class="stat-chip__value">${totalInvestors}</span>
        </span>
      </div>
      ${
        totalCommitment !== null
          ? `
      <div class="stat-chip stat-chip--icon stat-chip--net">
        <span class="stat-chip__icon">${COMMITMENT_ICON}</span>
        <span class="stat-chip__body">
          <span class="stat-chip__label">Total Commitment</span>
          <span class="stat-chip__value">${formatCurrency(totalCommitment)}</span>
        </span>
      </div>
      <div class="stat-chip stat-chip--icon stat-chip--in">
        <span class="stat-chip__icon">${AVG_COMMITMENT_ICON}</span>
        <span class="stat-chip__body">
          <span class="stat-chip__label">Avg Commitment / Investor</span>
          <span class="stat-chip__value">${formatCurrency(avgCommitment)}</span>
        </span>
      </div>`
          : ""
      }
    </div>
  `;

  // A mix of chart shapes rather than one repeated everywhere: Class is a donut (several
  // categories, ring reads cleaner than a full pie), Status is a plain pie (just 2
  // categories - the classic pie case), and the remaining long-tail rankings (Scheme,
  // individual investors) get a ranked bar-list - each is the shape its data is best
  // read in. City/Distributor column charts were dropped from the Dashboard per user
  // request.
  const cardsHtml = [
    renderCategoryDonutCard(
      commitmentKey ? "Top 5 Commitment by Class" : "Top 5 Investors by Class",
      groupByCategory(rows, classKey, commitmentKey),
      commitmentKey,
      5,
      false,
      false
    ),
    buildTopInvestorsCard(rows, nameKey, commitmentKey),
    renderCategoryDonutCard("Investors by Status", groupByCategory(rows, statusKey, null), null, 6, true),
    buildCategoryBarListCard(groupByCategory(rows, schemeKey, commitmentKey), commitmentKey ? "Commitment by Scheme" : "Investors by Scheme", commitmentKey),
  ]
    .filter(Boolean)
    .join("");

  return { statsHtml, cardsHtml, chartsToWire: [] };
}

function slugifyForId(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "sheet";
}

// Extra Dashboard sheets (anything the admin adds beyond Fund NAV / XIRR / Client Master)
// get their chart type auto-guessed from their column shape rather than asked about at
// upload time: a Date (or period-start) column plus a numeric column becomes a chart -
// bar if it also has a period-end column and few rows (matching XIRR's shape), otherwise
// line (matching Fund NAV's shape); anything else falls back to a plain searchable table,
// like Client Master.
function detectAutoChartKind(rows) {
  const headers = Object.keys(rows[0]);
  const dateKey = findDashboardHeader(headers, /^date$/i) || findDashboardHeader(headers, /date/i);
  const startKey = dateKey || findDashboardHeader(headers, /^year$/i) || findDashboardHeader(headers, /from|start/i);
  const endKey = findDashboardHeader(headers, /^to$/i) || findDashboardHeader(headers, /end/i);

  if (!startKey) return { kind: "table" };

  const numericKeys = headers.filter(
    (h) =>
      h !== startKey &&
      h !== endKey &&
      rows.every((r) => r[h] !== "" && r[h] !== undefined && r[h] !== null && !Number.isNaN(Number(r[h])))
  );
  if (numericKeys.length === 0) return { kind: "table" };

  const valueKey = numericKeys[numericKeys.length - 1];
  if (endKey && rows.length <= 20) return { kind: "bar", startKey, endKey, valueKey };
  return { kind: "line", dateKey: startKey, valueKey };
}

function renderAutoChart(sheetName, rows) {
  const shape = detectAutoChartKind(rows);
  const chartId = `dashboard-extra-chart-${slugifyForId(sheetName)}`;

  if (shape.kind === "line") {
    const points = rows
      .map((r) => ({ date: r[shape.dateKey], value: Number(r[shape.valueKey]) }))
      .filter((p) => p.date && !Number.isNaN(p.value))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (points.length > 0) {
      return {
        kind: "line",
        html: lineChartSvgHtml(points, chartId, "var(--blue-700)", (v) => DASHBOARD_COMPACT_NUMBER_FORMAT.format(v)),
        wire: () => wireLineChart(chartId, points, (v) => NUMBER_FORMAT_2DP.format(v)),
      };
    }
  } else if (shape.kind === "bar") {
    const bars = rows
      .map((r) => ({ periodStart: r[shape.startKey], periodEnd: r[shape.endKey], value: Number(r[shape.valueKey]) }))
      .filter((b) => b.periodStart && !Number.isNaN(b.value))
      .sort((a, b) => new Date(a.periodStart) - new Date(b.periodStart));
    if (bars.length > 0) {
      return {
        kind: "bar",
        html: barChartSvgHtml(bars, chartId, "var(--blue-700)"),
        wire: () => wireBarChart(chartId, bars),
      };
    }
  }

  return { kind: "table" };
}

// Raw, unfiltered Dashboard payload from the last /api/dashboard fetch - kept around so
// the date-range filter can re-render from cached data instead of re-fetching on every
// change.
let dashboardRawData = null;

// The app's landing page (state.tab === "dashboard") - NOT scoped to any fund, unlike
// everything else in this file. Built from one admin-uploaded, multi-sheet Excel file
// (see file_import.parse_dashboard_workbook on the backend); GET /api/dashboard has no
// {fund_id} in its path.
async function navigateToDashboard() {
  state.fund = null;
  renderTrail();
  setLoading("Loading dashboard...");

  try {
    dashboardRawData = await apiGet("/dashboard");
    renderDashboardView();
  } catch (err) {
    setError(err.message);
  }
}

// Re-renders the Dashboard from dashboardRawData, applying the date-range filter
// (state.dashboardDateFrom / dashboardDateTo) to every date-bearing sheet. Called both
// after the initial fetch and whenever the filter bar's inputs change.
function renderDashboardView() {
  const raw = dashboardRawData;
  const { dashboardDateFrom: from, dashboardDateTo: to } = state;

  const fundNavRows = filterRowsByDateRange(raw.fund_nav, from, to);
  const xirrRows = filterRowsByDateRange(raw.xirr, from, to);
  const extraEntries = Object.entries(raw.extra_sheets || {})
    .filter(([, rows]) => rows.length > 0)
    .map(([sheetName, rows]) => [sheetName, filterRowsByDateRange(rows, from, to)]);

  const presetButtonsHtml = DASHBOARD_RANGE_PRESETS
    .map((preset) => {
      const isActive = from === preset.from() && to === "";
      return `<button type="button" class="dashboard-filter-bar__preset${isActive ? " is-active" : ""}" data-preset="${escapeHtml(
        preset.label
      )}">${escapeHtml(preset.label)}</button>`;
    })
    .join("");

  const filterBarHtml = `
    <div class="dashboard-filter-bar">
      <div class="dashboard-filter-bar__field">
        <label for="dashboard-date-from">From</label>
        <input type="date" id="dashboard-date-from" value="${escapeHtml(from)}" />
      </div>
      <div class="dashboard-filter-bar__field">
        <label for="dashboard-date-to">To</label>
        <input type="date" id="dashboard-date-to" value="${escapeHtml(to)}" />
      </div>
      <div class="dashboard-filter-bar__divider"></div>
      <div class="dashboard-filter-bar__presets">${presetButtonsHtml}</div>
      <button type="button" class="btn dashboard-filter-bar__clear" id="dashboard-date-clear">Clear filter</button>
    </div>
  `;

  if (raw.fund_nav.length === 0 && raw.xirr.length === 0 && extraEntries.length === 0) {
    mainEl.innerHTML =
      heading("Dashboard", "NAV growth and XIRR at a glance.") +
      `
      <div class="detail-panel">
        <div class="empty-state">
          No Dashboard data has been uploaded yet. Ask an admin to upload the Dashboard Excel file
          (with "Fund NAV", "XIRR", and "Client Master" sheets) from the Admin Portal.
        </div>
      </div>
    `;
    return;
  }

  const rangeActive = Boolean(from || to);
  const rangeEmptyMessage = "No data in the selected date range.";
  const navChart = renderNavGrowthChart(fundNavRows, rangeActive && raw.fund_nav.length ? rangeEmptyMessage : undefined);
  const xirrChart = renderXirrChart(xirrRows, rangeActive && raw.xirr.length ? rangeEmptyMessage : undefined);

  // Extra sheets split into chart cards (alongside NAV Growth/XIRR) and full-width
  // table sections, depending on what detectAutoChartKind found in each one.
  const extraCharts = [];
  const extraTables = [];
  extraEntries.forEach(([sheetName, rows]) => {
    if (rows.length === 0) return;
    const result = renderAutoChart(sheetName, rows);
    if (result.kind === "table") extraTables.push({ sheetName, rows });
    else extraCharts.push({ sheetName, ...result });
  });

  const extraTableSections = extraTables
    .map(({ sheetName, rows }) => {
      const columns = Object.keys(rows[0]).map((key) => ({ key, label: key }));
      const prefix = `dashboard-extra-table-${slugifyForId(sheetName)}`;
      // Narrow (client-table--summary) only for a small column count - a wide sheet
      // needs the horizontal-scroll layout instead.
      const narrow = columns.length <= 12;
      return `
        <h2 class="entity-card__title" style="margin: 1.5rem 0 0.75rem;">${escapeHtml(sheetName)}</h2>
        ${tableSectionHtml(prefix, columns, `Search ${sheetName.toLowerCase()}...`, narrow)}
      `;
    })
    .join("");

  const investorInsights = renderInvestorInsights(raw.client_master);

  mainEl.innerHTML =
    heading("Dashboard", "NAV growth and XIRR at a glance.") +
    filterBarHtml +
    (investorInsights ? `<h2 class="entity-card__title dashboard-section-title">Fund Overview</h2>` : "") +
    `
    <div class="dashboard-charts">
      <div class="dashboard-chart-card">
        <span class="dashboard-chart-card__title">NAV Growth</span>
        ${navChart.html}
      </div>
      <div class="dashboard-chart-card">
        <span class="dashboard-chart-card__title">XIRR</span>
        ${xirrChart.html}
      </div>
      ${extraCharts
        .map(
          (c) => `
        <div class="dashboard-chart-card">
          <span class="dashboard-chart-card__title">${escapeHtml(c.sheetName)}</span>
          ${c.html}
        </div>`
        )
        .join("")}
    </div>
    ` +
    (investorInsights
      ? `
    <h2 class="entity-card__title dashboard-section-title">Investor Snapshot</h2>
    ${investorInsights.statsHtml}
    <div class="dashboard-charts dashboard-charts--insights">
      ${investorInsights.cardsHtml}
    </div>
    `
      : "") +
    `${extraTableSections}
  `;

  const dateFromInput = document.getElementById("dashboard-date-from");
  const dateToInput = document.getElementById("dashboard-date-to");
  dateFromInput.addEventListener("change", () => {
    state.dashboardDateFrom = dateFromInput.value;
    renderDashboardView();
  });
  dateToInput.addEventListener("change", () => {
    state.dashboardDateTo = dateToInput.value;
    renderDashboardView();
  });
  document.getElementById("dashboard-date-clear").addEventListener("click", () => {
    state.dashboardDateFrom = "";
    state.dashboardDateTo = "";
    renderDashboardView();
  });

  document.querySelectorAll(".dashboard-filter-bar__preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = DASHBOARD_RANGE_PRESETS.find((p) => p.label === btn.dataset.preset);
      if (!preset) return;
      state.dashboardDateFrom = preset.from();
      state.dashboardDateTo = "";
      renderDashboardView();
    });
  });

  navChart.wire();
  xirrChart.wire();
  extraCharts.forEach((c) => c.wire());
  if (investorInsights) investorInsights.chartsToWire.forEach((wire) => wire());

  extraTables.forEach(({ sheetName, rows }) => {
    const columns = Object.keys(rows[0]).map((key) => ({ key, label: key }));
    const rowsWithId = rows.map((row, i) => ({ ...row, id: String(i) }));
    const prefix = `dashboard-extra-table-${slugifyForId(sheetName)}`;
    const openRow = (id) => openSoaRowDetail(sheetName, rows[Number(id)]);
    wirePaginatedTableSearch(prefix, columns, rowsWithId, openRow, `Dashboard - ${sheetName}.csv`, 40);
  });
}

// ---------------------------------------------------------------------------
// SOA tab: Transaction / Closing / XIRR
// ---------------------------------------------------------------------------

const SOA_LABELS = { transaction: "Transaction", closing: "Closing", xirr: "XIRR" };

const SOA_CARDS = [
  {
    slug: "transaction",
    label: "Transaction",
    description: "Investor In/Out ledger",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h13l-4-4"/><path d="M17 17H4l4 4"/></svg>`,
  },
  {
    slug: "closing",
    label: "Closing",
    description: "Closing balance as uploaded",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  },
  {
    slug: "xirr",
    label: "XIRR",
    description: "XIRR as uploaded",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20 20 4"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>`,
  },
];

// SOA's three sections are already leaf-level (no Income/Expense-style grouping above
// them like NAV's), so each is its own directly-clickable card rather than a hover
// trigger for a flyout of sub-categories.
function soaMenuHtml() {
  return `
    <p class="nav-menu__hint">Pick a section.</p>
    <div class="nav-menu">
      ${SOA_CARDS.map(
        (c) => `
        <button
          type="button"
          class="nav-menu__card nav-menu__card--${c.slug} nav-menu__card--clickable${c.slug === state.soaSubTab ? " is-active" : ""}"
          data-soa-category="${c.slug}"
        >
          <span class="nav-menu__icon">${c.icon}</span>
          <div class="nav-menu__card-text">
            <span class="nav-menu__label">${escapeHtml(c.label)}</span>
            <span class="nav-menu__count">${escapeHtml(c.description)}</span>
          </div>
        </button>
      `
      ).join("")}
    </div>
  `;
}

function wireSoaMenu(fund) {
  // No auto-load here - the picker (all three cards, none active) is all that shows
  // until the admin actually clicks one, same as NAV never opening a category on its own.
  document.querySelectorAll(".nav-menu__card--clickable[data-soa-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.soaSubTab === btn.dataset.soaCategory) return;
      state.soaSubTab = btn.dataset.soaCategory;
      document
        .querySelectorAll(".nav-menu__card--clickable[data-soa-category]")
        .forEach((b) => b.classList.toggle("is-active", b === btn));
      loadSoaCategoryView(fund);
    });
  });
}

async function loadSoaCategoryView(fund) {
  const category = state.soaSubTab;
  const label = SOA_LABELS[category];
  const view = document.getElementById("soa-category-view");
  view.innerHTML = `<div class="loading-state">Loading ${escapeHtml(label)}...</div>`;

  try {
    const [records, docMap] = await Promise.all([
      apiGet(`/funds/${fund.id}/soa/${category}`),
      apiGet(`/funds/${fund.id}/nav/${category}/validation-docs`).catch(() => ({ mappings: {} })),
    ]);

    if (records.length === 0) {
      view.innerHTML = `
        <div class="detail-panel">
          <h2 class="entity-card__title" style="margin-bottom: 0.4rem;">${escapeHtml(label)}</h2>
          <div class="empty-state">No ${escapeHtml(label)} data has been uploaded for this fund yet.</div>
        </div>
      `;
      return;
    }

    // Closing and XIRR both carry auditor status/errors (see parse_soa_closing/
    // parse_soa_xirr on the backend) - Transaction keeps plain rows, since its own
    // column-derivation logic (openTransactionDetail, buildTransactionSummary) enumerates
    // a row's own keys to build columns and would leak __status/__errors as fake ones.
    const allRows =
      category !== "transaction"
        ? records.map((r) => ({ ...r.data, __status: r.status, __errors: r.errors || [] }))
        : records.map((r) => r.data);
    const checklistHtml = validatedChecklistHtml(FIXED_VALIDATION_TYPES[category] || [], docMap.mappings || {});

    const filterKey = `soa:${category}`;
    const filter = getTableDateFilter(filterKey);
    const rows = filterRowsByDateRange(allRows, filter.from, filter.to);

    if (category === "transaction") {
      // The date filter sits inline in Transaction's own search toolbar row (via
      // tableSectionHtml's extraToolbarHtml), same as every other table's filter.
      renderTransactionSummary(view, fund, label, rows, checklistHtml, dateFilterInlineHtml(filterKey, allRows));
      wireDateFilterBar(filterKey, () => loadSoaCategoryView(fund));
      return;
    }

    // Closing and XIRR are shown as plain uploaded data - no grouping, no validation math -
    // but searchable, and each row is still clickable for its full details, same as
    // Client Master. Rows don't come with their own id, so the array index stands in for
    // one (only needed to satisfy renderTableRows/wireTableSearch's row-click wiring).
    // Columns come from allRows (not the date-filtered `rows`), which can legitimately be
    // empty if the selected range excludes everything - the table should still show its
    // headers and a "No matching records" empty state rather than lose its columns.
    // __-prefixed keys (__status/__errors, Closing/XIRR only) are metadata, not real columns.
    const columns = Object.keys(allRows[0])
      .filter((key) => !key.startsWith("__"))
      .map((key) =>
        /^soa$/i.test(key)
          ? { key, label: key, render: (value) => escapeHtml(formatPercentCell(value)) }
          : { key, label: key }
      );
    const rowsWithId = rows.map((row, i) => ({ ...row, id: String(i) }));
    const prefix = `soa-${category}`;

    // Closing/XIRR get a Status column (correct/incorrect dot) when the upload actually
    // carried auditor validation data - same "only show it if there's something real to
    // show" rule as the NAV Gain categories' trade-detail table.
    const hasValidation = rows.some((r) => r.__status === "correct" || r.__status === "incorrect");
    const displayColumns = hasValidation
      ? [...columns, { key: "__status", label: "Status", render: (value, record) => statusDotHtml(value, record.id) }]
      : columns;

    // Whenever a category actually has per-row Status, its "Validated From" checklist
    // moves into each row's detail modal (next to that row's Status box) instead of
    // sitting as its own section above the table - a category with no Status column at
    // all (nothing to click into) keeps the checklist up here instead.
    const showChecklistAboveTable = !hasValidation;

    // The date filter sits inline in tableSectionHtml's own toolbar row, next to the
    // search field, instead of a separate card above.
    view.innerHTML =
      `<h2 class="entity-card__title" style="margin-bottom: 0.75rem;">${escapeHtml(label)}</h2>` +
      (showChecklistAboveTable ? checklistHtml : "") +
      tableSectionHtml(
        prefix,
        displayColumns,
        `Search ${label.toLowerCase()}...`,
        true,
        false,
        dateFilterInlineHtml(filterKey, allRows),
        hasValidation ? statusFilterSelectHtml(prefix) : ""
      );
    wireDateFilterBar(filterKey, () => loadSoaCategoryView(fund));

    // Pass the original row (not rowsWithId) to the detail modal - the synthetic `id`
    // added above is only there to satisfy renderTableRows' data-row-id wiring and
    // shouldn't show up as a fake "id" field in the row detail. Closing also passes its
    // checklist through so the modal can show it beside the row's Status box.
    const openRow = (id) => openSoaRowDetail(label, rows[Number(id)], columns, showChecklistAboveTable ? "" : checklistHtml);
    wirePaginatedTableSearch(prefix, displayColumns, rowsWithId, openRow, `${fund.name} - ${label}.csv`, 40);
  } catch (err) {
    view.innerHTML = `<div class="error-state">${escapeHtml(err.message)}</div>`;
  }
}

// Columns for the Transaction summary: one row per investor (Client Code), aggregating
// every transaction's Amount(INR) - positive amounts (Purchase, Additional Purchase,
// Switch In) count as In, negative ones (Redemption, Switch Out, Income Payout) as Out.
// Clicking a row opens that investor's full transaction ledger (see openTransactionDetail).
const TRANSACTION_SUMMARY_COLUMNS = [
  { key: "investor_code", label: "Client Code" },
  { key: "investor_name", label: "Client Name" },
  { key: "total_in", label: "Total In", currency: true },
  { key: "total_out", label: "Total Out", currency: true },
  { key: "net_movement", label: "Net Movement", currency: true },
  { key: "movement_count", label: "Transactions", number: true },
];

function buildTransactionSummary(rows) {
  const byInvestor = new Map();

  rows.forEach((row) => {
    const investorCode = row["Client Code"] ?? "";
    if (!byInvestor.has(investorCode)) {
      byInvestor.set(investorCode, {
        id: investorCode,
        investor_code: investorCode,
        investor_name: row["Client Name"] ?? "",
        total_in: 0,
        total_out: 0,
        movement_count: 0,
      });
    }
    const entry = byInvestor.get(investorCode);
    const amount = Number(row["Amount(INR)"]) || 0;
    entry.movement_count += 1;
    if (amount >= 0) entry.total_in += amount;
    else entry.total_out += Math.abs(amount);
  });

  return Array.from(byInvestor.values()).map((entry) => ({
    ...entry,
    net_movement: entry.total_in - entry.total_out,
  }));
}

function renderTransactionSummary(view, fund, label, rows, checklistHtml, dateFilterHtml = "") {
  const summary = buildTransactionSummary(rows);
  const totalIn = summary.reduce((sum, s) => sum + s.total_in, 0);
  const totalOut = summary.reduce((sum, s) => sum + s.total_out, 0);
  const net = totalIn - totalOut;

  view.innerHTML =
    `
    <div class="stat-row">
      <div class="stat-chip stat-chip--in">
        <span class="stat-chip__label">Total In</span>
        <span class="stat-chip__value">${formatCurrency(totalIn)}</span>
      </div>
      <div class="stat-chip stat-chip--out">
        <span class="stat-chip__label">Total Out</span>
        <span class="stat-chip__value">${formatCurrency(totalOut)}</span>
      </div>
      <div class="stat-chip stat-chip--net">
        <span class="stat-chip__label">Net Movement</span>
        <span class="stat-chip__value">${formatCurrency(net)}</span>
      </div>
    </div>
    ` +
    checklistHtml +
    tableSectionHtml("soa-transaction", TRANSACTION_SUMMARY_COLUMNS, "Search client code or name...", true, false, dateFilterHtml);

  const openInvestor = (investorCode) => openTransactionDetail(investorCode, rows, checklistHtml);
  wirePaginatedTableSearch("soa-transaction", TRANSACTION_SUMMARY_COLUMNS, summary, openInvestor, `${fund.name} - Transaction.csv`, 40);
}

// Shows one investor's full transaction ledger (both In and Out rows together, unlike
// Corpus Movement - Transaction is a single upload with mixed rows, not two separate
// files) plus the fund's Validated From checklist for Transaction, if the admin has set one.
function openTransactionDetail(investorCode, allRows, checklistHtml) {
  // sortRowsByDate (actual Date parsing) rather than a plain string compare - Transaction
  // Date arrives as "DD-Mon-YYYY" (e.g. "01-Aug-2023"), which localeCompare sorts as text
  // (day-of-month first, then month name alphabetically) rather than chronologically.
  const records = sortRowsByDate(
    allRows.filter((r) => (r["Client Code"] ?? "") === investorCode),
    "Transaction Date"
  );
  if (records.length === 0) return;

  const totalIn = records
    .filter((r) => (Number(r["Amount(INR)"]) || 0) >= 0)
    .reduce((sum, r) => sum + (Number(r["Amount(INR)"]) || 0), 0);
  const totalOut = records
    .filter((r) => (Number(r["Amount(INR)"]) || 0) < 0)
    .reduce((sum, r) => sum + Math.abs(Number(r["Amount(INR)"]) || 0), 0);
  const net = totalIn - totalOut;

  const columns = Object.keys(records[0]).map((key) => ({ key, label: key }));

  modalPanel.classList.add("modal--wide");
  modalTitle.textContent = `${records[0]["Client Name"]} (${investorCode}) — Transactions`;
  modalBody.innerHTML = `
    <div class="stat-row">
      <div class="stat-chip stat-chip--in">
        <span class="stat-chip__label">Total In</span>
        <span class="stat-chip__value">${formatCurrency(totalIn)}</span>
      </div>
      <div class="stat-chip stat-chip--out">
        <span class="stat-chip__label">Total Out</span>
        <span class="stat-chip__value">${formatCurrency(totalOut)}</span>
      </div>
      <div class="stat-chip stat-chip--net">
        <span class="stat-chip__label">Net Movement</span>
        <span class="stat-chip__value">${formatCurrency(net)}</span>
      </div>
    </div>
    ${checklistHtml}
    ${staticTableHtml(columns, records)}
  `;
  modalBackdrop.classList.add("is-open");
}

// Shows a Closing/XIRR row's full details in the same field-grid layout as Client Master's
// openClientFile, since these rows don't have their own detail endpoint to fetch - the
// row object (already the upload's raw column -> value data) is all there is to show.
// `columns` (Closing only) lets the auditor Fund-vs-Auditor breakdown reuse the same
// rowStatusDetailHtml used by the NAV Gain categories, when the row carries a status.
function openSoaRowDetail(label, row, columns = [], checklistHtml = "") {
  const fieldsHtml = Object.entries(row)
    .filter(([key]) => !key.startsWith("__"))
    .map(
      ([key, value]) => `
        <div class="client-file__field">
          <span class="client-file__label">${escapeHtml(key)}</span>
          <span class="client-file__value">${
            /^soa$/i.test(key)
              ? escapeHtml(formatPercentCell(value))
              : escapeHtml(value === null || value === undefined || value === "" ? "-" : formatNumericDisplay(value) ?? stripMidnightTime(value))
          }</span>
        </div>`
    )
    .join("");

  const validationHtml = row.__status ? rowStatusDetailHtml(row, columns) : "";

  modalPanel.classList.remove("modal--wide");
  modalTitle.textContent = label;
  modalBody.innerHTML = `<div class="client-file__grid">${fieldsHtml}</div>${checklistHtml}${validationHtml}`;
  modalBackdrop.classList.add("is-open");
}

const NAV_GROUP_ICONS = {
  income: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16l6-6 4 4 8-8"/><path d="M15 6h6v6"/></svg>`,
  expense: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l6 6 4-4 8 8"/><path d="M15 18h6v-6"/></svg>`,
};

// Income/Expense categories are leaf-level on their own top-level tab (no more
// grouping card to hover first - see NAV_GROUPS), so each renders as a directly-
// clickable card, same pattern as soaMenuHtml/wireSoaMenu below.
function navGroupMenuHtml(group) {
  const activeSlug = state[`${group.key}SubTab`];
  return `
    <p class="nav-menu__hint">Pick a category.</p>
    <div class="nav-menu">
      ${group.categories
        .map(
          (c) => `
        <button
          type="button"
          class="nav-menu__card nav-menu__card--${group.key} nav-menu__card--clickable${c.slug === activeSlug ? " is-active" : ""}"
          data-category="${escapeHtml(c.slug)}"
          data-label="${escapeHtml(c.label)}"
        >
          <span class="nav-menu__icon">${NAV_GROUP_ICONS[group.key] || ""}</span>
          <div class="nav-menu__card-text">
            <span class="nav-menu__label">${escapeHtml(c.label)}</span>
          </div>
        </button>
      `
        )
        .join("")}
    </div>
  `;
}

function wireNavGroupMenu(fund, group) {
  document.querySelectorAll(".nav-menu__card--clickable[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stateKey = `${group.key}SubTab`;
      if (state[stateKey] === btn.dataset.category) return;
      state[stateKey] = btn.dataset.category;
      document
        .querySelectorAll(".nav-menu__card--clickable[data-category]")
        .forEach((b) => b.classList.toggle("is-active", b === btn));
      loadNavCategoryView(fund, btn.dataset.category, btn.dataset.label);
    });
  });
}

// NAV categories whose upload has an Instrument Type-shaped column (Bond/Equity/Mutual
// Fund/...) and a gain figure per row, so they get the grouped-by-type summary + donut
// instead of a flat table. Other Expense uses the same grouping (by Expense Type,
// summing Amount) so an admin can hover to see every expense type they've uploaded
// and click into one for its month-by-month figures and auditor validation.
const GAIN_SUMMARY_CATEGORIES = new Set(["realised-gain", "unrealised-gain", "corporate-action", "other-expense"]);

// Realised Gain / Unrealised Gain / Corporate Action get three admin-entered fields per
// Instrument Type (Trade Details / Validating Document / Test Procedure) instead of the
// single Validating Document string Other Expense uses - see openInstrumentTypeDetail/
// openTradesDetailPanel below. Kept in sync with DETAIL_FIELD_CATEGORIES in
// backend/main.py and admin.js, which is where these are actually edited.
const DETAIL_FIELD_GAIN_CATEGORIES = new Set(["realised-gain", "unrealised-gain", "corporate-action"]);
const VALIDATION_DETAIL_FIELDS = [
  { key: "trade_details", label: "Trade Details" },
  { key: "validating_document", label: "Validating Document" },
  { key: "test_procedure", label: "Test Procedure" },
];

// Instrument types excluded entirely from a category's Gain view - not just hidden with
// CSS, filtered out of the row set before the summary/donut/trade-detail are built at all,
// so their amounts don't sneak into the category's totals either. Matched case-
// insensitively against the detected Instrument Type column. Per JHS policy for this
// fund - not a general rule, so it's keyed by category rather than applied everywhere.
const EXCLUDED_GAIN_INSTRUMENT_TYPES = {
  "realised-gain": new Set(["slbm", "etf", "invit", "preference share", "reit", "derivative option"]),
  "unrealised-gain": new Set(["slbm"]),
};

// SLBM shows up spelled out ("Securities Lending & Borrowing...") rather than as the
// acronym on some sheets (Unrealised Gain does this, Realised Gain doesn't) - matched
// separately since "slbm" in the set above can't also be a fixed string for that.
const SLBM_PATTERN = /\bslbm\b|securities?\s*lending/i;

function isExcludedGainInstrumentType(category, rawType) {
  const excludedSet = EXCLUDED_GAIN_INSTRUMENT_TYPES[category];
  if (!excludedSet) return false;
  const type = String(rawType ?? "").trim();
  if (excludedSet.has(type.toLowerCase())) return true;
  return excludedSet.has("slbm") && SLBM_PATTERN.test(type);
}

// Display text for the grouping column, keyed by category - falls back to "Instrument
// Type" (the gain categories' term) when a category isn't listed here.
const GROUP_LABEL_BY_CATEGORY = { "other-expense": "Expense Type" };

// Composite key for a Management Fees validated-document row - it has no single Instrument/
// Expense Type column, so each row's validating document is looked up by Investor Code /
// Class Code / Fees % instead. Kept in sync with managementFeesDocKey() in
// frontend/js/admin.js (where the admin edits these).
function managementFeesDocKey(investorCode, classCode, feePercent) {
  return `${investorCode}||${classCode}||${feePercent}`;
}

async function loadNavCategoryView(fund, category, label) {
  // Active-state toggling on the picker card itself happens in wireNavGroupMenu's
  // click handler (same split as SOA's wireSoaMenu/loadSoaCategoryView) - this
  // function only needs to render the category's own data below the picker.
  const view = document.getElementById("nav-category-view");
  view.innerHTML = `<div class="loading-state">Loading ${escapeHtml(label)}...</div>`;

  try {
    const records = await apiGet(`/funds/${fund.id}/nav/${category}`);
    if (records.length === 0) {
      view.innerHTML = `
        <div class="detail-panel">
          <h2 class="entity-card__title" style="margin-bottom: 0.4rem;">${escapeHtml(label)}</h2>
          <div class="empty-state">No ${escapeHtml(label)} data has been uploaded for this fund yet.</div>
        </div>
      `;
      return;
    }

    const columns = Object.keys(records[0].data).map((key) => ({ key, label: key }));
    // Sorted ascending by date up front - the gain-summary/management-fees grouping
    // below just .push()es each row into its bucket in whatever order it sees them, so
    // pre-sorting here is enough to make every downstream table (the flat fallback below,
    // each instrument/expense type's trade detail, each investor's day-by-day fee rows)
    // come out date-ordered too, without sorting each of those separately.
    const rows = sortRowsByDate(records.map((r) => ({ ...r.data, __status: r.status, __errors: r.errors || [] })));

    // Realised Gain and Unrealised Gain get a pivot-style summary (one row per Instrument
    // Type) instead of the flat table, provided the uploaded file actually has a
    // recognizable Instrument Type column. Falls back to the generic table below if it
    // doesn't, so a differently-shaped upload still works.
    const instrumentTypeKey = GAIN_SUMMARY_CATEGORIES.has(category) ? detectInstrumentTypeKey(columns, rows) : null;
    if (instrumentTypeKey) {
      const gainRows = rows.filter((row) => !isExcludedGainInstrumentType(category, row[instrumentTypeKey]));

      // Admin-maintained "which document validates this type" list (frontend/js/admin.js
      // is where it's edited); missing/unreachable just means every type shows "Not specified".
      const docMap = await apiGet(`/funds/${fund.id}/nav/${category}/validation-docs`).catch(() => ({ mappings: {} }));
      renderGainSummary(view, fund, category, label, columns, gainRows, instrumentTypeKey, docMap.mappings || {});
      return;
    }

    if (category === "management-fees") {
      // Admin-maintained per-investor "which document validates this row" map (see
      // managementFeesDocKey / renderManagementFeesValidationDocEditor in admin.js).
      const docMap = await apiGet(`/funds/${fund.id}/nav/${category}/validation-docs`).catch(() => ({ mappings: {} }));
      renderManagementFeesSummary(view, fund, label, columns, rows, docMap.mappings || {});
      return;
    }

    if (category === "performance-fees") {
      // Admin-defined checklist (FIXED_VALIDATION_TYPES, starts empty) - same pattern as
      // Corpus In/Out and the SOA categories, since there's no per-row grouping value
      // (like Instrument Type) to hang a per-type document on here.
      const docMap = await apiGet(`/funds/${fund.id}/nav/${category}/validation-docs`).catch(() => ({ mappings: {} }));
      const checklistHtml = validatedChecklistHtml(FIXED_VALIDATION_TYPES[category] || [], docMap.mappings || {});
      renderPerformanceFeeTable(view, fund, label, columns, rows, checklistHtml);
      return;
    }

    view.innerHTML =
      `<h2 class="entity-card__title" style="margin-bottom: 0.75rem;">${escapeHtml(label)}</h2>` +
      tableSectionHtml("nav-flat", columns, `Search ${label.toLowerCase()}...`, true);
    wirePaginatedTableSearch("nav-flat", columns, rows, null, `${fund.name} - ${label}.csv`, 40);
  } catch (err) {
    view.innerHTML = `<div class="error-state">${escapeHtml(err.message)}</div>`;
  }
}

// Performance Fees' list view shows only Investor..Fee Trigger (the sheet's first ~9
// columns) plus a Status dot at the end - the remaining columns (Contribution Amount/
// Date, Updated HWM, Formula Check) only show once a row is clicked open, in the same
// full-field detail panel Closing/XIRR rows use (openSoaRowDetail), which is why `rows`
// keeps every original field regardless of what's visible in the list.
function renderPerformanceFeeTable(view, fund, label, columns, rows, checklistHtml) {
  const cutoffIdx = columns.findIndex((c) => /^fee\s*trigger$/i.test(c.label));
  const visibleColumns = cutoffIdx === -1 ? columns : columns.slice(0, cutoffIdx + 1);
  const hasValidation = rows.some((r) => r.__status === "correct" || r.__status === "incorrect");
  const displayColumns = hasValidation
    ? [...visibleColumns, { key: "__status", label: "Status", render: (value, record) => statusDotHtml(value, rows.indexOf(record)) }]
    : visibleColumns;

  // Same "checklist moves into the row detail once rows actually carry a Status" rule
  // Closing/XIRR use - see loadSoaCategoryView's showChecklistAboveTable.
  const showChecklistAboveTable = !hasValidation;

  view.innerHTML =
    `<h2 class="entity-card__title" style="margin-bottom: 0.75rem;">${escapeHtml(label)}</h2>` +
    (showChecklistAboveTable ? checklistHtml : "") +
    tableSectionHtml("perf-fees", displayColumns, `Search ${label.toLowerCase()}...`, true, false, "", hasValidation ? statusFilterSelectHtml("perf-fees") : "");

  const rowsWithId = rows.map((row, i) => ({ ...row, id: String(i) }));
  const openRow = (id) => openSoaRowDetail(label, rows[Number(id)], columns, showChecklistAboveTable ? "" : checklistHtml);
  wirePaginatedTableSearch("perf-fees", displayColumns, rowsWithId, openRow, `${fund.name} - ${label}.csv`, 40);
}

// Finds the data column whose label matches `pattern` (e.g. /symbol/i). Uploaded NAV
// files don't have a fixed schema, so column names are matched loosely rather than
// looked up by an exact expected key.
function findColumnKey(columns, pattern) {
  const match = columns.find((col) => pattern.test(col.label));
  return match ? match.key : null;
}

// Maps a Realised/Unrealised Gain row's Instrument Type to the supporting document an
// admin should have on file for it, per the fund's validation policy.
function navValidationDocFor(instrumentType) {
  const type = (instrumentType || "").toLowerCase();
  if (type.includes("equity") || type.includes("share") || type.includes("stock")) return "Contract Note / Trade Listing";
  if (type.includes("bond") || type.includes("debenture")) return "Deal Slip";
  if (type.includes("mutual") || type.includes(" mf") || type === "mf") return "SOA (Statement of A/c)";
  return null;
}

function looksLikeInstrumentType(value) {
  const v = String(value ?? "").toLowerCase();
  return /equity|share|stock|bond|debenture|mutual\s*fund|\bmf\b|commodity|securities?\s*lending|g-?sec|government\s*sec/.test(v);
}

// Locates the Instrument Type column. Tries the header name first (tolerating the common
// "Insrument Type" typo and other common spellings); if nothing matches, falls back to
// sniffing which column's *values* look like known instrument types (Equity, Bond, ...) -
// real-world exports use all sorts of header names, so this keeps the feature working
// without requiring an exact template.
function detectInstrumentTypeKey(columns, rows) {
  const headerMatch = findColumnKey(columns, /ins\s*t?rument\s*type|security\s*type|asset\s*type|expense\s*type|^type$/i);
  if (headerMatch) return headerMatch;

  let bestKey = null;
  let bestScore = 0;
  columns.forEach((col) => {
    const values = rows.map((row) => row[col.key]).filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
    if (values.length === 0) return;
    const score = values.filter(looksLikeInstrumentType).length / values.length;
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestKey = col.key;
    }
  });
  return bestKey;
}

function buildInstrumentTypeSummary(columns, rows, instrumentTypeKey) {
  // Categories with a real gain/loss figure (Realised/Unrealised Gain) sum that column.
  // Categories without one (Corporate Action - interest/dividend/revaluation events, no
  // gain concept) fall back to summing Amount instead, so the summary/donut still shows
  // a meaningful total per instrument type.
  const gainKey =
    findColumnKey(columns, /realised\s*gain|realized\s*gain|gain\s*amount|^gain$|profit/i) ||
    findColumnKey(columns, /^amount$/i);
  const gainLabel = columns.find((c) => c.key === gainKey)?.label ?? null;

  const byType = new Map();
  rows.forEach((row) => {
    const type = String(row[instrumentTypeKey] ?? "").trim() || "Uncategorized";
    if (!byType.has(type)) {
      byType.set(type, { type, trades: [], totalGain: 0, hasGain: false });
    }
    const entry = byType.get(type);
    entry.trades.push(row);
    if (gainKey) {
      const numeric = Number(String(row[gainKey] ?? "").replace(/[^0-9.-]/g, ""));
      if (!Number.isNaN(numeric) && String(row[gainKey] ?? "").trim() !== "") {
        entry.totalGain += numeric;
        entry.hasGain = true;
      }
    }
  });

  return { summary: Array.from(byType.values()), gainKey, gainLabel };
}

// Fixed-order categorical palette (never re-cycled per entity) used to color the
// Realised/Unrealised Gain donut. Assigned once per instrument type so a type keeps the
// same color whether it lands in the chart's gain slices or the losses list below it.
const CHART_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const CHART_OTHER_COLOR = "#6B7280";

function polarToCartesian(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function donutSegmentPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const p1 = polarToCartesian(cx, cy, rOuter, startAngle);
  const p2 = polarToCartesian(cx, cy, rOuter, endAngle);
  const p3 = polarToCartesian(cx, cy, rInner, endAngle);
  const p4 = polarToCartesian(cx, cy, rInner, startAngle);
  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${p4.x} ${p4.y}`,
    "Z",
  ].join(" ");
}

// Builds slices for a "gains only" donut: instrument types with a positive total
// gain, past a soft cap of 5 folded into a single "Other" slice so the chart never
// has to generate an unbounded number of hues.
function buildGainDonutSlices(summary) {
  const typeColor = new Map();
  summary.forEach((entry, i) => typeColor.set(entry.type, CHART_PALETTE[i % CHART_PALETTE.length]));

  const gains = summary
    .filter((e) => e.hasGain && e.totalGain > 0)
    .sort((a, b) => b.totalGain - a.totalGain)
    .map((e) => ({ type: e.type, value: e.totalGain, color: typeColor.get(e.type) }));

  const losses = summary
    .filter((e) => e.hasGain && e.totalGain < 0)
    .sort((a, b) => a.totalGain - b.totalGain)
    .map((e) => ({ type: e.type, value: e.totalGain, color: typeColor.get(e.type) }));

  const SOFT_CAP = 5;
  let slices = gains;
  if (gains.length > SOFT_CAP) {
    const kept = gains.slice(0, SOFT_CAP);
    const rest = gains.slice(SOFT_CAP);
    const otherTotal = rest.reduce((s, e) => s + e.value, 0);
    slices = [...kept, { type: `Other (${rest.length})`, value: otherTotal, color: CHART_OTHER_COLOR, isOther: true }];
  }

  return { slices, losses };
}

function renderGainDonut(slices, losses, donutTitle) {
  const total = slices.reduce((s, e) => s + e.value, 0);
  const size = 176;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter - 30;
  const gapDeg = slices.length > 1 ? 2.2 : 0;

  let angle = 0;
  const arcs = slices
    .map((slice) => {
      const sweep = total > 0 ? (slice.value / total) * 360 : 0;
      const start = angle + gapDeg / 2;
      let end = angle + sweep - gapDeg / 2;
      angle += sweep;
      if (end <= start) return null;
      if (end - start >= 360) end = start + 359.99; // avoid a degenerate full-circle arc
      const pct = total > 0 ? (slice.value / total) * 100 : 0;
      return { ...slice, d: donutSegmentPath(cx, cy, rOuter, rInner, start, end), pct };
    })
    .filter(Boolean);

  const svgPaths = arcs
    .map(
      (a) => `
      <path class="nav-donut__slice" d="${a.d}" fill="${a.color}"
        data-type="${escapeHtml(a.type)}" data-value="${a.value}" data-pct="${a.pct.toFixed(1)}"
        tabindex="0" role="img" aria-label="${escapeHtml(a.type)}: ${escapeHtml(NUMBER_FORMAT_2DP.format(a.value))} (${a.pct.toFixed(1)}%)"></path>`
    )
    .join("");

  const legendRows = arcs
    .map(
      (a) => `
      <li class="nav-donut__legend-row">
        <span class="nav-donut__legend-swatch" style="background:${a.color}"></span>
        <span class="nav-donut__legend-label"></span>
        <span class="nav-donut__legend-value"></span>
      </li>`
    )
    .join("");

  const lossRows = losses
    .map(
      () => `
      <li class="nav-donut__loss-row">
        <span class="nav-donut__legend-swatch nav-donut__legend-swatch--loss"></span>
        <span class="nav-donut__legend-label"></span>
        <span class="nav-donut__legend-value nav-donut__legend-value--loss"></span>
      </li>`
    )
    .join("");

  const html = arcs.length
    ? `
    <div class="nav-donut">
      <p class="nav-donut__title">${escapeHtml(donutTitle)}</p>
      <div class="nav-donut__body">
        <div class="nav-donut__chart-wrap">
          <svg class="nav-donut__svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="false">
            ${svgPaths}
          </svg>
          <div class="nav-donut__center">
            <span class="nav-donut__center-label">Total</span>
            <span class="nav-donut__center-value">${escapeHtml(NUMBER_FORMAT_2DP.format(total))}</span>
          </div>
          <div class="nav-donut__tooltip" id="nav-donut-tooltip" hidden></div>
        </div>
        <ul class="nav-donut__legend">${legendRows}</ul>
      </div>
      ${
        losses.length
          ? `<div class="nav-donut__losses">
              <p class="nav-donut__losses-title">Not shown above (loss-making)</p>
              <ul class="nav-donut__legend">${lossRows}</ul>
            </div>`
          : ""
      }
    </div>`
    : `
    <div class="nav-donut nav-donut--empty">
      <p class="nav-donut__title">${escapeHtml(donutTitle)}</p>
      <p class="empty-state">No instrument type has a positive gain to chart.</p>
    </div>`;

  return { html, arcs, losses };
}

function wireGainDonut(panel, arcs, losses) {
  if (!arcs.length) return;

  const legendLabels = panel.querySelectorAll(".nav-donut__legend-row .nav-donut__legend-label");
  const legendValues = panel.querySelectorAll(".nav-donut__legend-row .nav-donut__legend-value");
  arcs.forEach((a, i) => {
    legendLabels[i].textContent = a.type;
    legendValues[i].textContent = `${NUMBER_FORMAT_2DP.format(a.value)}  (${a.pct.toFixed(1)}%)`;
  });

  const lossLabels = panel.querySelectorAll(".nav-donut__loss-row .nav-donut__legend-label");
  const lossValues = panel.querySelectorAll(".nav-donut__loss-row .nav-donut__legend-value");
  losses.forEach((l, i) => {
    lossLabels[i].textContent = l.type;
    lossValues[i].textContent = NUMBER_FORMAT_2DP.format(l.value);
    panel.querySelectorAll(".nav-donut__loss-row .nav-donut__legend-swatch--loss")[i].style.background = l.color;
  });

  const tooltip = panel.querySelector("#nav-donut-tooltip");
  const chartWrap = panel.querySelector(".nav-donut__chart-wrap");

  const showTooltip = (evt, path) => {
    const type = path.dataset.type;
    const value = Number(path.dataset.value);
    const pct = path.dataset.pct;
    tooltip.innerHTML = "";
    const valueEl = document.createElement("div");
    valueEl.className = "nav-donut__tooltip-value";
    valueEl.textContent = `${NUMBER_FORMAT_2DP.format(value)}  (${pct}%)`;
    const labelEl = document.createElement("div");
    labelEl.className = "nav-donut__tooltip-label";
    labelEl.textContent = type;
    tooltip.appendChild(valueEl);
    tooltip.appendChild(labelEl);
    tooltip.hidden = false;

    const wrapRect = chartWrap.getBoundingClientRect();
    const x = (evt.clientX ?? wrapRect.left + wrapRect.width / 2) - wrapRect.left;
    const y = (evt.clientY ?? wrapRect.top) - wrapRect.top;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };

  panel.querySelectorAll(".nav-donut__slice").forEach((path) => {
    path.addEventListener("pointermove", (evt) => showTooltip(evt, path));
    path.addEventListener("pointerenter", (evt) => {
      path.classList.add("is-hovered");
      showTooltip(evt, path);
    });
    path.addEventListener("pointerleave", () => {
      path.classList.remove("is-hovered");
      tooltip.hidden = true;
    });
    path.addEventListener("focus", (evt) => {
      path.classList.add("is-hovered");
      showTooltip(evt, path);
    });
    path.addEventListener("blur", () => {
      path.classList.remove("is-hovered");
      tooltip.hidden = true;
    });
  });
}

function renderGainSummary(view, fund, category, label, columns, rows, instrumentTypeKey, docMappings, dateFilterHtml = "") {
  const groupLabel = GROUP_LABEL_BY_CATEGORY[category] || "Instrument Type";
  const { summary, gainKey, gainLabel } = buildInstrumentTypeSummary(columns, rows, instrumentTypeKey);
  const totalColumnLabel = gainLabel || label;

  const summaryRows = summary
    .map(
      (entry) => `
      <tr class="client-table__row" data-instrument-type="${escapeHtml(entry.type)}">
        <td>${escapeHtml(entry.type)}</td>
        <td>${entry.hasGain ? escapeHtml(NUMBER_FORMAT_2DP.format(entry.totalGain)) : "-"}</td>
      </tr>`
    )
    .join("");

  const { slices, losses } = buildGainDonutSlices(summary);
  const donut = renderGainDonut(slices, losses, `${totalColumnLabel} by ${groupLabel}`);

  view.innerHTML = `
    <div class="detail-panel__header">
      <h2 class="entity-card__title">${escapeHtml(label)}</h2>
      ${dateFilterHtml}
      <button type="button" class="btn" id="nav-download">${DOWNLOAD_ICON}Download CSV</button>
    </div>
    <p class="nav-menu__hint">Click a ${escapeHtml(groupLabel.toLowerCase())} to see its full details and validation.</p>
    <div class="table-scroll table-scroll--split">
      <div class="table-scroll--split__table">
        <table class="client-table client-table--compact">
          <thead>
            <tr>
              <th>${escapeHtml(groupLabel)}</th>
              <th>Total ${escapeHtml(totalColumnLabel)}${gainKey ? "" : " (n/a)"}</th>
            </tr>
          </thead>
          <tbody>${summaryRows || `<tr><td class="empty-state" colspan="2">No ${escapeHtml(groupLabel.toLowerCase())}s found.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="table-scroll--split__chart">${donut.html}</div>
    </div>
  `;

  document.getElementById("nav-download").addEventListener("click", () => downloadCsv(`${fund.name} - ${label}.csv`, columns, rows));

  view.querySelectorAll("tr[data-instrument-type]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const entry = summary.find((s) => s.type === tr.dataset.instrumentType);
      if (entry) openInstrumentTypeDetail(category, label, columns, entry, docMappings);
    });
  });

  wireGainDonut(view.querySelector(".table-scroll--split__chart"), donut.arcs, donut.losses);
}

// Renders the Status cell for a trade row: a small clickable dot - green when the
// auditor's recalculation matched, red when it didn't - or nothing when the row was
// never cross-checked against an auditor file. Clicking either dot shows the actual
// "Correct" / "Incorrect" verdict (and, if incorrect, which field(s) were off) in the
// side panel, keeping the table itself compact.
function statusDotHtml(status, rowIndex) {
  if (status === "correct")
    return `<button type="button" class="status-dot status-dot--correct" data-status-row="${rowIndex}" title="Correct" aria-label="Correct"></button>`;
  if (status === "incorrect")
    return `<button type="button" class="status-dot status-dot--incorrect" data-status-row="${rowIndex}" title="Incorrect" aria-label="Incorrect"></button>`;
  return "";
}

function rowStatusDetailHtml(trade, columns) {
  const idColumn = columns.find((c) => /instrument|scrip|isin|month/i.test(c.label));
  const rowLabel = idColumn ? trade[idColumn.key] : null;
  const suffix = rowLabel ? ` - ${escapeHtml(rowLabel)}` : "";

  if (trade.__status === "correct") {
    return `
      <div class="side-panel__validation side-panel__validation--correct">
        <span class="side-panel__validation-label">Status${suffix}</span>
        <span class="side-panel__validation-value side-panel__validation-value--correct">Correct</span>
        <p class="side-panel__validation-note">Matches the auditor's recalculation.</p>
      </div>
    `;
  }

  const rows = (trade.__errors || [])
    .map((e) => {
      const diffText = e.diff === null || e.diff === undefined ? "-" : NUMBER_FORMAT_2DP.format(e.diff);
      const diffClass = typeof e.diff === "number" && e.diff !== 0 ? " is-diff-negative" : "";
      // Same "SOA is a percent" rule as the XIRR table itself (formatPercentCell) -
      // this is the Fund-vs-Auditor breakdown for a row that failed validation, and SOA
      // is the only field name it's ever shown for that's actually a rate.
      const isSoaField = /^soa$/i.test(e.field);
      const originalText = isSoaField ? formatPercentCell(e.original) : formatNumericDisplay(e.original) ?? (e.original || "-");
      const auditorText = isSoaField ? formatPercentCell(e.auditor) : formatNumericDisplay(e.auditor) ?? (e.auditor || "-");
      return `
      <tr>
        <td>${escapeHtml(e.field)}</td>
        <td>${escapeHtml(originalText)}</td>
        <td>${escapeHtml(auditorText)}</td>
        <td class="${diffClass.trim()}">${escapeHtml(diffText)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="side-panel__validation side-panel__validation--errors">
      <span class="side-panel__validation-label">Status${suffix}</span>
      <span class="side-panel__validation-value side-panel__validation-value--incorrect">Incorrect</span>
      <div class="table-scroll">
        <table class="client-table client-table--compact validation-error-table">
          <thead><tr><th>Field</th><th>Fund Value</th><th>Auditor Value</th><th>Diff</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// Shared by openInstrumentTypeDetail and openManagementFeesGroupDetail: renders `trades`
// (a group's member rows) as a table in the side panel body, with a Status dot per row
// when any of them carry validation - clicking a dot drills into the field-level Fund vs
// Auditor breakdown via rowStatusDetailHtml. `sidebarExtraHtml` is the caller's own
// identifying-fields block (e.g. Instrument Type, or Investor/Class/Series Code) rendered
// above the shared validation-fields + row-errors area. `validationDoc` is either a plain
// string ("Validated From" - Other Expense, Management Fees) or a {trade_details,
// validating_document, test_procedure} object (Realised/Unrealised Gain, Corporate Action
// - see DETAIL_FIELD_GAIN_CATEGORIES), rendered as one row or three accordingly.
function openTradesDetailPanel(eyebrow, title, columns, trades, validationDoc, sidebarExtraHtml) {
  const hasValidation = trades.some((t) => t.__status === "correct" || t.__status === "incorrect");

  const detailColumns = hasValidation
    ? [...columns, { key: "__status", label: "Status", render: (value, record) => statusDotHtml(value, trades.indexOf(record)) }]
    : columns;

  const bodyHtml = staticTableHtml(detailColumns, trades, "No rows found.", true);

  const validationFieldsHtml =
    validationDoc && typeof validationDoc === "object"
      ? VALIDATION_DETAIL_FIELDS.map(
          (f) => `
    <div class="side-panel__validation">
      <span class="side-panel__validation-label">${escapeHtml(f.label)}</span>
      <span class="side-panel__validation-value">${escapeHtml(validationDoc[f.key] || "Not specified")}</span>
    </div>`
        ).join("")
      : `
    <div class="side-panel__validation">
      <span class="side-panel__validation-label">Validated From</span>
      <span class="side-panel__validation-value">${escapeHtml(validationDoc || "Not specified")}</span>
    </div>`;

  const sidebarHtml = `
    ${sidebarExtraHtml || ""}
    ${validationFieldsHtml}
    <div id="side-panel-row-errors"></div>
  `;

  openSidePanel(eyebrow, title, bodyHtml, sidebarHtml);

  if (!hasValidation) return;

  const errorsMount = document.getElementById("side-panel-row-errors");
  sidePanelBody.querySelectorAll("button[data-status-row]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const trade = trades[Number(btn.dataset.statusRow)];
      sidePanelBody.querySelectorAll("tr").forEach((tr) => tr.classList.remove("is-selected-error-row"));
      btn.closest("tr").classList.add("is-selected-error-row");
      errorsMount.innerHTML = rowStatusDetailHtml(trade, columns);
      errorsMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

function openInstrumentTypeDetail(category, label, columns, entry, docMappings) {
  const mapped = docMappings && docMappings[entry.type];

  // Realised Gain/Unrealised Gain/Corporate Action carry three admin-entered fields per
  // type (see DETAIL_FIELD_GAIN_CATEGORIES) rather than the single Validating Document
  // string every other Gain-shaped category (currently just Other Expense) uses.
  if (DETAIL_FIELD_GAIN_CATEGORIES.has(category)) {
    const detail = mapped && typeof mapped === "object" ? mapped : {};
    const validationDetail = {
      trade_details: detail.trade_details || "",
      // Same admin-wins-over-heuristic fallback as the plain-string categories below.
      validating_document: detail.validating_document || navValidationDocFor(entry.type) || "",
      test_procedure: detail.test_procedure || "",
    };
    openTradesDetailPanel(label, entry.type, columns, entry.trades, validationDetail);
    return;
  }

  // The admin-maintained list (set on the Admin Portal's upload page) wins when it has
  // an entry for this type; otherwise fall back to the built-in Equity/Bond/Mutual Fund
  // heuristic, which only ever matches income-side instrument types anyway.
  const validationDoc = (typeof mapped === "string" && mapped) || navValidationDocFor(entry.type);
  openTradesDetailPanel(label, entry.type, columns, entry.trades, validationDoc);
}

// Groups Management Fees rows by (Investor Code, Class Code, Series Code) - the fee
// percentage is fixed per that combination, so a pivot summary makes more sense than the
// flat one-row-per-day table (see renderManagementFeesSummary).
function buildManagementFeesSummary(rows) {
  const groups = new Map();
  for (const row of rows) {
    const investorCode = row["Investor Code"] ?? "";
    const classCode = row["Class Code"] ?? "";
    const seriesCode = row["Series Code"] ?? "";
    const key = `${investorCode}||${classCode}||${seriesCode}`;
    if (!groups.has(key)) {
      groups.set(key, {
        investorCode,
        classCode,
        seriesCode,
        feePercent: row["Fee%"] ?? "-",
        totalFeeAmount: 0,
        totalGstAmount: 0,
        totalFeeWithGst: 0,
        rows: [],
      });
    }
    const group = groups.get(key);
    group.totalFeeAmount += Number(row["Fee Amount"]) || 0;
    group.totalGstAmount += Number(row["GST Amount"]) || 0;
    group.totalFeeWithGst += Number(row["Fee with GST"]) || 0;
    group.rows.push(row);
  }
  for (const group of groups.values()) {
    // An investor is "incorrect" if any of its day rows failed auditor validation - that's
    // the thing an admin scanning this list actually wants to spot, not a per-row detail.
    group.hasIncorrect = group.rows.some((r) => r.__status === "incorrect");
    // Summary-row Status dot: red if any day failed, else green if at least one day was
    // actually checked, else blank (statusDotHtml already renders "" for null) - same as
    // a row that was never cross-checked against an auditor file anywhere else in the app.
    group.overallStatus = group.hasIncorrect ? "incorrect" : group.rows.some((r) => r.__status === "correct") ? "correct" : null;
  }
  return Array.from(groups.values()).sort(
    (a, b) => Number(a.investorCode) - Number(b.investorCode) || String(a.classCode).localeCompare(String(b.classCode))
  );
}

function managementFeesSummaryRowHtml(g, index) {
  return `
      <tr class="client-table__row${g.hasIncorrect ? " client-table__row--incorrect" : ""}" data-group-index="${index}">
        <td>${escapeHtml(g.investorCode)}</td>
        <td>${escapeHtml(g.classCode)}</td>
        <td>${escapeHtml(g.seriesCode)}</td>
        <td>${escapeHtml(g.feePercent)}</td>
        <td>${escapeHtml(NUMBER_FORMAT_2DP.format(g.totalFeeAmount))}</td>
        <td>${escapeHtml(NUMBER_FORMAT_2DP.format(g.totalGstAmount))}</td>
        <td>${escapeHtml(NUMBER_FORMAT_2DP.format(g.totalFeeWithGst))}</td>
        <td>${statusDotHtml(g.overallStatus, index)}</td>
      </tr>`;
}

function renderManagementFeesSummary(view, fund, label, columns, rows, mappings, dateFilterHtml = "") {
  const groups = buildManagementFeesSummary(rows);

  view.innerHTML = `
    <div class="detail-panel__header">
      <h2 class="entity-card__title">${escapeHtml(label)}</h2>
      <button type="button" class="btn" id="nav-download">${DOWNLOAD_ICON}Download CSV</button>
    </div>
    <p class="nav-menu__hint">Click an investor to see its day-by-day detail and validation.</p>
    <div class="table-toolbar">
      <div class="search-field">
        <input type="search" id="mgmt-fees-search" class="search-input" placeholder="Search investor, class, series..." aria-label="Search" />
      </div>
      ${dateFilterHtml}
      <div class="table-toolbar__right">
        <select id="mgmt-fees-status-filter" class="search-input status-filter-select" aria-label="Filter by validation status">
          <option value="all">All Status</option>
          <option value="correct">Correct only</option>
          <option value="incorrect">Incorrect only</option>
        </select>
        <span class="table-toolbar__count" id="mgmt-fees-count"></span>
      </div>
    </div>
    <div class="table-scroll">
      <table class="client-table client-table--summary">
        <thead>
          <tr>
            <th>Investor Code</th>
            <th>Class Code</th>
            <th>Series Code</th>
            <th>Fees %</th>
            <th>Fees Amount</th>
            <th>GST Amount</th>
            <th>Fee with GST</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="mgmt-fees-table-body"></tbody>
      </table>
    </div>
    <div class="table-pager" id="mgmt-fees-pager"></div>
  `;

  document.getElementById("nav-download").addEventListener("click", () => downloadCsv(`${fund.name} - ${label}.csv`, columns, rows));

  const searchInput = document.getElementById("mgmt-fees-search");
  const statusFilter = document.getElementById("mgmt-fees-status-filter");
  const countEl = document.getElementById("mgmt-fees-count");
  const tbody = document.getElementById("mgmt-fees-table-body");
  const pagerEl = document.getElementById("mgmt-fees-pager");
  const PAGE_SIZE = 40;
  let currentPage = 1;

  function renderFilteredRows() {
    const query = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;

    const filtered = groups.filter((g) => {
      if (status === "correct" && g.hasIncorrect) return false;
      if (status === "incorrect" && !g.hasIncorrect) return false;
      if (!query) return true;
      return [g.investorCode, g.classCode, g.seriesCode].some((v) => String(v).toLowerCase().includes(query));
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    countEl.textContent = `${filtered.length} of ${groups.length} investor${groups.length === 1 ? "" : "s"}${
      totalPages > 1 ? ` — page ${currentPage} of ${totalPages}` : ""
    }`;
    tbody.innerHTML =
      pageItems.map((g) => managementFeesSummaryRowHtml(g, groups.indexOf(g))).join("") ||
      `<tr><td class="empty-state" colspan="8">No matching ${escapeHtml(label)} rows found.</td></tr>`;

    tbody.querySelectorAll("tr[data-group-index]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const group = groups[Number(tr.dataset.groupIndex)];
        openManagementFeesGroupDetail(label, columns, group, mappings);
      });
    });

    renderPagerControls(pagerEl, currentPage, totalPages, (page) => {
      currentPage = page;
      renderFilteredRows();
    });
  }

  searchInput.addEventListener("input", () => {
    currentPage = 1;
    renderFilteredRows();
  });
  statusFilter.addEventListener("change", () => {
    currentPage = 1;
    renderFilteredRows();
  });
  renderFilteredRows();
}

function openManagementFeesGroupDetail(label, columns, group, mappings) {
  const validationDoc = mappings[managementFeesDocKey(group.investorCode, group.classCode, group.feePercent)] || null;

  const idField = (fieldLabel, value) => `
    <div class="side-panel__validation">
      <span class="side-panel__validation-label">${escapeHtml(fieldLabel)}</span>
      <span class="side-panel__validation-value">${escapeHtml(value ?? "-")}</span>
    </div>`;

  const sidebarExtraHtml =
    idField("Investor Code", group.investorCode) +
    idField("Class Code", group.classCode) +
    idField("Series Code", group.seriesCode) +
    idField("Fees %", group.feePercent);

  const title = `Investor ${group.investorCode} — ${group.classCode}`;
  openTradesDetailPanel(label, title, columns, group.rows, validationDoc, sidebarExtraHtml);
}

async function openClientFile(clientId) {
  modalPanel.classList.remove("modal--wide");
  modalBody.innerHTML = `<div class="loading-state">Loading client file...</div>`;
  modalTitle.textContent = "Client File";
  modalBackdrop.classList.add("is-open");

  try {
    const c = await apiGet(`/clients/${clientId}`);
    modalTitle.textContent = c.investor_name;
    const pillClass = c.status === "Individual" ? "status-pill--pending" : "status-pill--verified";

    const field = (label, value, figure) => `
        <div class="client-file__field">
          <span class="client-file__label">${escapeHtml(label)}</span>
          <span class="client-file__value${figure ? " client-file__value--figure" : ""}">${escapeHtml(value === null || value === undefined || value === "" ? "-" : stripMidnightTime(value))}</span>
        </div>`;

    modalBody.innerHTML = `
      <div class="client-file__grid">
        ${field("Client ID", c.client_code)}
        ${field("Class", c.client_class)}
        ${field("Scheme", c.scheme)}
        <div class="client-file__field">
          <span class="client-file__label">Status</span>
          <span class="status-pill ${pillClass}">${escapeHtml(c.status)}</span>
        </div>

        <hr class="client-file__divider" />
        <span class="client-file__section-title">Holder &amp; Nominee</span>
        ${field("DOB / Date of Incorporation", c.dob_or_incorporation_date)}
        ${field("Nominee 1 Name", c.nominee_1_name)}
        ${field("Joint Holder Name", c.joint_holder_name)}
        ${field("IM Signing Date", c.im_signing_date)}

        <hr class="client-file__divider" />
        <span class="client-file__section-title">Contact &amp; Address</span>
        ${field("Mobile No", c.mobile_no)}
        ${field("Email ID", c.email_id)}
        ${field("Address 1", c.address_1)}
        ${field("City", c.city)}
        ${field("Pin Code", c.pin_code)}
        ${field("Country", c.country)}

        <hr class="client-file__divider" />
        <span class="client-file__section-title">Bank Details</span>
        ${field("Bank Name", c.bank_name)}
        ${field("Bank Account No", maskBankAccount(c.bank_account_no))}
        ${field("Bank Account Type", c.bank_account_type)}
        ${field("Bank IFSC Code", c.bank_ifsc_code)}
        ${field("DP ID", c.dp_id)}

        <hr class="client-file__divider" />
        <span class="client-file__section-title">Commitment</span>
        ${field("Commitment Amount", formatCurrency(c.commitment_amount), true)}
        ${field("Top Up Amount", formatCurrency(c.top_up_amount), true)}
        ${field("Commitment Reduced", formatCurrency(c.commitment_reduced), true)}
        ${field("Total Commitment", formatCurrency(c.total_commitment), true)}
        ${field("Initial Contribution", formatCurrency(c.initial_contribution), true)}
        ${field("Management Fees", formatPercentCell(c.management_fees))}

        <hr class="client-file__divider" />
        <span class="client-file__section-title">Distributor &amp; Other</span>
        ${field("Distributor Name", c.distributor_name)}
        ${field("Distributor Code", c.distributor_code)}
        ${field("Side Letters", c.side_letters)}
        ${field("Remarks", c.remarks)}
      </div>
    `;
  } catch (err) {
    modalBody.innerHTML = `<div class="error-state">${escapeHtml(err.message)}</div>`;
  }
}

// Builds the "Validated From" checklist markup: `fixedTypes` (possibly empty, for the SOA
// categories) unioned with any extra types an admin has saved beyond that list via
// admin.js's "+ Add type", each paired with its mapped document name or "Not specified".
// Returns "" when there's nothing to show (no fixed types and nothing saved yet) so
// callers can skip the block entirely rather than render an empty card.
function validatedChecklistHtml(fixedTypes, mappings) {
  const types = [...fixedTypes, ...Object.keys(mappings).filter((t) => !fixedTypes.includes(t))];
  if (types.length === 0) return "";
  return `
    <div class="validated-checklist">
      ${types
        .map(
          (type) => `
        <div class="side-panel__validation">
          <span class="side-panel__validation-label">${escapeHtml(type)}</span>
          <span class="side-panel__validation-value">${escapeHtml(mappings[type] || "Not specified")}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

// Shows one investor's raw rows from just the Corpus In or Corpus Out file (whichever
// pill was clicked) - the two files have entirely different columns (Corpus In has no
// bank details, Corpus Out has no per-row date), so there's no combined ledger shape to
// show; each row's full original columns come from its `data` dict (see parse_corpus_in /
// parse_corpus_out in backend/file_import.py). Also shows the fund's fixed Validated From
// checklist for that direction, same document names an admin sets via the Admin Portal's
// "Validated Documents" editor.
async function openInvestorMovementDetail(fund, investorCode, allMovements, movementType) {
  const matches = allMovements.filter((m) => m.investor_code === investorCode && m.movement_type === movementType);
  if (matches.length === 0) return;

  const total = matches.reduce((sum, m) => sum + m.amount, 0);
  const columns = Object.keys(matches[0].data).map((key) => ({ key, label: key }));
  // Inject validation metadata into each row so the UI can render a Status column and
  // show field-level errors in the side panel (same pattern used by NAV/Closing flows).
  // Sorted here (not inherited from allMovements' own order) because the column actually
  // shown/relevant here is whatever date column lives inside each row's own `.data` (e.g.
  // Corpus In's "Date of Received") - that's often a different field than the top-level
  // `movement_date` allMovements was sorted by, which file_import.py derives from a fixed
  // alias list ("Date of Bank"/"Transaction Date"/...) that doesn't cover every sheet's
  // actual date header, so `movement_date` can be blank even when the row itself has a
  // perfectly good date.
  const rows = sortRowsByDate(matches.map((m) => ({ ...m.data, __status: m.status, __errors: m.errors || [] })));
  const category = movementType === "In" ? "corpus-in" : "corpus-out";

  modalPanel.classList.add("modal--wide");
  modalTitle.textContent = `${matches[0].investor_name} (${investorCode}) — Corpus ${movementType}`;
  modalBody.innerHTML = `<div class="loading-state">Loading...</div>`;
  modalBackdrop.classList.add("is-open");

  const docMap = await apiGet(`/funds/${fund.id}/nav/${category}/validation-docs`).catch(() => ({ mappings: {} }));
  const checklistHtml = validatedChecklistHtml(FIXED_VALIDATION_TYPES[category] || [], docMap.mappings || {});

  // Always show a Status column so users can spot rows that do have validation; the
  // cell will be empty when a row lacks __status. This makes it obvious where to click
  // when red/green dots are present.
  const detailColumns = [...columns, { key: "__status", label: "Status", render: (value, record) => statusDotHtml(value, rows.indexOf(record)) }];

  modalBody.innerHTML = `
    <div class="stat-row">
      <div class="stat-chip ${movementType === "In" ? "stat-chip--in" : "stat-chip--out"}">
        <span class="stat-chip__label">Total ${escapeHtml(movementType)}</span>
        <span class="stat-chip__value">${formatCurrency(total)}</span>
      </div>
    </div>
    ${checklistHtml}
    ${staticTableHtml(detailColumns, rows)}
  `;

  // Wire status-dot clicks if any status-dot buttons exist in the rendered table.
  const statusButtons = modalBody.querySelectorAll("button[data-status-row]");
  if (statusButtons.length > 0) {
    const sidebarHtml = `${checklistHtml}<div id="side-panel-row-errors"></div>`;
    statusButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const rowIdx = Number(btn.dataset.statusRow);
        const row = rows[rowIdx];
        // Open the side panel with the same table (so context is visible) and the
        // validated-from checklist + error pane in the sidebar.
        const bodyHtml = staticTableHtml(detailColumns, rows, "No rows found.", true);
        openSidePanel(movementType, modalTitle.textContent, bodyHtml, sidebarHtml);

        // Highlight the selected row in the side panel's table and show the field errors.
        const errorsMount = document.getElementById("side-panel-row-errors");
        sidePanelBody.querySelectorAll("tr").forEach((tr) => tr.classList.remove("is-selected-error-row"));
        btn.closest("tr")?.classList.add("is-selected-error-row");
        errorsMount.innerHTML = rowStatusDetailHtml(row, columns);
        errorsMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }
}

function closeModal() {
  modalBackdrop.classList.remove("is-open");
}

modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});

function openSidePanel(eyebrow, title, bodyHtml, sidebarHtml) {
  sidePanelEyebrow.textContent = eyebrow;
  sidePanelTitle.textContent = title;
  sidePanelBody.innerHTML = bodyHtml;
  sidePanelSidebar.innerHTML = sidebarHtml || "";
  sidePanelSidebar.style.flexBasis = "";
  sidePanelBackdrop.classList.add("is-open");
}

function closeSidePanel() {
  sidePanelBackdrop.classList.remove("is-open");
}

sidePanelClose.addEventListener("click", closeSidePanel);
sidePanelBackdrop.addEventListener("click", (event) => {
  if (event.target === sidePanelBackdrop) closeSidePanel();
});

// Lets the sidebar (Validated From / Row Errors) be dragged wider so a wide table
// like Row Errors doesn't need its own inner horizontal scrollbar.
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 760;

sidePanelResizer.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  sidePanelResizer.setPointerCapture(event.pointerId);
  sidePanelResizer.classList.add("is-dragging");

  const onPointerMove = (moveEvent) => {
    const panelRect = document.getElementById("side-panel").getBoundingClientRect();
    const widthFromRight = panelRect.right - moveEvent.clientX;
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, widthFromRight));
    sidePanelSidebar.style.flexBasis = `${clamped}px`;
  };

  const onPointerUp = () => {
    sidePanelResizer.classList.remove("is-dragging");
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  };

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeModal();
  closeSidePanel();
});

// ---------------------------------------------------------------------------
// Fund Scheme tab: Schemes (AIF) -> Categories (Cat I / II / III)
// ---------------------------------------------------------------------------

async function navigateToSchemeRoot() {
  state.scheme = null;
  state.category = null;
  renderTrail();
  setLoading("Loading schemes...");
  try {
    const schemes = await apiGet("/schemes");
    mainEl.innerHTML =
      backButtonHtml() +
      heading("Fund Scheme", "Select a scheme to view its regulatory categories.") +
      (schemes.length ? cardGridToolbarHtml("scheme", "Search schemes...") : "") +
      `<div class="card-grid" id="scheme-grid"></div>`;
    wireBackButton(() => goToTab("dashboard"));

    const grid = document.getElementById("scheme-grid");
    if (schemes.length === 0) {
      grid.innerHTML = `<div class="empty-state">No schemes have been recorded yet.</div>`;
      return;
    }

    const renderSchemes = (list) => {
      if (list.length === 0) {
        grid.innerHTML = `<div class="empty-state">No matching schemes found.</div>`;
        return;
      }
      grid.innerHTML = "";
      list.forEach((scheme) => {
        const card = document.createElement("button");
        card.className = "entity-card";
        card.innerHTML = `
          <span class="entity-card__eyebrow">Scheme</span>
          <span class="entity-card__title">${escapeHtml(scheme.name)}</span>
          <span class="entity-card__meta">${escapeHtml(scheme.full_name)}</span>
        `;
        card.addEventListener("click", () => navigateToSchemeCategories(scheme));
        grid.appendChild(card);
      });
    };

    wireCardGridSearch(
      "scheme",
      schemes,
      (scheme, query) => scheme.name.toLowerCase().includes(query) || scheme.full_name.toLowerCase().includes(query),
      renderSchemes
    );
  } catch (err) {
    setError(err.message);
  }
}

async function navigateToSchemeCategories(scheme) {
  state.scheme = scheme;
  state.category = null;
  renderTrail();
  setLoading("Loading categories...");
  try {
    const categories = await apiGet(`/schemes/${scheme.id}/categories`);
    mainEl.innerHTML =
      backButtonHtml() +
      heading(scheme.name, "Select a category to view its registered sub-schemes.") +
      `<div class="card-grid" id="category-grid"></div>`;

    wireBackButton(() => navigateToSchemeRoot());

    const grid = document.getElementById("category-grid");
    if (categories.length === 0) {
      grid.innerHTML = `<div class="empty-state">No categories are recorded under this scheme yet.</div>`;
      return;
    }

    categories.forEach((category) => {
      const card = document.createElement("button");
      card.className = "entity-card";
      card.innerHTML = `
        <span class="entity-card__eyebrow">Category</span>
        <span class="entity-card__title">${escapeHtml(category.name)}</span>
        <span class="entity-card__meta">View sub-schemes</span>
      `;
      card.addEventListener("click", () => navigateToCategoryDetail(category));
      grid.appendChild(card);
    });
  } catch (err) {
    setError(err.message);
  }
}

async function navigateToCategoryDetail(category) {
  state.category = category;
  renderTrail();
  setLoading("Loading category detail...");
  try {
    const detail = await apiGet(`/categories/${category.id}`);

    const rows = detail.sub_schemes
      .map(
        (s) => `
        <tr>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.sebi_reg_no)}</td>
          <td>${escapeHtml(s.launch_date)}</td>
          <td>${formatCurrency(s.aum_inr_cr * 10000000)}</td>
          <td>${escapeHtml(s.strategy)}</td>
        </tr>`
      )
      .join("");

    mainEl.innerHTML =
      backButtonHtml() +
      heading(detail.name, "Alternative Investment Fund category detail.") +
      `
      <div class="detail-panel">
        <p>${escapeHtml(detail.description)}</p>
      </div>
      <div class="detail-panel">
        <h2 class="entity-card__title" style="margin-bottom: 0.5rem;">Registered Sub-Schemes</h2>
        ${
          detail.sub_schemes.length === 0
            ? `<div class="empty-state">No sub-schemes are recorded under this category yet.</div>`
            : `
          <table class="sub-scheme-table">
            <thead>
              <tr>
                <th>Sub-Scheme</th>
                <th>SEBI Registration No.</th>
                <th>Launch Date</th>
                <th>AUM</th>
                <th>Strategy</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
        }
      </div>
      `;

    wireBackButton(() => navigateToSchemeCategories(state.scheme));
  } catch (err) {
    setError(err.message);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function render() {
  renderTrail();
  if (state.tab === "dashboard") {
    navigateToDashboard();
  } else if (state.tab === "fund-name") {
    navigateToFundRoot();
  } else {
    navigateToSchemeRoot();
  }
}

render();
