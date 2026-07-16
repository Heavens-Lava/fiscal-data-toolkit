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
function escapeHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

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
  lb.querySelector(".box").classList.remove("image-preview");
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

function openApprovalImage(p) {
  const lb = document.getElementById("lightbox");
  lb.querySelector(".box").classList.add("image-preview");
  document.getElementById("lb-content").innerHTML = `
    <div class="lb-body">
      <div class="lb-head">
        <div>
          <div class="eyebrow">Facebook approval preview</div>
          <h3>${escapeHtml(p.topic)}</h3>
          <div class="lb-date">${escapeHtml(p.date)}</div>
        </div>
        <button class="lb-close" id="lb-close-btn" aria-label="Close image preview">X</button>
      </div>
    </div>
    <img src="/social/${encodeURIComponent(p.files.png)}" alt="Full-size chart for ${escapeHtml(p.topic)}">`;
  lb.classList.remove("hidden");
  document.getElementById("lb-close-btn").onclick = closeLightbox;
  document.getElementById("lb-close-btn").focus();
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  lb.classList.add("hidden");
  lb.querySelector(".box").classList.remove("image-preview");
}

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

// ── approvals queue ───────────────────────────────────────────────────────────
let approvalSession = null;

async function approvalRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function localInputValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleValue() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return localInputValue(date);
}

function approvalCard(p) {
  const statusCls = p.status === "ready" ? "pos" : p.status === "ready with notes" ? "accent" : "neg";
  const notes = [...p.problems, ...p.warnings];
  const defaultMedia = p.hasImage ? "image" : p.hasVideo ? "video" : "text";
  const options = [
    p.hasImage ? `<option value="image">Chart image + caption</option>` : "",
    p.hasVideo ? `<option value="video">Video + caption</option>` : "",
    `<option value="text">Caption only</option>`,
  ].join("");
  return `<div class="card approval-card" data-topic="${escapeHtml(p.topic)}" data-date="${escapeHtml(p.date)}">
    <div class="thumb">
      ${p.hasImage ? `<img class="approval-preview-image" loading="lazy" src="/social/${encodeURIComponent(p.files.png)}" alt="${escapeHtml(p.topic)}" role="button" tabindex="0" aria-label="Open full-size chart for ${escapeHtml(p.topic)}">`
        : p.hasVideo ? `<video src="/social/${encodeURIComponent(p.files.mp4)}" controls preload="metadata"></video>`
        : `<div class="footnote" style="padding:24px">Caption-only post</div>`}
    </div>
    <h3>${escapeHtml(p.topic)} <span class="v ${statusCls}" style="text-transform:none;font-weight:700">${escapeHtml(p.status)} · ${p.score}</span></h3>
    <div class="date">${escapeHtml(p.date)}</div>
    <div class="caption" style="white-space:pre-wrap;max-height:220px;overflow:auto">${escapeHtml(p.caption)}</div>
    ${notes.length ? `<div class="footnote">${escapeHtml(notes.join("; "))}</div>` : ""}
    <div class="media-choice"><label>Facebook attachment</label><select class="media-select">${options}</select></div>
    <div class="schedule-choice">
      <input class="schedule-at" type="datetime-local" value="${defaultScheduleValue()}" aria-label="Scheduled publish time">
      <button class="btn ghost schedule-btn" ${approvalSession?.facebookConfigured ? "" : "disabled"}>Schedule</button>
    </div>
    <div class="approval-actions">
      <button class="btn primary auto-schedule-btn" ${approvalSession?.facebookConfigured ? "" : "disabled"}>Approve next slot</button>
      <button class="btn ghost approve-btn" ${approvalSession?.facebookConfigured ? "" : "disabled"}>Publish now</button>
      <button class="btn ghost skip-btn">Skip</button>
    </div>
    <div class="approval-status"></div>
    <input type="hidden" class="default-media" value="${defaultMedia}">
  </div>`;
}

function renderScheduledPosts(scheduled) {
  const target = document.getElementById("scheduled-posts");
  if (!scheduled.length) {
    target.innerHTML = `<div class="scheduled-empty">No posts scheduled yet.</div>`;
    return;
  }
  target.innerHTML = scheduled.map((entry) => {
    const processing = entry.status === "processing";
    const stateLabel = processing
      ? " · publishing"
      : entry.status === "review"
        ? " · needs review"
        : entry.facebookPostId
          ? " · scheduled on Facebook"
          : " · local schedule";
    return `<div class="scheduled-row" data-topic="${escapeHtml(entry.topic)}" data-date="${escapeHtml(entry.date)}" data-media="${escapeHtml(entry.media)}">
      <div class="scheduled-title"><strong>${escapeHtml(entry.topic)}</strong><span>${escapeHtml(entry.media)}${stateLabel}</span></div>
      <input class="scheduled-at" type="datetime-local" value="${localInputValue(new Date(entry.scheduledAt))}" aria-label="Scheduled publish time" ${processing ? "disabled" : ""}>
      <button class="btn ghost reschedule-btn" ${processing ? "disabled" : ""}>Reschedule</button>
      <button class="btn ghost cancel-schedule-btn" ${processing ? "disabled" : ""}>Cancel</button>
    </div>`;
  }).join("");

  target.querySelectorAll(".scheduled-row").forEach((row) => {
    const { topic, date, media } = row.dataset;
    const input = row.querySelector(".scheduled-at");
    row.querySelector(".reschedule-btn").onclick = async () => {
      const when = new Date(input.value);
      if (!input.value || Number.isNaN(when.getTime())) return window.alert("Choose a valid date and time.");
      try {
        await approvalRequest("/api/approvals/schedule", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, date, media, scheduledAt: when.toISOString() }),
        });
        await loadApprovals();
      } catch (error) {
        window.alert(error.message);
      }
    };
    row.querySelector(".cancel-schedule-btn").onclick = async () => {
      if (!window.confirm(`Cancel the scheduled post for ${topic}?`)) return;
      try {
        await approvalRequest("/api/approvals/schedule/cancel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, date }),
        });
        await loadApprovals();
      } catch (error) {
        window.alert(error.message);
      }
    };
  });
}

function renderApprovalHistory(history) {
  const target = document.getElementById("approval-history");
  if (!history.length) {
    target.innerHTML = `<div class="gallery-empty">No decisions recorded yet.</div>`;
    return;
  }
  target.innerHTML = history.map((entry) => `<div class="approval-history-row">
    <strong>${escapeHtml(entry.topic)}</strong>
    <span class="${entry.status === "published" ? "pos" : entry.status === "publish_uncertain" || entry.status === "failed" ? "neg" : ""}">${escapeHtml(entry.status.replaceAll("_", " "))}</span>
    ${entry.error ? `<span class="caption">${escapeHtml(entry.error)}</span>` : ""}
    <span class="when">${escapeHtml(new Date(entry.at).toLocaleString())}</span>
  </div>`).join("");
}

function renderPublishing(scheduled, published, policy, failed = []) {
  const scheduledTarget = document.getElementById("publishing-scheduled-list");
  const postedTarget = document.getElementById("publishing-posted-list");
  const failedTarget = document.getElementById("publishing-failed-list");
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: policy.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const today = dayFormatter.format(new Date());
  const postedToday = published.filter((entry) => dayFormatter.format(new Date(entry.at)) === today).length;
  document.getElementById("publishing-policy").textContent = `${policy.slots.join(" and ")} | ${policy.timeZone}`;
  document.getElementById("publishing-summary").innerHTML = `
    <div><strong>${scheduled.length}</strong><span>scheduled</span></div>
    <div><strong>${postedToday}</strong><span>posted today</span></div>
    <div><strong>${published.length}</strong><span>recently posted</span></div>`;

  scheduledTarget.innerHTML = scheduled.length ? scheduled.map((entry, index) => {
    const status = entry.status === "processing" ? "Publishing" : entry.status === "review" ? "Needs review" : "Scheduled";
    return `<div class="publishing-row">
      <span class="publishing-rank">${index + 1}</span>
      <div><strong>${escapeHtml(entry.topic)}</strong><span>${escapeHtml(entry.media)} | ${escapeHtml(status)}</span></div>
      <time datetime="${escapeHtml(entry.scheduledAt)}">${escapeHtml(new Date(entry.scheduledAt).toLocaleString())}</time>
    </div>`;
  }).join("") : `<div class="scheduled-empty">No posts are currently scheduled.</div>`;

  postedTarget.innerHTML = published.length ? published.map((entry) => {
    const uncertain = entry.status === "publish_uncertain";
    const link = entry.permalinkUrl
      ? `<a href="${escapeHtml(entry.permalinkUrl)}" target="_blank" rel="noopener">Open post</a>`
      : `<span class="caption">No link recorded</span>`;
    return `<div class="publishing-row posted">
      <span class="publishing-state ${uncertain ? "uncertain" : "published"}">${uncertain ? "Check" : "Posted"}</span>
      <div><strong>${escapeHtml(entry.topic)}</strong><span>${escapeHtml(entry.media || "post")}</span></div>
      <time datetime="${escapeHtml(entry.at)}">${escapeHtml(new Date(entry.at).toLocaleString())}</time>
      ${link}
    </div>`;
  }).join("") : `<div class="scheduled-empty">No Facebook posts have been recorded yet.</div>`;

  if (failedTarget) {
    failedTarget.innerHTML = failed.length ? failed.map((entry) => `<div class="publishing-row failed">
      <span class="publishing-state failed">Failed</span>
      <div><strong>${escapeHtml(entry.topic)}</strong><span>${escapeHtml(entry.media || "post")} — ${escapeHtml(entry.error || "unknown error")}</span></div>
      <time datetime="${escapeHtml(entry.at)}">${escapeHtml(new Date(entry.at).toLocaleString())}</time>
    </div>`).join("") : `<div class="scheduled-empty">No failed publish attempts recorded.</div>`;
  }
}

async function verifyApprovalConnections() {
  const target = document.getElementById("approval-connections");
  const telegram = approvalSession.telegramConfigured
    ? `<span class="connection-state ok">Telegram confirmation configured</span>`
    : `<span class="connection-state bad">Telegram confirmation not configured</span>`;
  if (!approvalSession.facebookConfigured) {
    target.innerHTML = `<span class="connection-state bad">New Facebook Page not connected</span>${telegram}`;
    return false;
  }
  try {
    const result = await approvalRequest("/api/approvals/facebook");
    target.innerHTML = `<span class="connection-state ok">Facebook: ${escapeHtml(result.page.name)}</span>${telegram}`;
    return true;
  } catch (error) {
    target.innerHTML = `<span class="connection-state bad">Facebook: ${escapeHtml(error.message)}</span>${telegram}`;
    document.querySelectorAll(".approve-btn").forEach((button) => (button.disabled = true));
    return false;
  }
}

async function loadApprovals() {
  const grid = document.getElementById("approvals-grid");
  const empty = document.getElementById("approvals-empty");
  grid.innerHTML = `<div class="card skel">Loading queue…</div>`;
  try {
    const data = await approvalRequest("/api/approvals");
    const posts = data.posts || [];
    const policy = data.schedulePolicy || { timeZone: "America/Phoenix", slots: ["08:00", "12:00"] };
    document.getElementById("schedule-policy").textContent = `Auto: up to ${policy.slots.length} daily at ${policy.slots.join(" and ")} | ${policy.timeZone}; today fills first`;
    grid.innerHTML = posts.map(approvalCard).join("");
    empty.classList.toggle("hidden", posts.length > 0);
    renderScheduledPosts(data.scheduled || []);
    renderApprovalHistory(data.history || []);
    renderPublishing(data.scheduled || [], data.published || [], policy, data.failed || []);
    const facebookReady = await verifyApprovalConnections();

    grid.querySelectorAll(".approval-card").forEach((card) => {
      const { topic, date } = card.dataset;
      const statusEl = card.querySelector(".approval-status");
      const approveBtn = card.querySelector(".approve-btn");
      const autoScheduleBtn = card.querySelector(".auto-schedule-btn");
      const scheduleBtn = card.querySelector(".schedule-btn");
      const scheduleAt = card.querySelector(".schedule-at");
      const skipBtn = card.querySelector(".skip-btn");
      const mediaSelect = card.querySelector(".media-select");
      mediaSelect.value = card.querySelector(".default-media").value;
      approveBtn.disabled = !facebookReady;
      autoScheduleBtn.disabled = !facebookReady;
      scheduleBtn.disabled = !facebookReady;

      const previewImage = card.querySelector(".approval-preview-image");
      if (previewImage) {
        const post = posts.find((item) => item.topic === topic && item.date === date);
        previewImage.onclick = () => openApprovalImage(post);
        previewImage.onkeydown = (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openApprovalImage(post);
        };
      }

      autoScheduleBtn.onclick = async () => {
        const media = mediaSelect.value;
        if (!window.confirm(`Approve ${topic} and place it in the next open ${policy.slots.join(" / ")} ${policy.timeZone} slot?`)) return;
        approveBtn.disabled = true; autoScheduleBtn.disabled = true; scheduleBtn.disabled = true; skipBtn.disabled = true; mediaSelect.disabled = true; scheduleAt.disabled = true;
        statusEl.textContent = "Finding the next open publishing slot…";
        try {
          const result = await approvalRequest("/api/approvals/schedule-next", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic, date, media }),
          });
          statusEl.textContent = `Scheduled for ${new Date(result.scheduled.scheduledAt).toLocaleString()}.`;
          setTimeout(loadApprovals, 700);
        } catch (error) {
          statusEl.innerHTML = `<span class="err-card">${escapeHtml(error.message)}</span>`;
          approveBtn.disabled = !facebookReady; autoScheduleBtn.disabled = !facebookReady; scheduleBtn.disabled = !facebookReady; skipBtn.disabled = false; mediaSelect.disabled = false; scheduleAt.disabled = false;
        }
      };

      scheduleBtn.onclick = async () => {
        const media = mediaSelect.value;
        const when = new Date(scheduleAt.value);
        if (!scheduleAt.value || Number.isNaN(when.getTime())) return window.alert("Choose a valid date and time.");
        if (!window.confirm(`Schedule ${topic} for ${when.toLocaleString()}?`)) return;
        approveBtn.disabled = true; autoScheduleBtn.disabled = true; scheduleBtn.disabled = true; skipBtn.disabled = true; mediaSelect.disabled = true; scheduleAt.disabled = true;
        statusEl.textContent = "Adding to schedule…";
        try {
          await approvalRequest("/api/approvals/schedule", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic, date, media, scheduledAt: when.toISOString() }),
          });
          await loadApprovals();
        } catch (error) {
          statusEl.innerHTML = `<span class="err-card">${escapeHtml(error.message)}</span>`;
          approveBtn.disabled = !facebookReady; autoScheduleBtn.disabled = !facebookReady; scheduleBtn.disabled = !facebookReady; skipBtn.disabled = false; mediaSelect.disabled = false; scheduleAt.disabled = false;
        }
      };

      approveBtn.onclick = async () => {
        const media = mediaSelect.value;
        const page = approvalSession.expectedPage || "the connected Facebook Page";
        if (!window.confirm(`Publish ${topic} with ${media} to ${page}?`)) return;
        approveBtn.disabled = true; autoScheduleBtn.disabled = true; scheduleBtn.disabled = true; skipBtn.disabled = true; mediaSelect.disabled = true; scheduleAt.disabled = true;
        statusEl.textContent = "Publishing to Facebook…";
        try {
          const result = await approvalRequest("/api/approvals/publish", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic, date, media }),
          });
          const link = result.permalinkUrl ? ` <a href="${escapeHtml(result.permalinkUrl)}" target="_blank" rel="noopener">Open post</a>` : "";
          const telegramNote = result.telegram?.sent ? " Telegram confirmation sent." : ` Telegram was not sent: ${escapeHtml(result.telegram?.reason || "not configured")}`;
          statusEl.innerHTML = `<span class="pos">Published.</span>${link}${telegramNote}`;
          setTimeout(loadApprovals, 1600);
        } catch (error) {
          statusEl.innerHTML = `<span class="err-card">${escapeHtml(error.message)}</span>`;
          approveBtn.disabled = false; autoScheduleBtn.disabled = false; scheduleBtn.disabled = false; skipBtn.disabled = false; mediaSelect.disabled = false; scheduleAt.disabled = false;
        }
      };

      skipBtn.onclick = async () => {
        if (!window.confirm(`Skip ${topic}? It will leave the approval queue without being posted.`)) return;
        approveBtn.disabled = true; autoScheduleBtn.disabled = true; scheduleBtn.disabled = true; skipBtn.disabled = true;
        try {
          await approvalRequest("/api/approvals/skip", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic, date }),
          });
          await loadApprovals();
        } catch (error) {
          statusEl.innerHTML = `<span class="err-card">${escapeHtml(error.message)}</span>`;
          approveBtn.disabled = !facebookReady; autoScheduleBtn.disabled = !facebookReady; scheduleBtn.disabled = !facebookReady; skipBtn.disabled = false;
        }
      };
    });
  } catch (error) {
    if (error.status === 401) return loadApprovalSession();
    grid.innerHTML = `<div class="err-card">${escapeHtml(error.message)}</div>`;
  }
}

async function loadApprovalSession() {
  approvalSession = await approvalRequest("/api/approvals/session");
  const login = document.getElementById("approval-login");
  const manager = document.getElementById("approval-manager");
  const logout = document.getElementById("approval-logout");
  const publishingManager = document.getElementById("publishing-manager");
  const publishingLocked = document.getElementById("publishing-locked");
  const status = document.getElementById("approval-login-status");
  login.classList.toggle("hidden", approvalSession.authenticated);
  manager.classList.toggle("hidden", !approvalSession.authenticated);
  logout.classList.toggle("hidden", !approvalSession.authenticated);
  publishingManager.classList.toggle("hidden", !approvalSession.authenticated);
  publishingLocked.classList.toggle("hidden", approvalSession.authenticated);
  if (!approvalSession.configured) {
    status.textContent = "Server setup required: add APPROVAL_PASSWORD and APPROVAL_SESSION_SECRET to .env.";
    document.querySelector("#approval-login-form button").disabled = true;
    document.getElementById("approval-password").disabled = true;
    return;
  }
  if (approvalSession.authenticated) await loadApprovals();
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
document.getElementById("approval-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("approval-password");
  const status = document.getElementById("approval-login-status");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  status.textContent = "Logging in…";
  try {
    await approvalRequest("/api/approvals/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    password.value = "";
    status.textContent = "";
    await loadApprovalSession();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.getElementById("approval-logout").addEventListener("click", async () => {
  await approvalRequest("/api/approvals/logout", { method: "POST" });
  await loadApprovalSession();
});

loadDash().catch((e) => document.getElementById("cards").innerHTML = `<div class="err-card">⚠ ${e.message}</div>`);
loadStock();
loadScreen();
loadGallery();
loadApprovalSession().catch((error) => {
  document.getElementById("approval-login-status").textContent = error.message;
});
