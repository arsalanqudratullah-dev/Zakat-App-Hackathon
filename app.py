"""
Halal Income & Zakat Calculator — Streamlit App (Hanbali madhhab)
===================================================================

Run with:
    streamlit run app.py

Requires zakat_engine.py in the same directory. This file has NO
classification logic of its own — it only calls into zakat_engine and
renders the result. If a number looks wrong, the bug is in zakat_engine.py,
not here.
"""

import streamlit as st
import pandas as pd
from datetime import datetime, date

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

st.set_page_config(page_title="Halal Income & Zakat Calculator", layout="wide")

TRANSACTION_COLUMNS = [
    "person_name", "transaction_id", "date", "keyword", "amount_cad", "direction",
    "transaction_type", "merchant_or_source", "description", "account", "scope",
    "status", "mixed_halal_pct", "haram_portion_disposed", "cost_basis_cad",
    "related_reference", "missing_information", "parse_line",
]

MIXED_KEYWORDS = {"mixed_income_disposed", "mixed_income_retained", "mixed_income_missing_split"}
CRYPTO_KEYWORDS = {"crypto_sale_with_cost_basis", "crypto_sale_missing_cost_basis"}

ALL_TX_KEYWORDS = sorted(
    set(INCOME_KEYWORD_RULES) | set(NON_INCOME_KEYWORDS) | set(INCOME_REDUCING_KEYWORDS) | MIXED_KEYWORDS
)


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

def init_state():
    if "sheets" not in st.session_state:
        st.session_state.sheets = None  # dict of DataFrames from uploaded workbook
    if "manual_transactions" not in st.session_state:
        st.session_state.manual_transactions = pd.DataFrame(columns=TRANSACTION_COLUMNS)
    if "next_manual_id" not in st.session_state:
        st.session_state.next_manual_id = 1


init_state()


# ---------------------------------------------------------------------------
# Header / madhhab banner
# ---------------------------------------------------------------------------

st.title("Halal Income & Zakat Calculator")
st.info(
    "**Madhhab: Hanbali.** Stocks/shares are excluded from zakat, the full outstanding "
    "balance of every debt is subtracted (no 12-month cap), and money lent to others is "
    "excluded while unpaid. This calculator applies only these organizer-provided simplified "
    "rules — it is not a fatwa. Unresolved cases should be directed to a qualified scholar.",
    icon="🕌",
)

# ---------------------------------------------------------------------------
# Step 1: Upload
# ---------------------------------------------------------------------------

st.header("1. Upload your data")
uploaded = st.file_uploader(
    "Upload the workbook (.xlsx with Transactions / Assets / Debts / Wealth_History / User_Profile tabs)",
    type=["xlsx"],
)

if uploaded is not None:
    st.session_state.sheets = pd.read_excel(uploaded, sheet_name=None)
    st.success(f"Loaded: {', '.join(st.session_state.sheets.keys())}")

sheets = st.session_state.sheets

# ---------------------------------------------------------------------------
# Step 2: Manual income entry
# ---------------------------------------------------------------------------

st.header("2. Add income manually (optional)")

with st.expander("Add a transaction", expanded=False):
    with st.form("manual_entry_form", clear_on_submit=True):
        col1, col2, col3 = st.columns(3)
        with col1:
            m_date = st.date_input("Date", value=date.today())
            m_keyword = st.selectbox("Keyword / income type", ALL_TX_KEYWORDS)
            m_amount = st.number_input("Amount (CAD)", min_value=0.0, step=1.0)
        with col2:
            m_direction = st.selectbox("Direction", ["inflow", "outflow"])
            m_scope = st.selectbox("Scope", ["personal", "business"])
            m_account = st.text_input("Account", value="MANUAL_ENTRY")
        with col3:
            m_merchant = st.text_input("Source / merchant")
            m_description = st.text_area("Description", height=68)

        # conditional fields
        m_pct = None
        m_disposed = None
        m_cost_basis = None
        m_missing = None
        if m_keyword in MIXED_KEYWORDS and m_keyword != "mixed_income_missing_split":
            mc1, mc2 = st.columns(2)
            with mc1:
                m_pct = st.number_input("Halal percentage of this payout (%)", 0, 100, 50)
            with mc2:
                m_disposed = st.selectbox("Was the haram portion disposed?", ["yes", "no"])
        elif m_keyword == "mixed_income_missing_split":
            m_missing = "Percentage of permissible vs prohibited revenue is missing"
        if m_keyword == "crypto_sale_with_cost_basis":
            m_cost_basis = st.number_input("Cost basis (CAD)", min_value=0.0, step=1.0)
        if m_keyword.startswith("missing_info") or m_keyword == "crypto_sale_missing_cost_basis":
            m_missing = st.text_input(
                "What information is missing?",
                value="Details needed to classify this transaction are missing.",
            )

        submitted = st.form_submit_button("Add transaction")
        if submitted:
            new_id = f"MANUAL{st.session_state.next_manual_id:04d}"
            st.session_state.next_manual_id += 1
            row = {
                "person_name": None,
                "transaction_id": new_id,
                "date": pd.Timestamp(m_date),
                "keyword": m_keyword,
                "amount_cad": m_amount,
                "direction": m_direction,
                "transaction_type": "income" if m_direction == "inflow" else "expense",
                "merchant_or_source": m_merchant,
                "description": m_description,
                "account": m_account,
                "scope": m_scope,
                "status": "posted",
                "mixed_halal_pct": m_pct,
                "haram_portion_disposed": m_disposed,
                "cost_basis_cad": m_cost_basis,
                "related_reference": None,
                "missing_information": m_missing,
                "parse_line": None,
            }
            st.session_state.manual_transactions = pd.concat(
                [st.session_state.manual_transactions, pd.DataFrame([row])],
                ignore_index=True,
            )
            st.success(f"Added {new_id} ({m_keyword}, ${m_amount:,.2f})")

if not st.session_state.manual_transactions.empty:
    st.caption(f"{len(st.session_state.manual_transactions)} manually-added transaction(s)")
    st.dataframe(
        st.session_state.manual_transactions[["transaction_id", "date", "keyword", "amount_cad", "direction", "scope"]],
        use_container_width=True,
        hide_index=True,
    )
    if st.button("Clear manual transactions"):
        st.session_state.manual_transactions = pd.DataFrame(columns=TRANSACTION_COLUMNS)
        st.rerun()

# ---------------------------------------------------------------------------
# Step 3: Results
# ---------------------------------------------------------------------------

st.header("3. Results")

if sheets is None and st.session_state.manual_transactions.empty:
    st.warning("Upload a workbook and/or add transactions manually to see results.")
    st.stop()

# Combine uploaded transactions with manual entries
if sheets is not None:
    tx_df = pd.concat([sheets["Transactions"], st.session_state.manual_transactions], ignore_index=True)
else:
    # no uploaded workbook — manual-only mode, income classification only, no zakat calc
    tx_df = st.session_state.manual_transactions

tx_df["date"] = pd.to_datetime(tx_df["date"])

income_result = classify_transactions(tx_df)

if sheets is not None:
    asset_result = classify_assets(sheets["Assets"])
    debt_result = classify_debts(sheets["Debts"])
    profile = profile_to_dict(sheets["User_Profile"])
    nisab = float(profile["selected_nisab_cad"])
    calc_date_raw = profile["calculation_date"]
    calc_date = calc_date_raw if isinstance(calc_date_raw, datetime) else pd.to_datetime(calc_date_raw)
    hawl_result = check_hawl(sheets["Wealth_History"], nisab, calc_date)

    net_zakatable_wealth = round(
        asset_result["totals"]["zakatable_assets_total"] - debt_result["total_debt"], 2
    )
    zakat_due = net_zakatable_wealth >= nisab and hawl_result["hawl_satisfied"]
    zakat_amount = round(net_zakatable_wealth * 0.025, 2) if zakat_due else 0.0
else:
    asset_result = debt_result = hawl_result = None
    nisab = net_zakatable_wealth = zakat_amount = None
    zakat_due = False

# --- Summary cards ---
st.subheader("Income summary")
c1, c2, c3, c4 = st.columns(4)
c1.metric("Halal income", f"${income_result['totals']['halal_income']:,.2f}")
c2.metric("Haram income (separated)", f"${income_result['totals']['haram_income']:,.2f}")
c3.metric("Mixed — halal portion", f"${income_result['totals']['mixed_income_halal_portion']:,.2f}")
c4.metric("Mixed — haram portion", f"${income_result['totals']['mixed_income_haram_portion']:,.2f}")

if asset_result is not None:
    st.subheader("Zakat summary (Hanbali)")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Zakatable assets", f"${asset_result['totals']['zakatable_assets_total']:,.2f}")
    c2.metric("Total debts subtracted", f"${debt_result['total_debt']:,.2f}")
    c3.metric("Net zakatable wealth", f"${net_zakatable_wealth:,.2f}")
    c4.metric("Nisab", f"${nisab:,.2f}")

    c1, c2, c3 = st.columns(3)
    c1.metric("Meets nisab?", "Yes" if net_zakatable_wealth >= nisab else "No")
    c2.metric("Hawl satisfied?", "Yes" if hawl_result["hawl_satisfied"] else "No")
    c3.metric("Zakat due", f"${zakat_amount:,.2f}" if zakat_due else "$0.00 (not due)")

    st.caption(hawl_result["reason"])

    if asset_result["totals"]["haram_or_prohibited_assets_total"] > 0:
        st.error(
            f"⚠️ ${asset_result['totals']['haram_or_prohibited_assets_total']:,.2f} in haram/prohibited "
            "wealth identified. This is excluded from zakat and should be disposed of appropriately — "
            "removing it is not the same as paying zakat."
        )

# --- Warnings ---
all_warnings = income_result["warnings"] + (asset_result["warnings"] if asset_result else [])
if all_warnings:
    st.subheader(f"⚠️ Needs attention ({len(all_warnings)})")
    for w in all_warnings:
        label = w.get("transaction_id") or w.get("asset_id")
        st.warning(f"**{label}** — {w['classification']}: {w['reason']}")

# --- Transaction table ---
st.subheader("Every transaction, classified")
tx_table = pd.DataFrame(income_result["transactions"])
classification_filter = st.multiselect(
    "Filter by classification",
    options=["Halal", "Haram", "Mixed", "Tentative", "Missing Information"],
    default=[],
)
show_tx = tx_table
if classification_filter:
    show_tx = show_tx[show_tx["classification"].isin(classification_filter)]
st.dataframe(
    show_tx[["transaction_id", "date", "keyword", "amount_cad", "classification",
             "halal_amount", "haram_amount", "counts_as_income", "explanation"]],
    use_container_width=True,
    hide_index=True,
)

# --- Asset table ---
if asset_result is not None:
    st.subheader("Every asset, classified")
    asset_table = pd.DataFrame(asset_result["assets"])
    st.dataframe(
        asset_table[["asset_id", "description", "amount_cad", "zakatable", "category", "explanation"]],
        use_container_width=True,
        hide_index=True,
    )

    st.subheader("Every debt")
    debt_table = pd.DataFrame(debt_result["debts"])
    st.dataframe(debt_table, use_container_width=True, hide_index=True)

    with st.expander("Hawl check — month by month"):
        st.dataframe(pd.DataFrame(hawl_result["history"]), use_container_width=True, hide_index=True)

st.divider()
st.caption(
    "These are simplified organizer-provided rules created for this hackathon and community "
    "exercise, not formal fatwas or authoritative statements of any madhhab. Unresolved or "
    "tentative cases should be directed to a qualified scholar."
)
