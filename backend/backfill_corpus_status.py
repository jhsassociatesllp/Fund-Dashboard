"""
Backfill script: populate `status` and `errors` on existing corpus_movements documents
when an auditor/validator-like column is present in the stored `data` dict.

Usage (from project root):
  python backend\backfill_corpus_status.py --fund-id <fund_id> [--dry-run] [--force]

Options:
  --fund-id ID    Run only for the specified fund id (recommended).
  --all           Run for all funds (dangerous; prefer --fund-id).
  --dry-run       Print what would change, don't write to DB.
  --force         Overwrite existing status/errors even if present.
  --limit N       Limit to first N documents (useful for testing).

The script uses the same numeric parsing and tolerance constants as file_import.parse_corpus_in/out
so results match the uploader behaviour.
"""

import asyncio
import argparse
import re
from typing import Optional

# Import the async Mongo collection objects used by the app
from backend import database

DIFF_TOLERANCE = 0.01


def _normalize_header(header: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(header).strip().lower())


def _to_float_or_none(value) -> Optional[float]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", raw)
    if cleaned in ("", "-", ".", "-."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _number_from_norm(norm: dict, *keys: str) -> float:
    # similar to file_import._number but works on normalized-key dict
    for key in keys:
        v = norm.get(key)
        if v is None:
            continue
        raw = str(v).strip()
        if not raw or raw == "-":
            continue
        cleaned = re.sub(r"[^0-9.\-]", "", raw)
        if cleaned in ("", "-", ".", "-."):
            continue
        try:
            return float(cleaned)
        except ValueError:
            continue
    return 0.0


async def backfill(fund_id: Optional[str], run_all: bool, dry_run: bool, force: bool, limit: Optional[int]):
    coll = database.corpus_movements_collection

    query = {}
    if fund_id:
        query["fund_id"] = fund_id
    elif not run_all:
        raise ValueError("Either --fund-id or --all must be provided")

    cursor = coll.find(query)
    if limit:
        cursor = cursor.limit(limit)

    changed = 0
    inspected = 0
    to_update = []

    async for doc in cursor:
        inspected += 1
        # Skip docs without data payload
        data = doc.get("data") or {}
        if not isinstance(data, dict):
            continue

        # Skip if already has status and not forcing
        if not force and (doc.get("status") or doc.get("errors")):
            continue

        # Normalize keys to map to their original header text
        norm = { _normalize_header(k): v for k, v in data.items() }

        # Document movement amount (expected to exist)
        base_num = _to_float_or_none(doc.get("amount"))
        # If amount missing, try to compute from common fields
        if base_num is None:
            # try some corpus-in/out column names
            base_num = _number_from_norm(norm, "capitalreceived", "amount", "contributionamount", "amountreceived", "capitalamount")

        # Detect auditor-like key from the original headers (not normalized-to-original here for simplicity)
        auditor_key = None
        for orig_key in data.keys():
            if any(sub in _normalize_header(orig_key) for sub in ("asper", "auditor", "validator", "confirmed")):
                auditor_key = orig_key
                break

        auditor_num = _to_float_or_none(data.get(auditor_key)) if auditor_key else None

        # No auditor column found -> nothing to backfill for this row
        if auditor_num is None:
            continue

        # Compare
        mismatch = False
        diff = None
        if base_num is None:
            # If base missing, treat mismatch when text differs
            fund_text = str(doc.get("amount") or data.get("amount") or "").strip()
            auditor_text = str(data.get(auditor_key) or "").strip()
            mismatch = fund_text != auditor_text
            diff = None
        else:
            diff = auditor_num - base_num
            mismatch = abs(diff) > DIFF_TOLERANCE

        status = "incorrect" if mismatch else "correct"
        errors = []
        if mismatch:
            errors.append({
                "field": "Amount",
                "original": "" if base_num is None else base_num,
                "auditor": auditor_num,
                "diff": diff,
            })

        # Prepare update
        update_doc = {"status": status, "errors": errors}
        to_update.append((doc["_id"], update_doc))

        if dry_run:
            print(f"DRY: would update doc _id={doc['_id']} fund_id={doc.get('fund_id')} -> status={status} errors_count={len(errors)} auditor_key={auditor_key}")
        else:
            result = await coll.update_one({"_id": doc["_id"]}, {"$set": update_doc})
            if result.modified_count:
                changed += 1
                print(f"Updated _id={doc['_0id'] if '_0id' in doc else doc['_id']} status={status} errors={len(errors)}")
            else:
                print(f"No-op (no change) _id={doc['_id']}")

    print("\nBackfill complete.")
    print(f"Inspected: {inspected}")
    if dry_run:
        print(f"Would update: {len(to_update)} documents")
    else:
        print(f"Updated: {changed} documents")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fund-id", dest="fund_id", help="Fund id to operate on (slug)")
    parser.add_argument("--all", dest="all", action="store_true", help="Run across all funds (dangerous)")
    parser.add_argument("--dry-run", dest="dry_run", action="store_true", help="Don't write; show actions")
    parser.add_argument("--force", dest="force", action="store_true", help="Overwrite existing status/errors")
    parser.add_argument("--limit", dest="limit", type=int, help="Limit number of documents processed (testing)")

    args = parser.parse_args()

    # Run
    asyncio.run(backfill(args.fund_id, args.all, args.dry_run, args.force, args.limit))


if __name__ == "__main__":
    main()
