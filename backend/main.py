"""
Fund Dashboard - FastAPI backend.

Exposes a small REST API backed by MongoDB and serves the static
frontend (HTML/CSS/JS) from the same process for simplicity.

Run with:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import os
import re
from contextlib import asynccontextmanager

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import logging
import file_import
logger = logging.getLogger(__name__)
from database import (
    funds_collection,
    clients_collection,
    corpus_movements_collection,
    schemes_collection,
    categories_collection,
    nav_records_collection,
    soa_records_collection,
    dashboard_records_collection,
    validation_docs_collection,
    ping_database,
)
from seed_data import seed_if_empty
from models import (
    FundSummary,
    FundCreate,
    UploadResult,
    ClientRecord,
    CorpusMovement,
    SchemeSummary,
    CategorySummary,
    CategoryDetail,
    NavRecord,
    SoaRecord,
    DashboardData,
    ValidationDocMap,
    ValidationDocUpdate,
)

# NAV tab: Income / Expense categories, keyed by URL slug -> display name.
# Each category's upload columns aren't standardized yet, so rows are stored generically
# (see file_import.parse_generic) rather than against a fixed schema like Client Master.
NAV_INCOME_CATEGORIES = {
    "realised-gain": "Realised Gain",
    "unrealised-gain": "Unrealised Gain",
    "corporate-action": "Corporate Action",
}
NAV_EXPENSE_CATEGORIES = {
    "other-expense": "Other Expense",
    "management-fees": "Management Fees",
    "performance-fees": "Performance Fees",
}
NAV_CATEGORIES = {**NAV_INCOME_CATEGORIES, **NAV_EXPENSE_CATEGORIES}

# SOA tab: Transaction / Closing / XIRR, keyed by URL slug -> display name. All three are
# plain flat uploads (file_import.parse_generic) - Transaction's In/Out split is derived
# client-side from its Amount column's sign rather than needing a dedicated backend parser.
SOA_CATEGORIES = {
    "transaction": "Transaction",
    "closing": "Closing",
    "xirr": "XIRR",
}

# The /validation-docs endpoints below are also reused by Corpus In/Out and the SOA
# categories, whose checklists of validating documents are fixed by fund policy (Corpus)
# or entirely admin-defined (SOA) rather than detected from an upload (see
# FIXED_VALIDATION_TYPES in frontend/js/admin.js) - none of these are NAV categories, so
# they need their own allow-list rather than NAV_CATEGORIES.
VALIDATION_DOC_CATEGORIES = {
    **NAV_CATEGORIES,
    "corpus-in": "Corpus In",
    "corpus-out": "Corpus Out",
    **SOA_CATEGORIES,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_if_empty()
    yield


app = FastAPI(title="Fund Dashboard API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def client_to_record(doc) -> ClientRecord:
    return ClientRecord(
        id=str(doc["_id"]),
        fund_id=doc["fund_id"],
        investor_name=doc["investor_name"],
        client_class=doc["client_class"],
        management_fees=doc["management_fees"],
        client_code=doc["client_code"],
        dp_id=doc["dp_id"],
        im_signing_date=doc["im_signing_date"],
        status=doc["status"],
        nominee_1_name=doc["nominee_1_name"],
        dob_or_incorporation_date=doc["dob_or_incorporation_date"],
        joint_holder_name=doc["joint_holder_name"],
        mobile_no=doc["mobile_no"],
        email_id=doc["email_id"],
        address_1=doc["address_1"],
        city=doc["city"],
        pin_code=doc["pin_code"],
        country=doc["country"],
        bank_name=doc["bank_name"],
        bank_account_no=doc["bank_account_no"],
        bank_account_type=doc["bank_account_type"],
        bank_ifsc_code=doc["bank_ifsc_code"],
        commitment_amount=doc["commitment_amount"],
        top_up_amount=doc["top_up_amount"],
        commitment_reduced=doc["commitment_reduced"],
        total_commitment=doc["total_commitment"],
        initial_contribution=doc["initial_contribution"],
        distributor_name=doc["distributor_name"],
        distributor_code=doc["distributor_code"],
        side_letters=doc["side_letters"],
        remarks=doc["remarks"],
        scheme=doc["scheme"],
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health_check():
    db_ok = await ping_database()
    return {"status": "ok" if db_ok else "degraded", "database_connected": db_ok}


# ---------------------------------------------------------------------------
# Fund Name tab: Funds -> Clients -> Client file
# ---------------------------------------------------------------------------

@app.get("/api/funds", response_model=list[FundSummary])
async def list_funds():
    funds = []
    async for doc in funds_collection.find():
        funds.append(FundSummary(id=str(doc["_id"]), name=doc["name"]))
    return funds


# ---------------------------------------------------------------------------
# Admin: create funds, upload Client Master / Corpus Movement files
# ---------------------------------------------------------------------------

def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "fund"


@app.post("/api/admin/funds", response_model=FundSummary, status_code=201)
async def admin_create_fund(payload: FundCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Fund name is required")

    base_slug = _slugify(name)
    slug = base_slug
    suffix = 2
    while await funds_collection.find_one({"_id": slug}):
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    await funds_collection.insert_one({"_id": slug, "name": name})
    return FundSummary(id=slug, name=name)


@app.delete("/api/admin/funds/{fund_id}", status_code=204)
async def admin_delete_fund(fund_id: str):
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    await clients_collection.delete_many({"fund_id": fund_id})
    await corpus_movements_collection.delete_many({"fund_id": fund_id})
    await nav_records_collection.delete_many({"fund_id": fund_id})
    await soa_records_collection.delete_many({"fund_id": fund_id})
    await funds_collection.delete_one({"_id": fund_id})


@app.post("/api/admin/funds/{fund_id}/client-master/upload", response_model=UploadResult)
async def admin_upload_client_master(
    fund_id: str,
    file: UploadFile = File(...),
    mode: str = Query("replace", pattern="^(replace|append)$"),
):
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    content = await file.read()
    try:
        df = file_import.read_table(file.filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    docs, warnings = file_import.parse_client_master(df)
    if not docs:
        raise HTTPException(status_code=400, detail="No valid Client Master rows found in the uploaded file.")

    for doc in docs:
        doc["fund_id"] = fund_id

    if mode != "append":
        await clients_collection.delete_many({"fund_id": fund_id})
    await clients_collection.insert_many(docs)

    return UploadResult(
        fund_id=fund_id, record_type="client_master", rows_imported=len(docs), warnings=warnings[:20], mode=mode
    )


@app.post("/api/admin/funds/{fund_id}/corpus-in/upload", response_model=UploadResult)
async def admin_upload_corpus_in(
    fund_id: str,
    file: UploadFile = File(...),
    mode: str = Query("replace", pattern="^(replace|append)$"),
):
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    content = await file.read()
    try:
        docs, warnings = file_import.parse_corpus_in(file.filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not docs:
        raise HTTPException(status_code=400, detail="No valid Corpus In rows found in the uploaded file.")

    for doc in docs:
        doc["fund_id"] = fund_id

    if mode != "append":
        await corpus_movements_collection.delete_many({"fund_id": fund_id, "movement_type": "In"})
    await corpus_movements_collection.insert_many(docs)

    return UploadResult(
        fund_id=fund_id, record_type="corpus_in", rows_imported=len(docs), warnings=warnings[:20], mode=mode
    )


@app.post("/api/admin/funds/{fund_id}/corpus-out/upload", response_model=UploadResult)
async def admin_upload_corpus_out(
    fund_id: str,
    file: UploadFile = File(...),
    mode: str = Query("replace", pattern="^(replace|append)$"),
):
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    content = await file.read()
    try:
        docs, warnings = file_import.parse_corpus_out(file.filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not docs:
        raise HTTPException(status_code=400, detail="No valid Corpus Out rows found in the uploaded file.")

    for doc in docs:
        doc["fund_id"] = fund_id

    if mode != "append":
        await corpus_movements_collection.delete_many({"fund_id": fund_id, "movement_type": "Out"})
    await corpus_movements_collection.insert_many(docs)

    return UploadResult(
        fund_id=fund_id, record_type="corpus_out", rows_imported=len(docs), warnings=warnings[:20], mode=mode
    )


@app.post("/api/admin/funds/{fund_id}/nav/{category}/upload", response_model=UploadResult)
async def admin_upload_nav_category(
    fund_id: str,
    category: str,
    file: UploadFile = File(...),
    mode: str = Query("replace", pattern="^(replace|append)$"),
):
    if category not in NAV_CATEGORIES:
        raise HTTPException(status_code=404, detail="Unknown NAV category")
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    content = await file.read()
    try:
        if category == "realised-gain":
            docs, warnings = file_import.parse_realised_gain(file.filename, content)
        elif category == "unrealised-gain":
            docs, warnings = file_import.parse_unrealised_gain(file.filename, content)
        elif category == "corporate-action":
            docs, warnings = file_import.parse_corporate_action(file.filename, content)
        elif category == "other-expense":
            docs, warnings = file_import.parse_other_expense(file.filename, content)
        elif category == "management-fees":
            docs, warnings = file_import.parse_management_fees(file.filename, content)
        else:
            df = file_import.read_table(file.filename, content)
            docs, warnings = file_import.parse_generic(df)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not docs:
        raise HTTPException(status_code=400, detail=f"No data rows found in the uploaded file for {NAV_CATEGORIES[category]}.")

    for doc in docs:
        doc["fund_id"] = fund_id
        doc["category"] = category

    if mode != "append":
        await nav_records_collection.delete_many({"fund_id": fund_id, "category": category})
    await nav_records_collection.insert_many(docs)

    return UploadResult(fund_id=fund_id, record_type=category, rows_imported=len(docs), warnings=warnings[:20], mode=mode)


@app.get("/api/funds/{fund_id}/nav/{category}", response_model=list[NavRecord])
async def list_nav_records(fund_id: str, category: str):
    if category not in NAV_CATEGORIES:
        raise HTTPException(status_code=404, detail="Unknown NAV category")
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    records = []
    async for doc in nav_records_collection.find({"fund_id": fund_id, "category": category}):
        records.append(
            NavRecord(
                id=str(doc["_id"]),
                fund_id=doc["fund_id"],
                category=doc["category"],
                data=doc.get("data", {}),
                status=doc.get("status"),
                errors=doc.get("errors", []),
            )
        )
    return records


@app.post("/api/admin/funds/{fund_id}/soa/{category}/upload", response_model=UploadResult)
async def admin_upload_soa(
    fund_id: str,
    category: str,
    file: UploadFile = File(...),
    mode: str = Query("replace", pattern="^(replace|append)$"),
):
    if category not in SOA_CATEGORIES:
        raise HTTPException(status_code=404, detail="Unknown SOA category")
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    content = await file.read()
    try:
        # Closing and XIRR carry an "As per Validator" auditor block (see
        # parse_soa_closing/parse_soa_xirr); Transaction is a plain flat sheet - its
        # In/Out split is derived client-side from the Amount column's sign instead.
        if category == "closing":
            docs, warnings = file_import.parse_soa_closing(file.filename, content)
        elif category == "xirr":
            docs, warnings = file_import.parse_soa_xirr(file.filename, content)
        else:
            df = file_import.read_table(file.filename, content)
            docs, warnings = file_import.parse_generic(df)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not docs:
        raise HTTPException(status_code=400, detail=f"No data rows found in the uploaded file for {SOA_CATEGORIES[category]}.")

    for doc in docs:
        doc["fund_id"] = fund_id
        doc["category"] = category

    if mode != "append":
        await soa_records_collection.delete_many({"fund_id": fund_id, "category": category})
    await soa_records_collection.insert_many(docs)

    return UploadResult(fund_id=fund_id, record_type=category, rows_imported=len(docs), warnings=warnings[:20], mode=mode)


@app.get("/api/funds/{fund_id}/soa/{category}", response_model=list[SoaRecord])
async def list_soa_records(fund_id: str, category: str):
    if category not in SOA_CATEGORIES:
        raise HTTPException(status_code=404, detail="Unknown SOA category")
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    records = []
    async for doc in soa_records_collection.find({"fund_id": fund_id, "category": category}):
        records.append(
            SoaRecord(
                id=str(doc["_id"]),
                fund_id=doc["fund_id"],
                category=doc["category"],
                data=doc.get("data", {}),
                status=doc.get("status"),
                errors=doc.get("errors", []),
            )
        )
    return records


@app.post("/api/admin/dashboard/upload", response_model=UploadResult)
async def admin_upload_dashboard(
    file: UploadFile = File(...),
    mode: str = Query("replace", pattern="^(replace|append)$"),
):
    """Dashboard is the app's landing page, not scoped to any one fund - it's the
    only upload in this app without a {fund_id} in its path, see DashboardData."""
    content = await file.read()
    try:
        results, warnings = file_import.parse_dashboard_workbook(file.filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    total_rows = 0
    for category, rows in results.items():
        if not rows:
            continue
        docs = [{"data": row, "category": category} for row in rows]
        if mode != "append":
            await dashboard_records_collection.delete_many({"category": category})
        await dashboard_records_collection.insert_many(docs)
        total_rows += len(docs)

    if total_rows == 0:
        raise HTTPException(status_code=400, detail="No data rows found in the uploaded Dashboard file.")

    return UploadResult(record_type="dashboard", rows_imported=total_rows, warnings=warnings[:20], mode=mode)


@app.get("/api/dashboard", response_model=DashboardData)
async def get_dashboard():
    async def category_rows(category: str) -> list[dict]:
        rows = []
        async for doc in dashboard_records_collection.find({"category": category}):
            rows.append(doc.get("data", {}))
        return rows

    fixed_categories = {"fund-nav", "xirr", "client-master"}
    extra_sheets: dict[str, list[dict]] = {}
    for category in await dashboard_records_collection.distinct("category"):
        if category in fixed_categories or not category.startswith(file_import.EXTRA_SHEET_CATEGORY_PREFIX):
            continue
        sheet_name = category[len(file_import.EXTRA_SHEET_CATEGORY_PREFIX):]
        extra_sheets[sheet_name] = await category_rows(category)

    return DashboardData(
        fund_nav=await category_rows("fund-nav"),
        xirr=await category_rows("xirr"),
        client_master=await category_rows("client-master"),
        extra_sheets=extra_sheets,
    )


@app.get("/api/funds/{fund_id}/nav/{category}/validation-docs", response_model=ValidationDocMap)
async def get_validation_docs(fund_id: str, category: str):
    if category not in VALIDATION_DOC_CATEGORIES:
        raise HTTPException(status_code=404, detail="Unknown category")

    doc = await validation_docs_collection.find_one({"_id": f"{fund_id}:{category}"})
    return ValidationDocMap(fund_id=fund_id, category=category, mappings=(doc or {}).get("mappings", {}))


@app.put("/api/admin/funds/{fund_id}/nav/{category}/validation-docs", response_model=ValidationDocMap)
async def update_validation_docs(fund_id: str, category: str, update: ValidationDocUpdate):
    if category not in VALIDATION_DOC_CATEGORIES:
        raise HTTPException(status_code=404, detail="Unknown category")
    if not await funds_collection.find_one({"_id": fund_id}):
        raise HTTPException(status_code=404, detail="Fund not found")

    # Merged and $set as a single "mappings" subdocument rather than dotted paths
    # ("$set": {"mappings.<key>": ...}) - Management Fees' keys are composite
    # (investor||class||fee%) and can contain literal "." (e.g. a Fee% of "1.25"),
    # which Mongo would otherwise split into nested fields instead of one flat key.
    new_entries = {type_value: doc_name for type_value, doc_name in update.mappings.items() if type_value}
    if new_entries:
        existing = await validation_docs_collection.find_one({"_id": f"{fund_id}:{category}"})
        mappings = dict((existing or {}).get("mappings", {}))
        mappings.update(new_entries)
        await validation_docs_collection.update_one(
            {"_id": f"{fund_id}:{category}"},
            {"$set": {"mappings": mappings, "fund_id": fund_id, "category": category}},
            upsert=True,
        )

    doc = await validation_docs_collection.find_one({"_id": f"{fund_id}:{category}"})
    return ValidationDocMap(fund_id=fund_id, category=category, mappings=(doc or {}).get("mappings", {}))


@app.get("/api/funds/{fund_id}/clients", response_model=list[ClientRecord])
async def list_clients_for_fund(fund_id: str):
    fund = await funds_collection.find_one({"_id": fund_id})
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    clients = []
    async for doc in clients_collection.find({"fund_id": fund_id}):
        clients.append(client_to_record(doc))
    return clients


@app.get("/api/clients/{client_id}", response_model=ClientRecord)
async def get_client_detail(client_id: str):
    try:
        object_id = ObjectId(client_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid client id")

    doc = await clients_collection.find_one({"_id": object_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Client not found")

    return client_to_record(doc)


@app.get("/api/funds/{fund_id}/corpus-movements", response_model=list[CorpusMovement])
async def list_corpus_movements_for_fund(fund_id: str):
    fund = await funds_collection.find_one({"_id": fund_id})
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")

    movements = []
    async for doc in corpus_movements_collection.find({"fund_id": fund_id}).sort("movement_date", 1):
        # Defensive access: some stored documents may not include all keys (movement_date, etc.).
        # Use .get with sensible defaults and log missing critical fields to aid debugging.
        movement_date = doc.get("movement_date", "")
        investor_code = str(doc.get("investor_code", "")).strip()
        investor_name = str(doc.get("investor_name", "")).strip()

        # Skip obviously-empty placeholder rows where both investor code and name are missing
        # (covers '', None, and '-' placeholders). This removes the unnecessary blank row in the UI.
        if (not investor_code or investor_code == "-") and (not investor_name or investor_name == "-"):
            logger.info("Skipping empty corpus movement row", extra={"doc_id": str(doc.get("_id")), "doc": doc})
            continue

        if not movement_date:
            logger.warning("Corpus movement missing movement_date", extra={"doc_id": str(doc.get("_id")), "doc": doc})

        movements.append(
            CorpusMovement(
                id=str(doc.get("_id", "")),
                fund_id=doc.get("fund_id", ""),
                movement_date=movement_date,
                investor_code=investor_code,
                investor_name=investor_name,
                movement_type=doc.get("movement_type", ""),
                amount=doc.get("amount", 0.0),
                client_class=doc.get("client_class", ""),
                bank_account=doc.get("bank_account", ""),
                data=doc.get("data", {}),
                status=doc.get("status"),
                errors=doc.get("errors", []),
            )
        )
    return movements


# ---------------------------------------------------------------------------
# Fund Scheme tab: Schemes (AIF) -> Categories (Cat I / II / III)
# ---------------------------------------------------------------------------

@app.get("/api/schemes", response_model=list[SchemeSummary])
async def list_schemes():
    schemes = []
    async for doc in schemes_collection.find():
        schemes.append(SchemeSummary(id=str(doc["_id"]), name=doc["name"], full_name=doc["full_name"]))
    return schemes


@app.get("/api/schemes/{scheme_id}/categories", response_model=list[CategorySummary])
async def list_categories_for_scheme(scheme_id: str):
    scheme = await schemes_collection.find_one({"_id": scheme_id})
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    categories = []
    async for doc in categories_collection.find({"scheme_id": scheme_id}):
        categories.append(CategorySummary(id=str(doc["_id"]), scheme_id=doc["scheme_id"], name=doc["name"]))
    return categories


@app.get("/api/categories/{category_id}", response_model=CategoryDetail)
async def get_category_detail(category_id: str):
    doc = await categories_collection.find_one({"_id": category_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Category not found")

    return CategoryDetail(
        id=str(doc["_id"]),
        scheme_id=doc["scheme_id"],
        name=doc["name"],
        description=doc["description"],
        sub_schemes=doc.get("sub_schemes", []),
    )


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------


class NoCacheStaticFiles(StaticFiles):
    """Serves the frontend with caching disabled.

    This app is under active development and has no build step / filename hashing,
    so a browser caching an old admin.js or style.css silently serves stale UI
    behavior after an edit - confusing to debug since the served file looks fine on
    the server. Not appropriate for a CDN-backed production static site, but this is
    a small internal tool where always getting the latest file matters more than
    shaving off repeat-visit load time.
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response


FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

if os.path.isdir(FRONTEND_DIR):
    app.mount("/", NoCacheStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
