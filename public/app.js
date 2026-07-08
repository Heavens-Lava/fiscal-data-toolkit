// app.js — dashboard data, live mini-charts (Chart.js), and the charts gallery.

// ── formatting helpers ───────────────────────────────────────────────────────
const T = (n) => { if (n == null) return "–"; const a = Math.abs(n), s = n < 0 ? "-" : "";
  return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` :
         a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : `${s}$${a.toFixed(0)}`; };
const P = (n) => n == null ? "–" : `${(n * 100).toFixed(1)}%`;
const X = (n) => n == null ? "–" : `${n.toFixed(1)}x`;
const signCls = (n) => n < 0 ? "neg" : "pos";
const row = (k, v, cls = "") => `<div class="kv"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
const errCard = (label, msg) => `<div class="card"><h3>${label}</h3><div class="err-card">⚠ ${msg}</div></div>`;

// ── mini live charts (Chart.js) ──────────────────────────────────────────────
function miniLine(canvas, values, color, fmt = (v) => v) {
  if (!canvas) return;
  const vals = (values || []).filter(Number.isFinite);
  if (vals.length < 2) { canvas.closest(".chart-box")?.classList.add("hidden"); return; }
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 110);
  grad.addColorStop(0, color + "3d");
  grad.addColorStop(1, color + "00");
  new Chart(ctx, {
    type: "line",
    data: { labels: vals.map((_, i) => i), datasets: [{
      data: vals, borderColor: color, backgroundColor: grad, fill: true,
      tension: 0.35, pointRadius: 0, borderWidth: 2.25, pointHoverRadius: 4, pointHoverBackgroundColor: color,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0b0b0b", padding: 8, cornerRadius: 8, displayColors: false,
          callbacks: { title: () => "", label: (c) => fmt(c.parsed.y) },
        },
      },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

function ratesChart(canvas, rateHistory) {
  if (!canvas || !rateHistory?.length) return;
  const ctx = canvas.getContext("2d");
  const mk = (key, color) => ({
    label: key, data: rateHistory.map((r) => r[key]), borderColor: color, backgroundColor: "transparent",
    tension: 0.3, pointRadius: 0, borderWidth: 2.25, spanGaps: true,
  });
  new Chart(ctx, {
    type: "line",
    data: {
      labels: rateHistory.map((r) => r.year),
      datasets: [
        mk("fedFunds", "#d29922"), mk("tenYear", "#2a78d6"), mk("mortgage", "#1baf7a"),
      ].map((d, i) => ({ ...d, label: ["Fed funds", "10-yr Treasury", "30-yr mortgage"][i] })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { position: "top", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", font: { size: 12 } } },
        tooltip: { backgroundColor: "#0b0b0b", padding: 10, cornerRadius: 8, callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y?.toFixed(2)}%` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#898781", font: { size: 11 } } },
        y: { grid: { color: "#e1e0d9" }, ticks: { color: "#898781", font: { size: 11 }, callback: (v) => v + "%" } },
      },
    },
  });
}

// ── live macro dashboard ─────────────────────────────────────────────────────
async function loadDash() {
  const d = await (await fetch("/api/dashboard")).json();
  document.getElementById("ts").textContent = "Live — updated " + new Date().toLocaleString();
  const cards = [];

  if (d.fiscal.ok) { const f = d.fiscal.data; cards.push(`
    <div class="card">
      <h3>Government — FY${f.fy}</h3>
      <div class="stat-row"><span class="big">${T(f.debt)}</span><span class="delta neg">national debt</span></div>
      <div class="chart-box"><canvas id="c-fiscal"></canvas></div>
      ${row("Receipts (taxes)", T(f.receipts), "accent")}
      ${row("Outlays (spending)", T(f.outlays))}
      ${row("Deficit", T(f.deficit), "neg")}
      ${row("Interest so far", T(f.interestFytd), "neg")}
      <div class="footnote">Borrowing $${(f.deficit / f.outlays).toFixed(2)} of every $1 spent.</div>
    </div>`); } else cards.push(errCard("Government", d.fiscal.error));

  if (d.trade.ok) { const t = d.trade.data; cards.push(`
    <div class="card">
      <h3>Trade & World</h3>
      <div class="stat-row"><span class="big">${T(t.niip)}</span><span class="delta neg">net int'l position</span></div>
      <div class="chart-box"><canvas id="c-trade"></canvas></div>
      ${row("Current account /qtr", T(t.currentAccount), "neg")}
      ${row("% of GDP", P(t.caPctGdp / 100), "neg")}
      ${row("Trade balance /mo", T(t.tradeBalance), "neg")}
      <div class="footnote">The world owns ${T(-t.niip)} more of the US than vice-versa.</div>
    </div>`); } else cards.push(errCard("Trade & World", d.trade.error));

  if (d.money.ok) { const m = d.money.data; cards.push(`
    <div class="card">
      <h3>Money</h3>
      <div class="stat-row"><span class="big">${T(m.m2)}</span><span class="delta pos">M2 supply</span></div>
      <div class="chart-box"><canvas id="c-money"></canvas></div>
      ${row("Cash in circulation", T(m.cash))}
      ${row("Printed 2020–21", T(m.printed2020_21), "neg")}
      ${row("…growth", "+" + m.printedPct.toFixed(0) + "%", "neg")}
      <div class="footnote">~40% of all dollars were created in two years.</div>
    </div>`); } else cards.push(errCard("Money", d.money.error));

  if (d.banking.ok) { const b = d.banking.data; cards.push(`
    <div class="card">
      <h3>Banks — ${b.quarter}</h3>
      <div class="stat-row"><span class="big">${T(b.assets)}</span><span class="delta pos">total assets</span></div>
      <div class="chart-box"><canvas id="c-banks"></canvas></div>
      ${row("Banks", b.banks.toLocaleString())}
      ${row("Deposits", T(b.deposits))}
      ${row("Securities held", T(b.securities), "accent")}
      ${row("Equity cushion", T(b.equity) + " (" + P(b.equity / b.assets) + ")")}
      <div class="footnote">Securities are mostly gov't debt — the 2023 SVB risk.</div>
    </div>`); } else cards.push(errCard("Banks", d.banking.error));

  if (d.markets?.ok) { const k = d.markets.data; cards.push(`
    <div class="card">
      <h3>Markets & Rates</h3>
      <div class="stat-row"><span class="big">${k.sp500.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span><span class="delta pos">S&amp;P 500</span></div>
      <div class="chart-box"><canvas id="c-markets"></canvas></div>
      ${row("Fed funds rate", k.fedFunds.toFixed(2) + "%", "accent")}
      ${row("10-yr Treasury", k.tenYear.toFixed(2) + "%")}
      ${row("30-yr mortgage", k.mortgage30.toFixed(2) + "%")}
      <div class="footnote">Fed sets the short rate; the 10-yr drives mortgages (≈10-yr + 2%).</div>
    </div>`); } else if (d.markets) cards.push(errCard("Markets", d.markets.error));

  if (d.housing?.ok) { const h = d.housing.data; cards.push(`
    <div class="card">
      <h3>Housing</h3>
      <div class="stat-row"><span class="big">$${(h.medianPrice / 1000).toFixed(0)}K</span><span class="delta ${h.caseShillerYoY >= 0 ? "pos" : "neg"}">median price</span></div>
      <div class="chart-box"><canvas id="c-housing"></canvas></div>
      ${row("Home prices YoY", (h.caseShillerYoY >= 0 ? "+" : "") + h.caseShillerYoY.toFixed(1) + "%", h.caseShillerYoY >= 0 ? "pos" : "neg")}
      ${row("30-yr mortgage", h.mortgage30.toFixed(2) + "%")}
      ${row("Housing starts", (h.housingStarts / 1000).toFixed(2) + "M/yr")}
      <div class="footnote">High rates froze the market: prices flat, few sellers (lock-in effect).</div>
    </div>`); } else if (d.housing) cards.push(errCard("Housing", d.housing.error));

  document.getElementById("cards").innerHTML = cards.join("");

  if (d.fiscal.ok) miniLine(document.getElementById("c-fiscal"), d.fiscal.data.debtHistory, "#e34948", T);
  if (d.trade.ok) miniLine(document.getElementById("c-trade"), d.trade.data.niipHistory, "#e34948", T);
  if (d.money.ok) miniLine(document.getElementById("c-money"), d.money.data.m2History, "#2a78d6", T);
  if (d.banking.ok) miniLine(document.getElementById("c-banks"), d.banking.data.assetsHistory, "#1baf7a", T);
  if (d.markets?.ok) miniLine(document.getElementById("c-markets"), d.markets.data.sp500History, "#1baf7a", (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  if (d.housing?.ok) miniLine(document.getElementById("c-housing"), d.housing.data.caseShillerHistory, "#d29922", (v) => v.toFixed(1));

  if (d.markets?.ok && d.markets.data.rateHistory) {
    const rh = d.markets.data.rateHistory;
    ratesChart(document.getElementById("c-rates"), rh);
    const body = rh.map((r) => `<tr>
      <td>${r.year}</td>
      <td class="v accent">${r.fedFunds != null ? r.fedFunds.toFixed(2) + "%" : "–"}</td>
      <td>${r.tenYear != null ? r.tenYear.toFixed(2) + "%" : "–"}</td>
      <td>${r.mortgage != null ? r.mortgage.toFixed(2) + "%" : "–"}</td></tr>`).join("");
    document.getElementById("rates-table-body").innerHTML = body;
    document.getElementById("rates-card").classList.remove("hidden");
  }
}

// ── company lookup ───────────────────────────────────────────────────────────
async function loadStock() {
  const tk = document.getElementById("ticker").value.trim().toUpperCase();
  if (!tk) return;
  const btn = document.getElementById("go"); btn.disabled = true; btn.textContent = "…";
  const el = document.getElementById("stock");
  try {
    const s = await (await fetch("/api/stock?ticker=" + encodeURIComponent(tk))).json();
    if (s.error) throw new Error(s.error);
    const rows = s.series.map((y) => `<tr>
      <td>${y.year}</td><td>${T(y.revenue)}</td>
      <td class="v ${y.revGrowth >= 0 ? "pos" : "neg"}">${P(y.revGrowth)}</td>
      <td>${P(y.grossMargin)}</td>
      <td class="v ${(y.netIncome ?? 0) >= 0 ? "pos" : "neg"}">${T(y.netIncome)}</td>
      <td class="v ${(y.netMargin ?? 0) >= 0 ? "pos" : "neg"}">${P(y.netMargin)}</td>
      <td>${T(y.ocf)}</td>
      <td class="v ${(y.fcf ?? 0) >= 0 ? "pos" : "neg"}">${T(y.fcf)}</td></tr>`).join("");
    el.innerHTML = `
      <div class="card">
        <h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--ink)">${s.name} (${s.ticker})</h3>
        <div class="scroll"><table class="data" style="margin-top:14px">
          <tr><th>Year</th><th>Revenue</th><th>Growth</th><th>GrossMgn</th><th>NetIncome</th><th>NetMgn</th><th>OpCashFlow</th><th>FreeCashFlow</th></tr>
          ${rows}
          <tr style="font-weight:700"><td>TTM</td><td>${T(s.ttm.revenue)}</td><td>–</td><td>–</td>
            <td class="v ${(s.ttm.netIncome ?? 0) >= 0 ? "pos" : "neg"}">${T(s.ttm.netIncome)}</td>
            <td class="v ${(s.ttm.netMargin ?? 0) >= 0 ? "pos" : "neg"}">${P(s.ttm.netMargin)}</td>
            <td>${T(s.ttm.ocf)}</td>
            <td class="v ${(s.ttm.fcf ?? 0) >= 0 ? "pos" : "neg"}">${T(s.ttm.fcf)}</td></tr>
        </table></div>
        <div class="val-grid">
          <div class="val"><div class="l">Price</div><div class="n">$${s.price?.toFixed(2) ?? "–"}</div></div>
          <div class="val"><div class="l">Market cap</div><div class="n">${T(s.marketCap)}</div></div>
          <div class="val"><div class="l">P / Sales</div><div class="n">${X(s.ps)}</div></div>
          <div class="val"><div class="l">P / Earnings</div><div class="n">${s.pe ? X(s.pe) : "n/a"}</div></div>
          <div class="val"><div class="l">P / Cash Flow</div><div class="n">${X(s.pcf)}</div></div>
          <div class="val"><div class="l">P / Free CF</div><div class="n">${s.pfcf ? X(s.pfcf) : "n/a"}</div></div>
        </div>
        <div class="footnote">Free Cash Flow = operating cash − capex. Negative FCF (Oracle-style) = burning cash on buildout despite "profits". High P/S, P/E, P/CF = priced for perfection.</div>
      </div>`;
  } catch (e) { el.innerHTML = `<div class="err-card">⚠ ${e.message}</div>`; }
  btn.disabled = false; btn.textContent = "Look up";
}

// ── growth + valuation screener ──────────────────────────────────────────────
let screenData = [], sortKey = "revGrowth", sortDir = -1;
function flagFor(r) { const hot = r.revGrowth >= 0.2 && r.marginChg > 0, cheap = r.ps != null && r.ps < 10;
  return hot && cheap ? "💎" : hot ? "🚀" : r.revGrowth >= 0.2 ? "📈" : ""; }
function renderScreen() {
  const cols = [["ticker", "Ticker"], ["revGrowth", "RevGrowth"], ["grossMargin", "GrossMgn"],
    ["marginChg", "MgnChg"], ["netMargin", "NetMgn"], ["ps", "P/S"], ["pcf", "P/CF"], ["flag", "Flag"]];
  const rows = [...screenData].sort((a, b) => {
    if (sortKey === "flag" || sortKey === "ticker") {
      const av = sortKey === "flag" ? flagFor(a) : a.ticker, bv = sortKey === "flag" ? flagFor(b) : b.ticker;
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    }
    return ((a[sortKey] ?? -1e9) - (b[sortKey] ?? -1e9)) * sortDir;
  });
  const head = cols.map((c) => `<th data-k="${c[0]}">${c[1]}${sortKey === c[0] ? (sortDir < 0 ? " ▾" : " ▴") : ""}</th>`).join("");
  const body = rows.map((r) => `<tr>
    <td>${r.ticker}</td>
    <td class="v ${r.revGrowth >= 0 ? "pos" : "neg"}">${P(r.revGrowth)}</td>
    <td>${P(r.grossMargin)}</td>
    <td class="v ${(r.marginChg ?? 0) >= 0 ? "pos" : "neg"}">${r.marginChg == null ? "–" : (r.marginChg >= 0 ? "+" : "") + (r.marginChg * 100).toFixed(1) + "pp"}</td>
    <td class="v ${(r.netMargin ?? 0) >= 0 ? "pos" : "neg"}">${P(r.netMargin)}</td>
    <td>${X(r.ps)}</td><td>${X(r.pcf)}</td><td>${flagFor(r)}</td></tr>`).join("");
  document.getElementById("screen").innerHTML = `<div class="card scroll"><table class="data"><tr>${head}</tr>${body}</table></div>`;
  document.querySelectorAll("#screen th").forEach((th) => th.onclick = () => {
    const k = th.dataset.k; if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = -1; } renderScreen();
  });
}
async function loadScreen() {
  try { screenData = await (await fetch("/api/screen")).json(); renderScreen(); }
  catch (e) { document.getElementById("screen").innerHTML = `<div class="err-card">⚠ ${e.message}</div>`; }
}

// ── charts gallery ────────────────────────────────────────────────────────────
let galleryTopics = [], activeCategory = "All", gallerySearch = "";

function galleryCard(t) {
  return `<div class="gcard" data-topic="${t.topic}">
    <div class="thumb">
      ${t.files.png ? `<img loading="lazy" src="/social/${t.files.png}" alt="${t.label}">` : ""}
    </div>
    <div class="body">
      <span class="tag">${t.category}</span>
      <div class="title">${t.label}</div>
      <div class="date">${t.date}</div>
      ${t.caption ? `<div class="cap">${escapeHtml(t.caption)}</div>` : ""}
    </div>
  </div>`;
}
function escapeHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderGallery() {
  const q = gallerySearch.trim().toLowerCase();
  const filtered = galleryTopics.filter((t) =>
    (activeCategory === "All" || t.category === activeCategory) &&
    (!q || t.label.toLowerCase().includes(q) || t.caption.toLowerCase().includes(q)));
  const grid = document.getElementById("gallery-grid");
  if (!filtered.length) {
    grid.innerHTML = "";
    document.getElementById("gallery-empty").classList.remove("hidden");
    return;
  }
  document.getElementById("gallery-empty").classList.add("hidden");
  grid.innerHTML = filtered.map(galleryCard).join("");
  grid.querySelectorAll(".gcard").forEach((card) => {
    card.onclick = () => openLightbox(filtered.find((t) => t.topic === card.dataset.topic));
  });
}

function openLightbox(t) {
  const lb = document.getElementById("lightbox");
  document.getElementById("lb-content").innerHTML = `
    <div class="lb-head">
      <div>
        <div class="eyebrow">${t.category}</div>
        <h3>${t.label}</h3>
        <div class="lb-date">Data through ${t.date}</div>
      </div>
      <button class="lb-close" id="lb-close-btn">✕</button>
    </div>
    ${t.files.png ? `<img src="/social/${t.files.png}" alt="${t.label}">` : `<div class="footnote">No image was rendered for this topic — see the data links below.</div>`}
    <div class="lb-body">
      ${t.caption ? `<div class="lb-cap">${escapeHtml(t.caption)}</div>` : ""}
      <div class="lb-links">
        ${t.files.html ? `<a class="btn ghost" href="/social/${t.files.html}" target="_blank" rel="noopener">Open interactive chart ↗</a>` : ""}
        ${t.files.csv ? `<a class="btn ghost" href="/social/${t.files.csv}" download>Download data (CSV)</a>` : ""}
      </div>
    </div>`;
  lb.classList.remove("hidden");
  document.getElementById("lb-close-btn").onclick = closeLightbox;
}
function closeLightbox() { document.getElementById("lightbox").classList.add("hidden"); }

async function loadGallery() {
  try {
    const d = await (await fetch("/api/gallery")).json();
    galleryTopics = d.topics || [];
    const cats = ["All", ...d.categories.filter((c) => galleryTopics.some((t) => t.category === c))];
    document.getElementById("gallery-pills").innerHTML = cats.map((c) =>
      `<button class="pill ${c === "All" ? "active" : ""}" data-cat="${c}">${c}</button>`).join("");
    document.querySelectorAll("#gallery-pills .pill").forEach((p) => p.onclick = () => {
      document.querySelectorAll("#gallery-pills .pill").forEach((x) => x.classList.remove("active"));
      p.classList.add("active"); activeCategory = p.dataset.cat; renderGallery();
    });
    renderGallery();
  } catch (e) {
    document.getElementById("gallery-grid").innerHTML = `<div class="err-card">⚠ ${e.message}</div>`;
  }
}

// ── wire up ───────────────────────────────────────────────────────────────────
document.getElementById("go").onclick = loadStock;
document.getElementById("ticker").addEventListener("keydown", (e) => { if (e.key === "Enter") loadStock(); });
document.getElementById("gallery-search-input").addEventListener("input", (e) => { gallerySearch = e.target.value; renderGallery(); });
document.getElementById("rates-toggle").addEventListener("click", () => {
  const t = document.getElementById("rates-table-wrap");
  const open = !t.classList.contains("hidden");
  t.classList.toggle("hidden");
  document.getElementById("rates-toggle").textContent = open ? "Show exact figures ▾" : "Hide exact figures ▴";
});
document.getElementById("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

loadDash().catch((e) => document.getElementById("cards").innerHTML = `<div class="err-card">⚠ ${e.message}</div>`);
loadStock();
loadScreen();
loadGallery();
