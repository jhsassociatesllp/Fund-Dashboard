/*
 * Fund Dashboard - Admin Portal logic.
 * Lets an admin create funds (companies) and upload the Client Master /
 * Corpus Movement file for each one, either replacing all existing rows or
 * adding to them. Uploads immediately reflect on the investor-facing portal,
 * since both read from the same API/database.
 */

const API_BASE = "/api";

const mainEl = document.getElementById("app-main");
const trailEl = document.getElementById("trail");

const state = {
  fund: null, // { id, name } when viewing a single fund's upload panel
};

// ---------------------------------------------------------------------------
// "Add Fund" modal - static markup in admin.html (outside #app-main, so it survives
// navigateToFundsRoot() re-rendering the page). Wired once here rather than per-render,
// since re-binding on every navigation would stack up duplicate submit handlers.
// ---------------------------------------------------------------------------

const addFundBackdrop = document.getElementById("add-fund-backdrop");
const addFundForm = document.getElementById("create-fund-form");
const addFundNameInput = document.getElementById("create-fund-name");

function openAddFundModal() {
  addFundForm.reset();
  addFundBackdrop.classList.add("is-open");
  addFundNameInput.focus();
}

function closeAddFundModal() {
  addFundBackdrop.classList.remove("is-open");
}

document.getElementById("add-fund-close").addEventListener("click", closeAddFundModal);
document.getElementById("cancel-add-fund").addEventListener("click", closeAddFundModal);
addFundBackdrop.addEventListener("click", (event) => {
  if (event.target === addFundBackdrop) closeAddFundModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && addFundBackdrop.classList.contains("is-open")) closeAddFundModal();
});

addFundForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = addFundNameInput.value.trim();
  if (!name) return;

  const submitBtn = addFundForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    const fund = await apiPostJson("/admin/funds", { name });
    closeAddFundModal();
    navigateToFundDetail(fund);
  } catch (err) {
    setError(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// "Validated Documents" modal - one shared popup (static markup in admin.html) reused
// for whichever category's button was clicked, rather than an inline per-card
// dropdown. A dropdown per card read as "everything opens at once" once there were
// several NAV categories on the page; a single modal makes it unambiguous which
// category's list is showing.
// ---------------------------------------------------------------------------

const validationDocBackdrop = document.getElementById("validation-doc-backdrop");
const validationDocTitle = document.getElementById("validation-doc-title");
const validationDocModalBody = document.getElementById("validation-doc-modal-body");
let openValidationDocCategory = null; // category slug currently shown in the modal, or null when closed

function closeValidationDocModal() {
  validationDocBackdrop.classList.remove("is-open");
  validationDocModalBody.innerHTML = "";
  openValidationDocCategory = null;
}

function openValidationDocModal(fund, category, label) {
  validationDocTitle.textContent = `${label} — Validated Documents`;
  validationDocBackdrop.classList.add("is-open");
  openValidationDocCategory = category;
  loadValidationDocEditor(fund, category, label);
}

// Called after an upload finishes - if the admin currently has this exact category's
// modal open, refresh it in place so a newly uploaded type shows up immediately.
function refreshValidationDocModalIfShowing(fund, category, label) {
  if (openValidationDocCategory === category) loadValidationDocEditor(fund, category, label);
}

document.getElementById("validation-doc-close").addEventListener("click", closeValidationDocModal);
validationDocBackdrop.addEventListener("click", (event) => {
  if (event.target === validationDocBackdrop) closeValidationDocModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && validationDocBackdrop.classList.contains("is-open")) closeValidationDocModal();
});

// NAV tab: Income / Expense categories shown to investors, mirrored here so an admin
// can upload each one's file. Keep the slugs/labels in sync with frontend/js/app.js.
const NAV_GROUPS = [
  {
    key: "income",
    label: "Income",
    categories: [
      {
        slug: "realised-gain",
        label: "Realised Gain",
        note: "Include a \"Symbol\" column (and ideally \"Instrument Type\": Equity / Bond / Debentures / Mutual Fund) so the Investor Portal can group trades by symbol and show the right validation document.",
      },
      {
        slug: "unrealised-gain",
        label: "Unrealised Gain",
        note: "Include a column identifying the Instrument Type (Equity / Bond / Debentures / Mutual Fund / ...) so the Investor Portal can group holdings by type and show the right validation document.",
      },
      {
        slug: "corporate-action",
        label: "Corporate Action",
        note: "Include a column identifying the Instrument Type (Equity / Bond / Debentures / Hybrid Fund / ...) so the Investor Portal can group actions by type and show the right validation document.",
      },
    ],
  },
  {
    key: "expense",
    label: "Expense",
    categories: [
      {
        slug: "other-expense",
        label: "Other Expense",
        note: "One row per expense type (Broking Fee, Operating Exp, GST, Stamp Duty, ...), with a repeating Exp by FA / Exp by Auditor / Diff column block per month. The expense types shown to investors come straight from this sheet's row labels.",
      },
      {
        slug: "performance-fees",
        label: "Performance Fees",
        note: "One row per investor per NAV date - Investor, NAV Date, Pre-fee NAV, Hurdle Rate, ..., Fee Trigger, plus Contribution Amount/Date, Updated HWM, and a Formula Check column (\"OK\"/otherwise) the Investor Portal derives each row's Status from directly - no separate auditor-recheck block needed.",
      },
      { slug: "management-fees", label: "Management Fees" },
    ],
  },
];

// SOA tab: Transaction (per-investor In/Out summary, drilling into that investor's full
// ledger), Closing and XIRR (shown as plain data - see the note in each). Kept in sync
// with the SOA-related code in frontend/js/app.js.
const SOA_CATEGORIES = [
  {
    slug: "transaction",
    label: "Transaction",
    note: "One row per transaction (Purchase, Redemption, Switch In/Out, ...). The Investor Portal splits In vs Out from the Amount column's sign, not the Description text, so it works even if the wording varies.",
  },
  { slug: "closing", label: "Closing", note: "Closing balance per investor as of the NAV date - shown as uploaded, no grouping or validation math." },
  { slug: "xirr", label: "XIRR", note: "XIRR per investor - shown as uploaded, no grouping or validation math." },
];

// Categories whose upload card also gets a "Validated Documents" editor: an
// admin-maintained list of which document validates each row-grouping value found in
// the upload (Instrument Type for Income categories, Expense Type for Other Expense).
// Kept in sync with GAIN_SUMMARY_CATEGORIES in frontend/js/app.js.
const VALIDATION_DOC_CATEGORIES = new Set([
  "realised-gain",
  "unrealised-gain",
  "corporate-action",
  "other-expense",
  "management-fees",
  "performance-fees",
  "corpus-in",
  "corpus-out",
  "transaction",
  "closing",
  "xirr",
]);

// Composite key for a Management Fees validated-document row, identifying it by Investor
// Code / Class Code / Fees % rather than a single Instrument/Expense Type column (which this
// category doesn't have). Kept in sync with managementFeesDocKey() in frontend/js/app.js.
function managementFeesDocKey(investorCode, classCode, feePercent) {
  return `${investorCode}||${classCode}||${feePercent}`;
}

// Realised Gain / Unrealised Gain / Corporate Action get three admin-entered fields per
// Instrument Type instead of the single Validating Document column every other category
// (Other Expense, Management Fees, Corpus In/Out, SOA) uses - see
// renderGainDetailFieldsEditor below. Kept in sync with DETAIL_FIELD_CATEGORIES in
// backend/main.py, which is what actually enforces the {trade_details,
// validating_document, test_procedure} shape server-side.
const DETAIL_FIELD_CATEGORIES = new Set(["realised-gain", "unrealised-gain", "corporate-action"]);
const VALIDATION_DETAIL_FIELDS = [
  { key: "trade_details", label: "Trade Details", placeholder: "e.g. Contract Note No." },
  { key: "validating_document", label: "Validating Document", placeholder: "e.g. Contract Note / Trade Listing" },
  { key: "test_procedure", label: "Test Procedure", placeholder: "e.g. Match qty/rate to broker note" },
];

// Categories whose validated-document checklist isn't derived from the uploaded data at all
// (unlike Instrument Type or Management Fees' Investor/Class/Fees%) - editable via
// renderFixedValidationDocEditor, which also lets an admin add extra types beyond
// whatever's listed here via "+ Add type". Corpus In/Out start with a fixed list set by
// fund policy; the SOA categories (Transaction/Closing/XIRR) start empty - the admin adds
// only the checks that actually apply, and nothing shows on the investor-facing side
// until they do. Kept in sync with FIXED_VALIDATION_TYPES in frontend/js/app.js.
const FIXED_VALIDATION_TYPES = {
  "corpus-in": ["Capital Amt received", "Class Allocation", "Unit Allocation"],
  "corpus-out": ["Redemption Request", "Class Allocation", "Exit load applicability", "Bank Details"],
  transaction: [],
  closing: [],
  xirr: [],
  "performance-fees": [],
};

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(res.status === 404 ? "Record not found." : "Unable to reach the server.");
  return res.json();
}

async function apiPostJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Request failed.");
  return data;
}

async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Delete failed.");
  }
}

async function apiUploadFile(path, file, mode = "replace") {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}${path}?mode=${encodeURIComponent(mode)}`, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Upload failed.");
  return data;
}

async function apiPutJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Request failed.");
  return data;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
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

function setLoading(message = "Loading...") {
  mainEl.innerHTML = `<div class="loading-state">${escapeHtml(message)}</div>`;
}

function setError(message) {
  mainEl.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
}

// ---------------------------------------------------------------------------
// Trail
// ---------------------------------------------------------------------------

function renderTrail() {
  const nodes = [{ label: "Admin", onClick: () => navigateToFundsRoot() }];
  if (state.fund) nodes.push({ label: state.fund.name, onClick: () => navigateToFundDetail(state.fund) });

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
// Funds root: create a fund, list existing funds
// ---------------------------------------------------------------------------

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></svg>`;

function fundCardHtml(fund) {
  return `
    <div class="entity-card fund-admin-card" data-fund-id="${escapeHtml(fund.id)}">
      <button type="button" class="fund-admin-card__delete" data-action="delete" aria-label="Delete ${escapeHtml(fund.name)}" title="Delete fund">
        ${TRASH_ICON}
      </button>
      <div class="fund-admin-card__body" data-action="open" role="button" tabindex="0">
        <span class="entity-card__eyebrow">Fund</span>
        <span class="entity-card__title">${escapeHtml(fund.name)}</span>
        <span class="entity-card__meta">Upload Client Master / Corpus Movement</span>
      </div>
    </div>
  `;
}

function fundCardConfirmHtml(fund) {
  return `
    <div class="fund-admin-card__confirm">
      <p>Delete <strong>${escapeHtml(fund.name)}</strong>? This permanently removes its Client Master, Corpus Movement, and NAV records. This can't be undone.</p>
      <div class="fund-admin-card__confirm-actions">
        <button type="button" class="btn" data-action="cancel-delete">Cancel</button>
        <button type="button" class="btn btn--danger" data-action="confirm-delete">Delete fund</button>
      </div>
    </div>
  `;
}

function renderFundGrid(funds) {
  const grid = document.getElementById("fund-grid");
  if (funds.length === 0) {
    grid.innerHTML = `<div class="empty-state">No funds found.</div>`;
    return;
  }

  grid.innerHTML = funds.map(fundCardHtml).join("");

  grid.querySelectorAll(".fund-admin-card").forEach((card) => {
    const fundId = card.dataset.fundId;
    const fund = funds.find((f) => f.id === fundId);

    const bodyEl = card.querySelector('[data-action="open"]');
    bodyEl.addEventListener("click", () => navigateToFundDetail(fund));
    bodyEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigateToFundDetail(fund);
      }
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", (event) => {
      event.stopPropagation();
      card.querySelector(".fund-admin-card__body").style.display = "none";
      card.insertAdjacentHTML("beforeend", fundCardConfirmHtml(fund));

      card.querySelector('[data-action="cancel-delete"]').addEventListener("click", (e) => {
        e.stopPropagation();
        card.querySelector(".fund-admin-card__confirm").remove();
        card.querySelector(".fund-admin-card__body").style.display = "";
      });

      card.querySelector('[data-action="confirm-delete"]').addEventListener("click", async (e) => {
        e.stopPropagation();
        const confirmBtn = e.currentTarget;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Deleting...";
        try {
          await apiDelete(`/admin/funds/${fundId}`);
          navigateToFundsRoot();
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = "Delete fund";
          setError(err.message);
        }
      });
    });
  });
}

const PLUS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`;

async function navigateToFundsRoot() {
  state.fund = null;
  renderTrail();
  setLoading("Loading funds...");

  try {
    const funds = await apiGet("/funds");

    mainEl.innerHTML =
      heading("Admin", "Upload the Dashboard file, then create or open a fund to upload its data.") +
      // Dashboard is the Investor Portal's landing page, not scoped to any one fund (unlike
      // every other upload here) - it lives on this root page rather than inside a fund.
      `<h2 class="upload-group__title">Dashboard</h2>
      <div class="upload-grid">
        ${uploadCardHtml(
          "dashboard",
          "Dashboard",
          "Loading current record count...",
          "One Excel file with three sheets named exactly \"Fund NAV\", \"XIRR\", and \"Client Master\" - each becomes a chart or table on the Investor Portal's Dashboard page (the first thing investors see when they open the app)."
        )}
      </div>
      <h2 class="upload-group__title">Funds</h2>
      <div class="table-toolbar">
        <div class="search-field">
          <input type="search" class="search-input" id="fund-search" placeholder="Search funds..." ${funds.length === 0 ? "disabled" : ""} />
        </div>
        <div class="table-toolbar__right">
          <span class="table-toolbar__count" id="fund-count"></span>
          <button type="button" class="btn btn--primary" id="add-fund-btn">${PLUS_ICON}Add Fund</button>
        </div>
      </div>
      <div class="card-grid" id="fund-grid"></div>
      `;

    wireUploadCard("dashboard", null, "/admin/dashboard/upload", "Dashboard", null, null, refreshDashboardUploadMeta);
    refreshDashboardUploadMeta();

    const countEl = document.getElementById("fund-count");
    const updateCount = (shown) => {
      countEl.textContent = `${shown} of ${funds.length} fund${funds.length === 1 ? "" : "s"}`;
    };

    if (funds.length === 0) {
      document.getElementById("fund-grid").innerHTML =
        `<div class="empty-state">No funds created yet. Click "+ Add Fund" above - it will then appear on the Investor Portal.</div>`;
      updateCount(0);
    } else {
      renderFundGrid(funds);
      updateCount(funds.length);

      document.getElementById("fund-search").addEventListener("input", (event) => {
        const term = event.target.value.trim().toLowerCase();
        const filtered = funds.filter((fund) => fund.name.toLowerCase().includes(term));
        renderFundGrid(filtered);
        updateCount(filtered.length);
      });
    }

    document.getElementById("add-fund-btn").addEventListener("click", openAddFundModal);
  } catch (err) {
    setError(err.message);
  }
}

// ---------------------------------------------------------------------------
// Fund detail: upload Client Master / Corpus Movement
// ---------------------------------------------------------------------------

const UPLOAD_ICONS = {
  "client-master": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3Z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6M9 9h2"/></svg>`,
  "corpus-in": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17v-3a2 2 0 0 1 2-2h3"/><path d="M8 9 5 12l3 3"/></svg>`,
  "corpus-out": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v3a2 2 0 0 1-2 2h-3"/><path d="M16 15l3-3-3-3"/></svg>`,
};
const NAV_UPLOAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5a1 1 0 0 1 1-1h10l5 5v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M9 12h6M9 16h6"/><path d="M14 4v4h4"/></svg>`;

const UPLOAD_CLOUD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17.3 8.1 4 4 0 0 1 17 16"/><path d="M12 12v7"/><path d="m9 15 3-3 3 3"/></svg>`;
const VALIDATION_DOC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z"/></svg>`;

function uploadCardHtml(id, title, description, note, showValidationDocs) {
  return `
    <div class="upload-card">
      <div class="upload-card__head">
        <span class="upload-card__icon">${UPLOAD_ICONS[id] || NAV_UPLOAD_ICON}</span>
        <div class="upload-card__heading">
          <span class="upload-card__title">${escapeHtml(title)}</span>
          <span class="upload-card__meta" id="${id}-meta">${escapeHtml(description)}</span>
        </div>
      </div>
      ${note ? `<p class="upload-card__hint upload-card__hint--note">${escapeHtml(note)}</p>` : ""}
      <label class="dropzone" for="${id}-file" id="${id}-dropzone">
        <input type="file" id="${id}-file" accept=".csv,.xlsx,.xls,.xlsm" />
        <span class="dropzone__icon">${UPLOAD_CLOUD_ICON}</span>
        <span class="dropzone__text" id="${id}-filename">Drag a file here, or click to browse</span>
        <span class="dropzone__hint">CSV or Excel (.csv, .xlsx, .xls, .xlsm)</span>
      </label>
      <div class="upload-card__actions">
        <button type="button" class="btn btn--primary upload-card__submit" id="${id}-submit-replace">Upload &amp; Replace</button>
        <button type="button" class="btn upload-card__submit" id="${id}-submit-append">Upload &amp; Add</button>
      </div>
      <p class="upload-card__hint">"Replace" wipes existing rows for this file first. "Add" keeps existing rows and adds the new file's rows on top.</p>
      <div id="${id}-status"></div>
      ${
        showValidationDocs
          ? `<button type="button" class="btn validation-doc-open-btn" id="${id}-validation-docs-btn">${VALIDATION_DOC_ICON}Validated Documents</button>`
          : ""
      }
    </div>
  `;
}

// --- Validated Documents editor -------------------------------------------------
// Lets an admin say which supporting document validates each Instrument Type /
// Expense Type found in a category's uploaded rows. The type values themselves come
// straight from the latest upload (nothing hardcoded), so a type nobody has mapped
// yet just shows up tagged "New" with a blank input instead of being silently
// dropped or requiring a code change.

function findColumnKey(columns, pattern) {
  const match = columns.find((col) => pattern.test(col.label));
  return match ? match.key : null;
}

function looksLikeInstrumentType(value) {
  const v = String(value ?? "").toLowerCase();
  return /equity|share|stock|bond|debenture|mutual\s*fund|\bmf\b|commodity|securities?\s*lending|g-?sec|government\s*sec/.test(v);
}

// Mirrors detectInstrumentTypeKey() in frontend/js/app.js: try the header name first,
// then fall back to sniffing which column's values look like known instrument types.
function detectGroupKey(columns, rows) {
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

// Renders into the shared modal body (#validation-doc-modal-body) - there's only ever
// one of these open at a time, so a single target element is enough.
async function loadValidationDocEditor(fund, category, label) {
  const container = validationDocModalBody;
  container.innerHTML = `<p class="upload-card__hint">Loading validated types...</p>`;

  try {
    const docMap = await apiGet(`/funds/${fund.id}/nav/${category}/validation-docs`);
    const mappings = docMap.mappings || {};

    // Corpus In/Out and the SOA categories' checklists aren't detected from an upload - they
    // work even before any file has been uploaded, so they skip the "records" fetch below.
    if (FIXED_VALIDATION_TYPES[category]) {
      renderFixedValidationDocEditor(container, fund, category, label, mappings);
      return;
    }

    const records = await apiGet(`/funds/${fund.id}/nav/${category}`);
    if (records.length === 0) {
      container.innerHTML = `<p class="upload-card__hint">Upload a file above to see its types here.</p>`;
      return;
    }

    const columns = Object.keys(records[0].data).map((key) => ({ key, label: key }));
    const rows = records.map((r) => r.data);

    if (category === "management-fees") {
      renderManagementFeesValidationDocEditor(container, fund, category, label, rows, mappings);
      return;
    }

    const groupKey = detectGroupKey(columns, rows);
    if (!groupKey) {
      container.innerHTML = `<p class="upload-card__hint">Couldn't detect an Instrument Type / Expense Type column in this upload.</p>`;
      return;
    }
    const types = Array.from(new Set(rows.map((r) => String(r[groupKey] ?? "").trim()).filter(Boolean))).sort();

    if (DETAIL_FIELD_CATEGORIES.has(category)) {
      renderGainDetailFieldsEditor(container, fund, category, label, types, mappings);
      return;
    }

    container.innerHTML = `
      <p class="upload-card__hint validation-doc-editor__hint">Which document validates each type below. Edit anytime; a type not yet mapped shows as "New".</p>
      <div class="validation-doc-list">
        <div class="validation-doc-row validation-doc-row--head">
          <span>Type</span>
          <span>Validating Document</span>
        </div>
        ${types
          .map(
            (t) => `
          <div class="validation-doc-row">
            <span class="validation-doc-row__type" title="${escapeHtml(t)}">
              <span class="validation-doc-row__type-name">${escapeHtml(t)}</span>
              ${mappings[t] ? "" : '<span class="badge-new">New</span>'}
            </span>
            <input type="text" class="validation-doc-input" data-type="${escapeHtml(t)}" value="${escapeHtml(mappings[t] || "")}" placeholder="e.g. Contract Note" />
          </div>`
          )
          .join("")}
      </div>
      <div class="validation-doc-editor__actions">
        <button type="button" class="btn btn--primary" id="validation-doc-save">Save Validated Documents</button>
        <span class="validation-doc-editor__status" id="validation-doc-status"></span>
      </div>
    `;

    wireValidationDocSave(container, fund, category, label);
  } catch (err) {
    container.innerHTML = `<div class="error-state">${escapeHtml(err.message)}</div>`;
  }
}

// Realised Gain / Unrealised Gain / Corporate Action: three admin-entered fields per
// Instrument Type (Trade Details / Validating Document / Test Procedure) instead of the
// single Validating Document column the other categories use. A pre-existing entry saved
// before this feature existed is a plain string (the old single field) - _sanitize_mappings
// on the backend already migrates that into {validating_document: <old value>, ...} before
// it ever reaches here, but fieldValue falls back the same way just in case.
function renderGainDetailFieldsEditor(container, fund, category, label, types, mappings) {
  const fieldValue = (type, fieldKey) => {
    const entry = mappings[type];
    if (entry && typeof entry === "object") return entry[fieldKey] || "";
    return fieldKey === "validating_document" ? entry || "" : "";
  };
  const isNew = (type) => VALIDATION_DETAIL_FIELDS.every((f) => !fieldValue(type, f.key));

  container.innerHTML = `
    <p class="upload-card__hint validation-doc-editor__hint">Trade Details, Validating Document, and Test Procedure for each type below. Edit anytime; a type with nothing filled in shows as "New".</p>
    <div class="validation-doc-list">
      <div class="validation-doc-row validation-doc-row--gain-detail validation-doc-row--head">
        <span>Type</span>
        ${VALIDATION_DETAIL_FIELDS.map((f) => `<span>${escapeHtml(f.label)}</span>`).join("")}
      </div>
      ${types
        .map(
          (t) => `
        <div class="validation-doc-row validation-doc-row--gain-detail">
          <span class="validation-doc-row__type" title="${escapeHtml(t)}">
            <span class="validation-doc-row__type-name">${escapeHtml(t)}</span>
            ${isNew(t) ? '<span class="badge-new">New</span>' : ""}
          </span>
          ${VALIDATION_DETAIL_FIELDS.map(
            (f) =>
              `<textarea class="validation-doc-input validation-doc-input--multiline" data-type="${escapeHtml(t)}" data-field="${f.key}" placeholder="${escapeHtml(f.placeholder)}\n(one point per line - each becomes its own bullet)" rows="1">${escapeHtml(fieldValue(t, f.key))}</textarea>`
          ).join("")}
        </div>`
        )
        .join("")}
    </div>
    <div class="validation-doc-editor__actions">
      <button type="button" class="btn btn--primary" id="validation-doc-save">Save Validated Documents</button>
      <span class="validation-doc-editor__status" id="validation-doc-status"></span>
    </div>
  `;

  wireValidationDocSave(container, fund, category, label);
}

// Shared by the generic Type-column editor above, renderGainDetailFieldsEditor, and
// renderManagementFeesValidationDocEditor below: collects every .validation-doc-input and
// saves it. An input with data-field set (renderGainDetailFieldsEditor's three-fields-per-
// type layout) is grouped into a {field: value} object per data-type; one without it (every
// other editor here) saves as a single plain string, same as always.
function wireValidationDocSave(container, fund, category, label) {
  document.getElementById("validation-doc-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("validation-doc-status");
    const updates = {};
    container.querySelectorAll(".validation-doc-input").forEach((input) => {
      const type = input.dataset.type;
      if (input.dataset.field) {
        if (!updates[type] || typeof updates[type] !== "object") updates[type] = {};
        updates[type][input.dataset.field] = input.value.trim();
      } else {
        updates[type] = input.value.trim();
      }
    });

    statusEl.textContent = "Saving...";
    try {
      await apiPutJson(`/admin/funds/${fund.id}/nav/${category}/validation-docs`, { mappings: updates });
      statusEl.textContent = "Saved.";
      // Brief pause so "Saved." is actually visible before the refetch replaces this element.
      setTimeout(() => loadValidationDocEditor(fund, category, label), 900);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  });
}

// The category's base checklist types come from FIXED_VALIDATION_TYPES (possibly empty,
// for the SOA categories), plus whatever extra types an admin has already saved via
// "+ Add type" - those persist as ordinary extra keys in the same mappings dict, so
// they're recovered here by unioning the base list with any saved keys not already in it
// (base types first, extras after).
function renderFixedValidationDocEditor(container, fund, category, label, mappings) {
  const fixedTypes = FIXED_VALIDATION_TYPES[category] || [];
  const extraTypes = Object.keys(mappings).filter((t) => !fixedTypes.includes(t));
  const types = [...fixedTypes, ...extraTypes];

  const rowHtml = (t) => `
    <div class="validation-doc-row" data-fixed-row>
      <span class="validation-doc-row__type" title="${escapeHtml(t)}">
        <span class="validation-doc-row__type-name">${escapeHtml(t)}</span>
        ${mappings[t] ? "" : '<span class="badge-new">New</span>'}
      </span>
      <input type="text" class="validation-doc-input" data-type="${escapeHtml(t)}" value="${escapeHtml(mappings[t] || "")}" placeholder="e.g. Redemption Request Letter" />
    </div>`;

  container.innerHTML = `
    <p class="upload-card__hint validation-doc-editor__hint">Which document validates each item below. Edit anytime, or add an extra type if this fund checks something else too.</p>
    <div class="validation-doc-list" id="validation-doc-fixed-list">
      <div class="validation-doc-row validation-doc-row--head">
        <span>Type</span>
        <span>Validating Document</span>
      </div>
      ${types.map(rowHtml).join("")}
    </div>
    <button type="button" class="btn validation-doc-add-btn" id="validation-doc-add-type">+ Add type</button>
    <div class="validation-doc-editor__actions">
      <button type="button" class="btn btn--primary" id="validation-doc-save">Save Validated Documents</button>
      <span class="validation-doc-editor__status" id="validation-doc-status"></span>
    </div>
  `;

  document.getElementById("validation-doc-add-type").addEventListener("click", () => {
    const list = document.getElementById("validation-doc-fixed-list");
    const row = document.createElement("div");
    row.className = "validation-doc-row validation-doc-row--new";
    row.innerHTML = `
      <input type="text" class="validation-doc-input validation-doc-type-input" placeholder="Type name" />
      <input type="text" class="validation-doc-input validation-doc-value-input" placeholder="e.g. Contract Note" />
    `;
    list.appendChild(row);
    row.querySelector(".validation-doc-type-input").focus();
  });

  document.getElementById("validation-doc-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("validation-doc-status");
    const updates = {};

    container.querySelectorAll(".validation-doc-row[data-fixed-row] .validation-doc-input").forEach((input) => {
      updates[input.dataset.type] = input.value.trim();
    });
    container.querySelectorAll(".validation-doc-row--new").forEach((row) => {
      const typeName = row.querySelector(".validation-doc-type-input").value.trim();
      if (typeName) updates[typeName] = row.querySelector(".validation-doc-value-input").value.trim();
    });

    statusEl.textContent = "Saving...";
    try {
      await apiPutJson(`/admin/funds/${fund.id}/nav/${category}/validation-docs`, { mappings: updates });
      statusEl.textContent = "Saved.";
      setTimeout(() => loadValidationDocEditor(fund, category, label), 900);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  });
}

// Management Fees has no single Instrument/Expense Type column to group by, so its editor
// identifies each row by three columns - Investor Code, Class Code, Fees % - instead of one.
function renderManagementFeesValidationDocEditor(container, fund, category, label, rows, mappings) {
  const seen = new Set();
  const identities = [];
  for (const row of rows) {
    const investorCode = row["Investor Code"] ?? "";
    const classCode = row["Class Code"] ?? "";
    const feePercent = row["Fee%"] ?? "";
    const key = managementFeesDocKey(investorCode, classCode, feePercent);
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push({ key, investorCode, classCode, feePercent });
  }
  identities.sort(
    (a, b) => Number(a.investorCode) - Number(b.investorCode) || String(a.classCode).localeCompare(String(b.classCode))
  );

  container.innerHTML = `
    <p class="upload-card__hint validation-doc-editor__hint">Which document validates each investor's fee row below. Edit anytime; a row not yet mapped shows as "New".</p>
    <div class="validation-doc-list">
      <div class="validation-doc-row validation-doc-row--head validation-doc-row--management-fees">
        <span>Investor Code</span>
        <span>Class Code</span>
        <span>Fees %</span>
        <span>Validating Document</span>
      </div>
      ${identities
        .map(
          (g) => `
        <div class="validation-doc-row validation-doc-row--management-fees">
          <span class="validation-doc-row__type">${escapeHtml(g.investorCode)}</span>
          <span class="validation-doc-row__type">${escapeHtml(g.classCode)}</span>
          <span class="validation-doc-row__type">
            ${escapeHtml(g.feePercent)}
            ${mappings[g.key] ? "" : '<span class="badge-new">New</span>'}
          </span>
          <textarea class="validation-doc-input validation-doc-input--multiline" data-type="${escapeHtml(g.key)}" placeholder="e.g. Fee Schedule
(one point per line - each becomes its own bullet)" rows="1">${escapeHtml(mappings[g.key] || "")}</textarea>
        </div>`
        )
        .join("")}
    </div>
    <div class="validation-doc-editor__actions">
      <button type="button" class="btn btn--primary" id="validation-doc-save">Save Validated Documents</button>
      <span class="validation-doc-editor__status" id="validation-doc-status"></span>
    </div>
  `;

  wireValidationDocSave(container, fund, category, label);
}

function wireValidationDocButton(id, fund, category, label) {
  const btn = document.getElementById(`${id}-validation-docs-btn`);
  if (!btn) return;
  btn.addEventListener("click", () => openValidationDocModal(fund, category, label));
}

function renderUploadStatus(id, html, kind) {
  document.getElementById(`${id}-status`).innerHTML = `<div class="upload-status upload-status--${kind}">${html}</div>`;
}

// `metaRefreshFn(fund)`, if given, replaces the built-in path+filter record-count lookup
// entirely - for cards like Dashboard whose GET endpoint returns an object of several
// sheets' rows rather than one flat array, so a plain length count doesn't apply.
function wireUploadCard(id, fund, uploadPath, recordType, metaFetchPath, metaFilterFn, metaRefreshFn) {
  const fileInput = document.getElementById(`${id}-file`);
  const replaceBtn = document.getElementById(`${id}-submit-replace`);
  const appendBtn = document.getElementById(`${id}-submit-append`);
  const dropzone = document.getElementById(`${id}-dropzone`);
  const filenameEl = document.getElementById(`${id}-filename`);

  const showChosenFile = () => {
    const file = fileInput.files[0];
    filenameEl.textContent = file ? file.name : "Drag a file here, or click to browse";
    dropzone.classList.toggle("dropzone--has-file", Boolean(file));
  };

  fileInput.addEventListener("change", showChosenFile);

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dropzone--active");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dropzone--active");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      showChosenFile();
    }
  });

  const handleUpload = async (mode) => {
    const file = fileInput.files[0];
    if (!file) {
      renderUploadStatus(id, "Choose a CSV or Excel file first.", "error");
      return;
    }

    replaceBtn.disabled = true;
    appendBtn.disabled = true;
    renderUploadStatus(id, `Uploading ${escapeHtml(file.name)}...`, "pending");

    try {
      const result = await apiUploadFile(uploadPath, file, mode);
      const warningsHtml = result.warnings && result.warnings.length
        ? `<ul>${result.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
        : "";
      // fund is null for fund-agnostic uploads (currently just Dashboard) - drop the
      // "for {fund name}" suffix rather than crash on fund.name.
      const forFundSuffix = fund ? ` for ${escapeHtml(fund.name)}` : "";
      const summary = mode === "append"
        ? `Added ${result.rows_imported} row${result.rows_imported === 1 ? "" : "s"} to the existing ${escapeHtml(recordType)} data${forFundSuffix}.`
        : `Imported ${result.rows_imported} row${result.rows_imported === 1 ? "" : "s"}, replacing all previous ${escapeHtml(recordType)} data${forFundSuffix}.`;
      renderUploadStatus(id, `${summary}${warningsHtml}`, "success");
      if (metaRefreshFn) metaRefreshFn(fund);
      else refreshUploadMeta(id, metaFetchPath, metaFilterFn);
      if (VALIDATION_DOC_CATEGORIES.has(id)) refreshValidationDocModalIfShowing(fund, id, recordType);
    } catch (err) {
      renderUploadStatus(id, escapeHtml(err.message), "error");
    } finally {
      replaceBtn.disabled = false;
      appendBtn.disabled = false;
      fileInput.value = "";
      showChosenFile();
    }
  };

  replaceBtn.addEventListener("click", () => handleUpload("replace"));
  appendBtn.addEventListener("click", () => handleUpload("append"));
}

async function refreshUploadMeta(id, fetchPath, filterFn) {
  const metaEl = document.getElementById(`${id}-meta`);
  if (!metaEl) return;
  try {
    const records = await apiGet(fetchPath);
    const count = filterFn ? records.filter(filterFn).length : records.length;
    metaEl.textContent = `${count} record${count === 1 ? "" : "s"} currently on file`;
  } catch {
    metaEl.textContent = "Unable to load current record count.";
  }
}

// Dashboard's GET returns {fund_nav, xirr, client_master} rather than one flat array, so
// its record count needs its own summary text instead of refreshUploadMeta's plain length.
// Not fund-scoped (unlike every other card's meta refresh) - wireUploadCard still passes
// a `fund` argument through metaRefreshFn(fund), it's just ignored here.
async function refreshDashboardUploadMeta() {
  const metaEl = document.getElementById("dashboard-meta");
  if (!metaEl) return;
  try {
    const data = await apiGet("/dashboard");
    const total = data.fund_nav.length + data.xirr.length + data.client_master.length;
    metaEl.textContent =
      total === 0
        ? "No sheets uploaded yet."
        : `${data.fund_nav.length} NAV rows, ${data.xirr.length} XIRR rows, ${data.client_master.length} Client Master rows`;
  } catch {
    metaEl.textContent = "Unable to load current record count.";
  }
}

// A fund's detail page has a dozen-plus upload cards spread across several sections
// (Client Master/Corpus, NAV Income/Expense, SOA) - this filters them by title so the
// right one is easy to find without scrolling/hunting (e.g. typing "corpus" narrows
// straight to Corpus In/Out). Cards are shown/hidden in place; group headings are left
// alone even if every card under them is hidden, which is a minor cosmetic gap but keeps
// the filter simple.
function wireUploadCardSearch(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll(".upload-card").forEach((card) => {
      const title = card.querySelector(".upload-card__title")?.textContent.toLowerCase() || "";
      card.style.display = !query || title.includes(query) ? "" : "none";
    });
  });
}

async function navigateToFundDetail(fund) {
  state.fund = fund;
  renderTrail();

  const navGroupsHtml = NAV_GROUPS.map(
    (group) => `
      <h2 class="upload-group__title">NAV &mdash; ${escapeHtml(group.label)}</h2>
      <div class="upload-grid">
        ${group.categories
          .map((c) => uploadCardHtml(c.slug, c.label, "Loading current record count...", c.note, VALIDATION_DOC_CATEGORIES.has(c.slug)))
          .join("")}
      </div>
    `
  ).join("");

  const soaGroupHtml = `
    <h2 class="upload-group__title">SOA</h2>
    <div class="upload-grid">
      ${SOA_CATEGORIES.map((c) => uploadCardHtml(c.slug, c.label, "Loading current record count...", c.note, VALIDATION_DOC_CATEGORIES.has(c.slug))).join("")}
    </div>
  `;

  mainEl.innerHTML =
    `<button type="button" class="btn back-btn" id="fund-detail-back" aria-label="Back" title="Back">${BACK_ICON}</button>` +
    heading(
      fund.name,
      "Upload the Client Master, Corpus In/Out, NAV Income/Expense, and SOA files for this fund. \"Upload & Replace\" wipes existing rows first; \"Upload & Add\" keeps them and adds the new file's rows."
    ) +
    `<div class="table-toolbar">
      <div class="search-field">
        <input type="search" class="search-input" id="fund-upload-search" placeholder="Search uploads (e.g. corpus, NAV, SOA)..." />
      </div>
    </div>
    <div class="upload-grid">
      ${uploadCardHtml("client-master", "Client Master", "Loading current record count...")}
      ${uploadCardHtml("corpus-in", "Corpus In", "Loading current record count...", "Investor contributions - Investor Code, Investor Name, Date of Bank, Capital Received, Class code, ...", true)}
      ${uploadCardHtml("corpus-out", "Corpus Out", "Loading current record count...", "Investor redemptions - Investor Code, Investor Name, Class, Capital As On, Capital Pending, Bank details, ...", true)}
    </div>` +
    navGroupsHtml +
    soaGroupHtml;

  document.getElementById("fund-detail-back").addEventListener("click", () => navigateToFundsRoot());
  wireUploadCardSearch("fund-upload-search");

  // Corpus In and Corpus Out share one collection (corpus_movements, keyed by
  // movement_type) so the combined /corpus-movements list can be aggregated per investor -
  // each card's own record count is filtered client-side from that same combined list.
  const isCorpusIn = (m) => m.movement_type === "In";
  const isCorpusOut = (m) => m.movement_type === "Out";

  wireUploadCard("client-master", fund, `/admin/funds/${fund.id}/client-master/upload`, "Client Master", `/funds/${fund.id}/clients`);
  wireUploadCard("corpus-in", fund, `/admin/funds/${fund.id}/corpus-in/upload`, "Corpus In", `/funds/${fund.id}/corpus-movements`, isCorpusIn);
  wireUploadCard("corpus-out", fund, `/admin/funds/${fund.id}/corpus-out/upload`, "Corpus Out", `/funds/${fund.id}/corpus-movements`, isCorpusOut);
  refreshUploadMeta("client-master", `/funds/${fund.id}/clients`);
  refreshUploadMeta("corpus-in", `/funds/${fund.id}/corpus-movements`, isCorpusIn);
  refreshUploadMeta("corpus-out", `/funds/${fund.id}/corpus-movements`, isCorpusOut);
  wireValidationDocButton("corpus-in", fund, "corpus-in", "Corpus In");
  wireValidationDocButton("corpus-out", fund, "corpus-out", "Corpus Out");

  NAV_GROUPS.forEach((group) => {
    group.categories.forEach((c) => {
      wireUploadCard(c.slug, fund, `/admin/funds/${fund.id}/nav/${c.slug}/upload`, c.label, `/funds/${fund.id}/nav/${c.slug}`);
      refreshUploadMeta(c.slug, `/funds/${fund.id}/nav/${c.slug}`);
      if (VALIDATION_DOC_CATEGORIES.has(c.slug)) wireValidationDocButton(c.slug, fund, c.slug, c.label);
    });
  });

  SOA_CATEGORIES.forEach((c) => {
    wireUploadCard(c.slug, fund, `/admin/funds/${fund.id}/soa/${c.slug}/upload`, c.label, `/funds/${fund.id}/soa/${c.slug}`);
    refreshUploadMeta(c.slug, `/funds/${fund.id}/soa/${c.slug}`);
    if (VALIDATION_DOC_CATEGORIES.has(c.slug)) wireValidationDocButton(c.slug, fund, c.slug, c.label);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

navigateToFundsRoot();
