"""Halal Income & Zakat Calculator — Hanbali classification + zakat engine."""
import pandas as pd
from datetime import datetime

LUNAR_YEAR_DAYS = 354

# ---------------------------------------------------------------------------
# TRANSACTION KEYWORD RULES
# ---------------------------------------------------------------------------

NON_INCOME_KEYWORDS = {
    "internal_transfer", "loan_received", "loan_repayment", "refundable_client_deposit",
    "employee_reimbursement", "inventory_purchase", "crypto_purchase", "equipment_purchase",
    "business_advertising", "business_supplies", "electricity_bill", "groceries",
    "personal_spending", "phone_bill", "restaurant_meal", "software_subscription", "transportation",
}

INCOME_REDUCING_KEYWORDS = {"processor_fee", "customer_refund", "chargeback"}

INCOME_KEYWORD_RULES = {
    "salary_income": ("Halal", "Ordinary employment salary."),
    "freelance_income": ("Halal", "Freelance/service income."),
    "rental_income": ("Halal", "Ordinary rental income."),
    "scholarship_income": ("Halal", "Scholarship/grant income."),
    "gift_income": ("Halal", "Personal gift."),
    "tip_income": ("Halal", "Tips from permissible work."),
    "content_revenue_income": ("Halal", "Ad/content revenue, permissible content."),
    "commission_income": ("Halal", "Ordinary commission."),
    "business_sale_income": ("Halal", "Sale of a permissible product."),
    "gross_business_sale": ("Halal", "Gross sale, pre-settlement."),
    "processor_payout": ("Halal", "Net settlement of permissible sales."),
    "tax_refund": ("Halal", "Return of the user's own money, not new income."),
    "insurance_proceeds": ("Halal", "Compensation for a loss."),
    "stock_dividend_income": ("Halal", "Dividend from screened shares."),
    "stock_sale_proceeds": ("Halal", "Sale proceeds from screened shares."),
    "interest_income": ("Haram", "Bank interest (riba)."),
    "alcohol_sales_income": ("Haram", "Direct alcohol sales."),
    "vape_sales_income": ("Haram", "Direct vape-product sales."),
    "gambling_income": ("Haram", "Gambling winnings."),
    "lottery_winnings": ("Haram", "Lottery winnings (maysir)."),
    "prohibited_product_commission": ("Haram", "Commission tied to a prohibited product."),
    "tentative_cashback": ("Tentative", "Cashback rulings vary by card contract."),
    "tentative_unscreened_investment": ("Tentative", "Fund not Shariah-screened."),
    "crypto_sale_with_cost_basis": ("Tentative", "Token screening status not on record."),
    "missing_info_affiliate_income": ("Missing Information", "Underlying product/service not on record."),
    "missing_info_marketplace_income": ("Missing Information", "No product/source description."),
    "crypto_sale_missing_cost_basis": ("Missing Information", "Cost basis and screening status both missing."),
}


def classify_mixed(row):
    amount = float(row["amount_cad"])
    pct = row.get("mixed_halal_pct")
    if row["keyword"] == "mixed_income_missing_split" or pd.isna(pct):
        return "Missing Information", 0.0, 0.0, "Mixed income, but split % not provided."
    halal_amt = round(amount * float(pct) / 100, 2)
    haram_amt = round(amount - halal_amt, 2)
    disposed = str(row.get("haram_portion_disposed", "")).lower() == "yes"
    if disposed:
        exp = f"Mixed ({pct:.0f}% halal). Haram portion disposed; only halal remainder is zakatable."
        return "Mixed", halal_amt, haram_amt, exp
    exp = f"Mixed ({pct:.0f}% halal), retained in full — stays zakatable, not exempt for being mixed."
    return "Mixed", halal_amt, haram_amt, exp


def classify_transaction_row(row):
    kw, amount, direction = row["keyword"], float(row["amount_cad"]), row["direction"]

    if kw in ("mixed_income_disposed", "mixed_income_retained", "mixed_income_missing_split"):
        return classify_mixed(row)

    if kw in INCOME_KEYWORD_RULES:
        cls, exp = INCOME_KEYWORD_RULES[kw]
        if cls == "Halal":
            return cls, amount, 0.0, exp
        if cls == "Haram":
            return cls, 0.0, amount, exp
        return cls, 0.0, 0.0, exp

    if kw in INCOME_REDUCING_KEYWORDS:
        signed = -amount if direction == "outflow" else amount
        return "Halal", signed, 0.0, f"Adjustment to permissible sales revenue ({kw})."

    if kw in NON_INCOME_KEYWORDS:
        return "Halal", 0.0, 0.0, f"Not income ({kw})."

    return "Missing Information", 0.0, 0.0, f"Unrecognized keyword '{kw}'. Needs manual classification."


def classify_transactions(tx_df):
    results, warnings = [], []
    totals = {"Halal": 0.0, "Haram": 0.0, "Mixed_Halal": 0.0, "Mixed_Haram": 0.0}
    non_income_count = 0

    for _, row in tx_df.iterrows():
        kw = row["keyword"]
        cls, halal_amt, haram_amt, exp = classify_transaction_row(row)
        is_non_income = kw in NON_INCOME_KEYWORDS

        record = {
            "transaction_id": row["transaction_id"],
            "date": str(row["date"].date()) if pd.notna(row["date"]) else None,
            "keyword": kw,
            "amount_cad": float(row["amount_cad"]),
            "direction": row["direction"],
            "classification": cls,
            "halal_amount": halal_amt,
            "haram_amount": haram_amt,
            "explanation": exp,
            "counts_as_income": not is_non_income,
        }
        results.append(record)

        if is_non_income:
            non_income_count += 1
            continue
        if kw in INCOME_REDUCING_KEYWORDS:
            totals["Halal"] += halal_amt
        elif kw in ("mixed_income_disposed", "mixed_income_retained", "mixed_income_missing_split"):
            if cls == "Mixed":
                totals["Mixed_Halal"] += halal_amt
                totals["Mixed_Haram"] += haram_amt
            else:
                warnings.append({"transaction_id": row["transaction_id"], "date": record["date"],
                                  "amount_cad": record["amount_cad"], "classification": cls, "reason": exp})
        elif cls == "Halal":
            totals["Halal"] += halal_amt
        elif cls == "Haram":
            totals["Haram"] += haram_amt
        elif cls in ("Tentative", "Missing Information"):
            warnings.append({"transaction_id": row["transaction_id"], "date": record["date"],
                              "amount_cad": record["amount_cad"], "classification": cls, "reason": exp})

    return {
        "transactions": results,
        "totals": {
            "halal_income": round(totals["Halal"], 2),
            "haram_income": round(totals["Haram"], 2),
            "mixed_income_halal_portion": round(totals["Mixed_Halal"], 2),
            "mixed_income_haram_portion": round(totals["Mixed_Haram"], 2),
            "non_income_transactions_excluded": non_income_count,
        },
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# ASSET RULES (Hanbali zakatability)
# ---------------------------------------------------------------------------

ASSET_RULES = {
    "cash": (True, "cash", "Cash on hand is zakatable."),
    "personal_chequing": (True, "cash", "Bank balance is zakatable."),
    "savings_balance": (True, "cash", "Bank balance is zakatable."),
    "business_chequing": (True, "cash", "Business cash is zakatable."),
    "business_inventory_halal": (True, "inventory", "Permissible resale inventory is zakatable."),
    "business_inventory_prohibited": (False, "haram_asset", "Prohibited inventory — not zakatable, must be disposed."),
    "worn_gold_jewelry": (False, "excluded_customary_jewelry", "Customary personal-use jewelry — excluded."),
    "investment_gold_coins": (True, "gold_silver", "Gold held as savings/investment is zakatable."),
    "silver_bars": (True, "gold_silver", "Silver held as savings/investment is zakatable."),
    "stock_shares_screened": (False, "excluded_stocks", "Hanbali: stocks/shares are not zakatable trade goods."),
    "other_halal_investment": (True, "investment", "Non-stock screened investment is zakatable."),
    "tentative_crypto_portfolio_unscreened": (False, "tentative_excluded", "Unscreened crypto — Scholar Review Required, excluded."),
    "business_receivable_likely": (False, "excluded_receivable", "Money owed to the user, unpaid — excluded under Hanbali."),
    "receivable_tentative": (False, "excluded_receivable_doubtful", "Doubtful receivable, unpaid — excluded."),
    "personal_loan_receivable": (False, "excluded_lent_money", "Hanbali: money lent to others is excluded while unpaid."),
    "personal_loan_receivable_doubtful": (False, "excluded_lent_money_doubtful", "Lent money, doubtful — excluded, not Tentative."),
    "mixed_business_cash_retained": (True, "mixed_retained", "Retained mixed cash stays zakatable in full."),
    "haram_income_separated": (False, "haram_separated", "Already-separated haram wealth — not zakatable, needs disposal."),
}


def classify_assets(assets_df):
    results, warnings = [], []
    zakatable_total = haram_total = excluded_total = 0.0

    for _, row in assets_df.iterrows():
        kw, amount = row["keyword"], float(row["amount_cad"])
        rule = ASSET_RULES.get(kw)

        if rule is None:
            results.append({"asset_id": row["asset_id"], "keyword": kw, "amount_cad": amount,
                             "zakatable": False, "category": "unrecognized",
                             "explanation": f"Unrecognized asset keyword '{kw}'."})
            warnings.append({"asset_id": row["asset_id"], "classification": "Missing Information",
                              "reason": f"Unrecognized asset keyword '{kw}'."})
            continue

        zakatable, category, exp = rule
        results.append({"asset_id": row["asset_id"], "keyword": kw, "description": row.get("description"),
                         "amount_cad": amount, "zakatable": zakatable, "category": category, "explanation": exp})

        if category in ("haram_asset", "haram_separated"):
            haram_total += amount
        elif zakatable:
            zakatable_total += amount
        else:
            excluded_total += amount

        if category == "tentative_excluded":
            warnings.append({"asset_id": row["asset_id"], "classification": "Tentative", "reason": exp})

    return {
        "assets": results,
        "totals": {
            "zakatable_assets_total": round(zakatable_total, 2),
            "haram_or_prohibited_assets_total": round(haram_total, 2),
            "excluded_non_zakatable_total": round(excluded_total, 2),
        },
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# DEBTS — Hanbali: full outstanding balance, no 12-month cap
# ---------------------------------------------------------------------------

def classify_debts(debts_df):
    results, total = [], 0.0
    for _, row in debts_df.iterrows():
        balance = float(row["outstanding_balance_cad"])
        total += balance
        results.append({"debt_id": row["debt_id"], "creditor": row["creditor"], "keyword": row["keyword"],
                         "outstanding_balance_cad": balance,
                         "explanation": "Hanbali: full outstanding balance subtracted, no 12-month cap."})
    return {"debts": results, "total_debt": round(total, 2)}


# ---------------------------------------------------------------------------
# HAWL — Hanbali: resets on any dip below nisab
# ---------------------------------------------------------------------------

def approx_monthly_wealth(row):
    included = (row.get("cash_and_bank_cad", 0) + row.get("business_cash_cad", 0)
                + row.get("business_inventory_halal_cad", 0) + row.get("gold_silver_savings_cad", 0)
                + row.get("other_halal_investments_cad", 0))
    return float(included - row.get("total_outstanding_debts_cad", 0))


def check_hawl(wealth_history_df, nisab, calculation_date):
    df = wealth_history_df.sort_values("month_end").reset_index(drop=True)
    df["wealth"] = df.apply(approx_monthly_wealth, axis=1)
    df["above"] = df["wealth"] >= nisab

    reset_date = None
    for _, row in df.iterrows():
        if row["above"]:
            if reset_date is None:
                reset_date = row["month_end"]
        else:
            reset_date = None

    history = [{"month_end": str(r["month_end"].date()), "approx_zakatable_wealth": round(r["wealth"], 2),
                "above_nisab": bool(r["above"]), "event_note": r.get("event_note")} for _, r in df.iterrows()]

    if reset_date is None:
        return {"hawl_satisfied": False, "reason": "Not currently at/above nisab, or not yet recovered from a dip.",
                "history": history}

    days_held = (calculation_date - reset_date).days
    satisfied = days_held >= LUNAR_YEAR_DAYS
    return {
        "hawl_satisfied": satisfied,
        "hawl_clock_started": str(reset_date.date()),
        "days_since_hawl_start": days_held,
        "lunar_year_days_required": LUNAR_YEAR_DAYS,
        "reason": f"At/above nisab since {reset_date.date()} ({days_held} days). "
                  + ("Hawl satisfied." if satisfied else "Hawl not yet satisfied."),
        "history": history,
    }


# ---------------------------------------------------------------------------
# DRIVER
# ---------------------------------------------------------------------------

def load_workbook(path):
    return pd.read_excel(path, sheet_name=None)


def profile_to_dict(profile_df):
    return dict(zip(profile_df["field"], profile_df["value"]))


def run_zakat_calculation(path):
    sheets = load_workbook(path)
    profile = profile_to_dict(sheets["User_Profile"])

    income_result = classify_transactions(sheets["Transactions"])
    asset_result = classify_assets(sheets["Assets"])
    debt_result = classify_debts(sheets["Debts"])

    nisab = float(profile["selected_nisab_cad"])
    calc_date = profile["calculation_date"]
    if not isinstance(calc_date, datetime):
        calc_date = pd.to_datetime(calc_date)

    hawl_result = check_hawl(sheets["Wealth_History"], nisab, calc_date)
    net_wealth = round(asset_result["totals"]["zakatable_assets_total"] - debt_result["total_debt"], 2)
    zakat_due = net_wealth >= nisab and hawl_result["hawl_satisfied"]
    zakat_amount = round(net_wealth * 0.025, 2) if zakat_due else 0.0

    return {
        "person_name": profile.get("person_name"),
        "madhhab": "Hanbali",
        "calculation_date": str(calc_date.date()),
        "nisab_cad": nisab,
        "income_classification": income_result,
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
        "wealth_summary": {
            "halal_income_total": income_result["totals"]["halal_income"],
            "haram_income_total": income_result["totals"]["haram_income"],
            "mixed_income_halal_portion": income_result["totals"]["mixed_income_halal_portion"],
            "mixed_income_haram_portion": income_result["totals"]["mixed_income_haram_portion"],
            "haram_wealth_to_dispose": asset_result["totals"]["haram_or_prohibited_assets_total"],
        },
        "warnings": income_result["warnings"] + asset_result["warnings"],
        "disclaimer": profile.get("disclaimer"),
    }


if __name__ == "__main__":
    import sys, json
    path = sys.argv[1] if len(sys.argv) > 1 else "Nadia_Rahman_Participant_Practice_A_.xlsx"
    print(json.dumps(run_zakat_calculation(path), indent=2, default=str))
