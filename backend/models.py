"""
Pydantic schemas used to shape API responses.
Mongo's ObjectId is converted to plain strings so the frontend never has to
deal with BSON types.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class FundSummary(BaseModel):
    id: str
    name: str


class FundCreate(BaseModel):
    name: str


class UploadResult(BaseModel):
    # None for fund-agnostic uploads (currently just Dashboard, which isn't scoped to
    # any one fund - see DashboardData).
    fund_id: Optional[str] = None
    record_type: str  # "client_master" | "corpus_movement"
    rows_imported: int
    warnings: List[str] = Field(default_factory=list)
    mode: str = "replace"  # "replace" | "append"


class ClientRecord(BaseModel):
    """Full investor / client record shown in the Fund -> Company -> Clients table."""

    id: str
    fund_id: str

    investor_name: str
    client_class: str
    management_fees: str
    client_code: str
    dp_id: str
    im_signing_date: str
    status: str
    nominee_1_name: str
    dob_or_incorporation_date: str
    joint_holder_name: str
    mobile_no: str
    email_id: str
    address_1: str
    city: str
    pin_code: str
    country: str
    bank_name: str
    bank_account_no: str
    bank_account_type: str
    bank_ifsc_code: str
    commitment_amount: float
    top_up_amount: float
    commitment_reduced: float
    total_commitment: float
    initial_contribution: float
    distributor_name: str
    distributor_code: str
    side_letters: str
    remarks: str
    scheme: str


class CorpusMovement(BaseModel):
    """A single contribution ("In") or redemption ("Out") entry, from the fund's
    separate Corpus In / Corpus Out uploads - each has a different column layout
    (e.g. Corpus In has no bank details, Corpus Out has no per-row date), so `data`
    carries every original column from whichever file this row came from, and only
    the fields needed for the combined per-investor summary are hoisted to top level.
    """

    id: str
    fund_id: str

    movement_date: str
    investor_code: str
    investor_name: str
    movement_type: str  # "In" or "Out"
    amount: float
    client_class: str
    bank_account: str
    data: Dict[str, str] = Field(default_factory=dict)

    # Auditor validation metadata (optional) - mirrors NavRecord/SoaRecord's status/errors
    status: Optional[str] = None
    errors: List["NavValidationError"] = Field(default_factory=list)


class NavValidationError(BaseModel):
    """One field on a NAV row that didn't match the auditor's recalculation."""

    field: str
    original: Optional[str] = None
    auditor: Optional[str] = None
    diff: Optional[float] = None


class NavRecord(BaseModel):
    """One uploaded row under a NAV Income/Expense category (e.g. Brokerage, GST).

    Columns for these categories aren't standardized yet, so each row is kept as the
    raw header -> value pairs from the uploaded sheet rather than a fixed schema.

    status/errors are only populated for categories that carry an auditor
    cross-check (currently Realised Gain, Unrealised Gain, and Corporate Action):
    "correct" if the auditor's recalculation matched, "incorrect" if it didn't
    (see `errors` for which fields), or None if the upload had no auditor
    validation columns to check against.
    """

    id: str
    fund_id: str
    category: str
    data: Dict[str, str] = Field(default_factory=dict)
    status: Optional[str] = None
    errors: List[NavValidationError] = Field(default_factory=list)


class SoaRecord(BaseModel):
    """One uploaded row under an SOA sub-section (Transaction, Closing, XIRR).

    Like NavRecord, columns aren't standardized so each row is kept as raw
    header -> value pairs rather than a fixed schema. status/errors work the
    same way as NavRecord's: populated when the category's upload carries an
    auditor cross-check (Closing and XIRR, both via an "As per Validator"
    block - see parse_soa_closing/parse_soa_xirr), None/empty otherwise -
    Transaction's In/Out split is derived client-side from the Amount
    column's sign instead and has no such cross-check.
    """

    id: str
    fund_id: str
    category: str
    data: Dict[str, str] = Field(default_factory=dict)
    status: Optional[str] = None
    errors: List[NavValidationError] = Field(default_factory=list)


class DashboardData(BaseModel):
    """The app's Dashboard page data, parsed from one multi-sheet Excel upload
    (see file_import.parse_dashboard_workbook) - Fund NAV (for the NAV growth
    chart), XIRR (for the return-over-time chart), and Client Master (not shown
    as a table - the frontend derives investor-level insights from it instead,
    see renderInvestorInsights in frontend/js/app.js). Each is a list of raw
    header -> value rows, same shape as NavRecord/SoaRecord's `data`, since none
    of these have a fixed schema either.

    `extra_sheets` holds anything in the workbook beyond those three fixed sheets,
    keyed by the sheet's own name - an admin adds a chart to the Dashboard just by
    adding a sheet, no upload-time prompt for what it is; the frontend decides
    line/bar/table per sheet from its column shape (see detectAutoChartKind in
    frontend/js/app.js).
    """

    fund_nav: List[Dict[str, str]] = Field(default_factory=list)
    xirr: List[Dict[str, str]] = Field(default_factory=list)
    client_master: List[Dict[str, str]] = Field(default_factory=list)
    extra_sheets: Dict[str, List[Dict[str, str]]] = Field(default_factory=dict)


class ValidationDocMap(BaseModel):
    """Per (fund, category) admin-maintained list of which supporting document
    validates each grouping value found in that category's uploads - e.g. Instrument
    Type "Equity" -> "Contract Note / Trade Listing" for Realised Gain, or Expense
    Type "Broking Fee" -> "Broker Contract Note" for Other Expense.

    Upload templates for these categories aren't standardized, so this isn't a fixed
    list: the admin adds an entry the first time a new type value shows up in an
    upload, and can edit any entry afterwards.

    Each value is normally a plain string (the document name). Realised Gain,
    Unrealised Gain, and Corporate Action instead get a {trade_details,
    validating_document, test_procedure} object per type - see
    DETAIL_FIELD_CATEGORIES/_sanitize_mappings in main.py, which is what actually
    enforces that shape (Any here just means Pydantic doesn't fight it either way).
    """

    fund_id: str
    category: str
    mappings: Dict[str, Any] = Field(default_factory=dict)


class ValidationDocUpdate(BaseModel):
    mappings: Dict[str, Any]


class SchemeSummary(BaseModel):
    id: str
    name: str
    full_name: str


class CategorySummary(BaseModel):
    id: str
    scheme_id: str
    name: str


class SubScheme(BaseModel):
    name: str
    sebi_reg_no: str
    launch_date: str
    aum_inr_cr: float
    strategy: str


class CategoryDetail(BaseModel):
    id: str
    scheme_id: str
    name: str
    description: str
    sub_schemes: List[SubScheme] = Field(default_factory=list)
