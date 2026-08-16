"""
Flask API for the Halal Income & Zakat Calculator.

This file has NO classification logic. Every calculation call goes straight
into zakat_engine.py. If a number is wrong, fix it there — not here.

Endpoints:
    GET  /                    -> serves static/index.html
    GET  /api/keywords        -> keyword lists grouped by classification, for building the form dropdown
    POST /api/upload          -> upload the .xlsx workbook, returns full computed results
    POST /api/transaction     -> add one manual transaction, returns updated results
    POST /api/transactions/reset -> clear manual transactions, returns updated results
    GET  /api/results         -> recompute + return current results

State is a single in-memory dict (STATE). Fine for a hackathon demo (one
presenter, one browser tab at a time). Not safe for multiple concurrent users
-- swap for a real session/DB layer if that ever matters.
"""

from flask import Flask, request, jsonify, send_from_directory
import pandas as pd

from zakat_engine import (
    classify_transactions,
    classify_assets,
    classify_debts,
    check_hawl,
    profile_to_dict,
    INCOME_KEYWORD_RULES,
    NON_INCOME_KEYWORDS,
    INCOME_REDUCING_KEYWORDS,
)

app = Flask(__name__, static_folder="static", static_url_path="")

STATE = {"sheets": None, "manual_transactions": []}

MIXED_KEYWORDS = ["mixed_income_disposed", "mixed_income_retained", "mixed_income_missing_split"]

EMPTY_INCOME_TOTALS = {
    "halal_income": 0.0, "haram_income": 0.0,
    "mixed_income_halal_portion": 0.0, "mixed_income_haram_portion": 0.0,
    "non_income_transactions_excluded": 0,
}


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/keywords")
def keywords():
    groups = {"Halal": [], "Haram": [], "Tentative": [], "Missing Information": []}
    for kw, (cls, _exp) in INCOME_KEYWORD_RULES.items():
        groups[cls].append(kw)
    groups["Mixed"] = MIXED_KEYWORDS
    groups["Adjustment (reduces halal total)"] = sorted(INCOME_REDUCING_KEYWORDS)
    groups["Non-Income (excluded)"] = sorted(NON_INCOME_KEYWORDS)
    return jsonify(groups)


@app.route("/api/upload", methods=["POST"])
def upload():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    try:
        sheets = pd.read_excel(file, sheet_name=None)
    except Exception as e:
        return jsonify({"error": f"Could not read workbook: {e}"}), 400

    required = ["Transactions", "Assets", "Debts", "Wealth_History", "User_Profile"]
    missing = [s for s in required if s not in sheets]
    if missing:
        return jsonify({"error": f"Workbook is missing sheet(s): {missing}"}), 400

    STATE["sheets"] = sheets
    STATE["manual_transactions"] = []
    return jsonify(compute_results())


@app.route("/api/transaction", methods=["POST"])
def add_transaction():
    data = request.get_json(force=True)
    if not data.get("keyword") or data.get("amount_cad") in (None, ""):
        return jsonify({"error": "keyword and amount_cad are required"}), 400

    next_id = f"MANUAL{len(STATE['manual_transactions']) + 1:04d}"
    row = {
        "transaction_id": next_id,
        "date": data.get("date"),
        "keyword": data["keyword"],
        "amount_cad": float(data["amount_cad"]),
        "direction": data.get("direction", "inflow"),
        "transaction_type": "income" if data.get("direction", "inflow") == "inflow" else "expense",
        "merchant_or_source": data.get("merchant_or_source"),
        "description": data.get("description"),
        "account": data.get("account", "MANUAL_ENTRY"),
        "scope": data.get("scope", "personal"),
        "status": "posted",
        "mixed_halal_pct": data.get("mixed_halal_pct"),
        "haram_portion_disposed": data.get("haram_portion_disposed"),
        "cost_basis_cad": data.get("cost_basis_cad"),
        "related_reference": None,
        "missing_information": data.get("missing_information"),
    }
    STATE["manual_transactions"].append(row)
    return jsonify(compute_results())


@app.route("/api/transactions/reset", methods=["POST"])
def reset_manual():
    STATE["manual_transactions"] = []
    return jsonify(compute_results())


@app.route("/api/results")
def results():
    return jsonify(compute_results())


def compute_results():
    sheets = STATE["sheets"]
    manual = STATE["manual_transactions"]

    if sheets is None and not manual:
        return {"has_data": False}

    if sheets is not None:
        base_tx = sheets["Transactions"]
        tx_df = pd.concat([base_tx, pd.DataFrame(manual)], ignore_index=True) if manual else base_tx.copy()
    else:
        tx_df = pd.DataFrame(manual)

    if not tx_df.empty:
        tx_df["date"] = pd.to_datetime(tx_df["date"])
        income_result = classify_transactions(tx_df)
    else:
        income_result = {"transactions": [], "totals": EMPTY_INCOME_TOTALS, "warnings": []}

    result = {"has_data": True, "income_classification": income_result}

    if sheets is not None:
        asset_result = classify_assets(sheets["Assets"])
        debt_result = classify_debts(sheets["Debts"])
        profile = profile_to_dict(sheets["User_Profile"])
        nisab = float(profile["selected_nisab_cad"])
        calc_date = pd.to_datetime(profile["calculation_date"])
        hawl_result = check_hawl(sheets["Wealth_History"], nisab, calc_date)

        net_wealth = round(asset_result["totals"]["zakatable_assets_total"] - debt_result["total_debt"], 2)
        zakat_due = net_wealth >= nisab and hawl_result["hawl_satisfied"]
        zakat_amount = round(net_wealth * 0.025, 2) if zakat_due else 0.0

        result.update({
            "person_name": profile.get("person_name"),
            "asset_classification": asset_result,
            "debts": debt_result,
            "hawl_check": hawl_result,
            "zakat_summary": {
                "zakatable_assets_total": asset_result["totals"]["zakatable_assets_total"],
                "total_debts_subtracted": debt_result["total_debt"],
                "net_zakatable_wealth": net_wealth,
                "nisab_cad": nisab,
                "meets_nisab": net_wealth >= nisab,
                "hawl_satisfied": hawl_result["hawl_satisfied"],
                "zakat_due": zakat_due,
                "zakat_amount_cad": zakat_amount,
            },
        })
        result["warnings"] = income_result["warnings"] + asset_result["warnings"]
    else:
        result["warnings"] = income_result["warnings"]

    return result


if __name__ == "__main__":
    app.run(debug=True, port=5000)
