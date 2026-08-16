const $ = (id) => document.getElementById(id);

const MIXED_KEYWORDS = ["mixed_income_disposed", "mixed_income_retained", "mixed_income_missing_split"];
const CRYPTO_COST_BASIS_KEYWORD = "crypto_sale_with_cost_basis";

let activeFilter = null;
let lastResults = null;

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  loadKeywords();
  refreshResults();

  $("upload-form").addEventListener("submit", handleUpload);
  $("manual-form").addEventListener("submit", handleAddTransaction);
  $("reset-manual-btn").addEventListener("click", handleResetManual);
  $("m-keyword").addEventListener("change", updateConditionalFields);
});

async function loadKeywords() {
  const res = await fetch("/api/keywords");
  const groups = await res.json();
  const select = $("m-keyword");
  select.innerHTML = "";
  for (const [groupName, kws] of Object.entries(groups)) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = groupName;
    for (const kw of kws) {
      const opt = document.createElement("option");
      opt.value = kw;
      opt.textContent = kw;
      optgroup.appendChild(opt);
    }
    select.appendChild(optgroup);
  }
  updateConditionalFields();
}

function updateConditionalFields() {
  const kw = $("m-keyword").value;
  $("m-mixed-fields").hidden = !(MIXED_KEYWORDS.includes(kw) && kw !== "mixed_income_missing_split");
  $("m-cost-basis-fields").hidden = kw !== CRYPTO_COST_BASIS_KEYWORD;
  $("m-missing-fields").hidden = !(kw.startsWith("missing_info") || kw === "crypto_sale_missing_cost_basis" || kw === "mixed_income_missing_split");
}

// ---------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------

async function handleUpload(e) {
  e.preventDefault();
  const file = $("file-input").files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  $("upload-status").textContent = "Uploading...";
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (!res.ok) {
    $("upload-status").textContent = "Error: " + data.error;
    return;
  }
  $("upload-status").textContent = "Loaded successfully.";
  render(data);
}

async function handleAddTransaction(e) {
  e.preventDefault();
  const kw = $("m-keyword").value;

  const payload = {
    date: $("m-date").value || null,
    keyword: kw,
    amount_cad: parseFloat($("m-amount").value),
    direction: $("m-direction").value,
    scope: $("m-scope").value,
    merchant_or_source: $("m-merchant").value,
    description: $("m-description").value,
    mixed_halal_pct: MIXED_KEYWORDS.includes(kw) && kw !== "mixed_income_missing_split" ? parseFloat($("m-pct").value) : null,
    haram_portion_disposed: MIXED_KEYWORDS.includes(kw) && kw !== "mixed_income_missing_split" ? $("m-disposed").value : null,
    cost_basis_cad: kw === CRYPTO_COST_BASIS_KEYWORD ? parseFloat($("m-cost-basis").value) || null : null,
    missing_information: $("m-missing").value || null,
  };

  const res = await fetch("/api/transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error); return; }
  $("manual-form").reset();
  updateConditionalFields();
  render(data);
}

async function handleResetManual() {
  const res = await fetch("/api/transactions/reset", { method: "POST" });
  render(await res.json());
}

async function refreshResults() {
  const res = await fetch("/api/results");
  render(await res.json());
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function money(n) {
  return "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function metric(label, value) {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function badge(classification) {
  const map = {
    "Halal": "badge-halal", "Haram": "badge-haram", "Mixed": "badge-mixed",
    "Tentative": "badge-tentative", "Missing Information": "badge-missing",
  };
  return `<span class="badge ${map[classification] || ""}">${classification}</span>`;
}

function render(data) {
  lastResults = data;

  if (!data.has_data) {
    $("no-data-message").hidden = false;
    $("results-content").hidden = true;
    return;
  }
  $("no-data-message").hidden = true;
  $("results-content").hidden = false;

  renderIncomeSummary(data.income_classification.totals);
  renderTransactionFilters(data.income_classification.transactions);
  renderTransactionsTable(data.income_classification.transactions);

  if (data.zakat_summary) {
    $("zakat-block").hidden = false;
    $("asset-debt-block").hidden = false;
    renderZakatSummary(data.zakat_summary, data.hawl_check);
    renderAssetsTable(data.asset_classification.assets);
    renderDebtsTable(data.debts.debts);
    renderHawlTable(data.hawl_check.history);

    const haramTotal = data.asset_classification.totals.haram_or_prohibited_assets_total;
    const haramEl = $("haram-asset-warning");
    if (haramTotal > 0) {
      haramEl.hidden = false;
      haramEl.textContent = `⚠️ ${money(haramTotal)} in haram/prohibited wealth identified. Excluded from zakat — should be disposed of appropriately, not spent. Removing it is not the same as paying zakat.`;
    } else {
      haramEl.hidden = true;
    }
  } else {
    $("zakat-block").hidden = true;
    $("asset-debt-block").hidden = true;
  }

  renderWarnings(data.warnings);
}

function renderIncomeSummary(totals) {
  $("income-summary").innerHTML = [
    metric("Halal income", money(totals.halal_income)),
    metric("Haram income (separated)", money(totals.haram_income)),
    metric("Mixed — halal portion", money(totals.mixed_income_halal_portion)),
    metric("Mixed — haram portion", money(totals.mixed_income_haram_portion)),
  ].join("");
}

function renderZakatSummary(z, hawl) {
  $("zakat-summary").innerHTML = [
    metric("Zakatable assets", money(z.zakatable_assets_total)),
    metric("Total debts subtracted", money(z.total_debts_subtracted)),
    metric("Net zakatable wealth", money(z.net_zakatable_wealth)),
    metric("Nisab", money(z.nisab_cad)),
    metric("Meets nisab?", z.meets_nisab ? "Yes" : "No"),
    metric("Hawl satisfied?", z.hawl_satisfied ? "Yes" : "No"),
    metric("Zakat due", z.zakat_due ? money(z.zakat_amount_cad) : "$0.00 (not due)"),
  ].join("");
  $("hawl-reason").textContent = hawl.reason;
}

function renderWarnings(warnings) {
  const block = $("warnings-block");
  const list = $("warnings-list");
  if (!warnings.length) { block.hidden = true; return; }
  block.hidden = false;
  list.innerHTML = warnings.map(w => {
    const label = w.transaction_id || w.asset_id;
    return `<div><strong>${label}</strong> — ${badge(w.classification)} ${w.reason}</div>`;
  }).join("");
}

function renderTransactionFilters(transactions) {
  const classes = ["Halal", "Haram", "Mixed", "Tentative", "Missing Information"];
  $("classification-filters").innerHTML = classes.map(c =>
    `<button data-filter="${c}" class="${activeFilter === c ? "active" : ""}">${c}</button>`
  ).join("") + `<button data-filter="" class="${activeFilter === null ? "active" : ""}">All</button>`;

  document.querySelectorAll("#classification-filters button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter || null;
      render(lastResults);
    });
  });
}

function renderTransactionsTable(transactions) {
  const rows = activeFilter ? transactions.filter(t => t.classification === activeFilter) : transactions;
  const headers = ["ID", "Date", "Keyword", "Amount", "Classification", "Halal $", "Haram $", "Counts as income?", "Explanation"];
  const table = $("transactions-table");
  table.innerHTML = "<thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead>" +
    "<tbody>" + rows.map(t => `<tr>
      <td>${t.transaction_id}</td>
      <td>${t.date ?? ""}</td>
      <td>${t.keyword}</td>
      <td>${money(t.amount_cad)}</td>
      <td>${badge(t.classification)}</td>
      <td>${money(t.halal_amount)}</td>
      <td>${money(t.haram_amount)}</td>
      <td>${t.counts_as_income ? "Yes" : "No"}</td>
      <td class="explanation">${t.explanation}</td>
    </tr>`).join("") + "</tbody>";
}

function renderAssetsTable(assets) {
  const headers = ["ID", "Description", "Amount", "Zakatable?", "Category", "Explanation"];
  const table = $("assets-table");
  table.innerHTML = "<thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead>" +
    "<tbody>" + assets.map(a => `<tr>
      <td>${a.asset_id}</td>
      <td class="description">${a.description ?? ""}</td>
      <td>${money(a.amount_cad)}</td>
      <td>${a.zakatable ? "Yes" : "No"}</td>
      <td>${a.category}</td>
      <td class="explanation">${a.explanation}</td>
    </tr>`).join("") + "</tbody>";
}

function renderDebtsTable(debts) {
  const headers = ["ID", "Creditor", "Keyword", "Outstanding balance", "Interest-bearing?", "Explanation"];
  const table = $("debts-table");
  table.innerHTML = "<thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead>" +
    "<tbody>" + debts.map(d => `<tr>
      <td>${d.debt_id}</td>
      <td>${d.creditor}</td>
      <td>${d.keyword}</td>
      <td>${money(d.outstanding_balance_cad)}</td>
      <td>${d.interest_bearing ? "Yes" : "No"}</td>
      <td class="explanation">${d.explanation}</td>
    </tr>`).join("") + "</tbody>";

  const interestTotal = debts.filter(d => d.interest_bearing).reduce((s, d) => s + d.outstanding_balance_cad, 0);
  $("interest-note").textContent = interestTotal > 0
    ? `${money(interestTotal)} of the total debt is on interest-bearing accounts. The interest itself is impermissible, but the outstanding balance is still subtracted as a real liability.`
    : "";
}

function renderHawlTable(history) {
  const headers = ["Month end", "Approx. zakatable wealth", "Above nisab?", "Event note"];
  const table = $("hawl-table");
  table.innerHTML = "<thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead>" +
    "<tbody>" + history.map(h => `<tr>
      <td>${h.month_end}</td>
      <td>${money(h.approx_zakatable_wealth)}</td>
      <td>${h.above_nisab ? "Yes" : "No"}</td>
      <td>${h.event_note ?? ""}</td>
    </tr>`).join("") + "</tbody>";
}
