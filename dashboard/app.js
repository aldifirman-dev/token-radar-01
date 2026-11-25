(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    mode: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
    base: DATA.model.base_multiple,
    growth: DATA.model.growth_weight,
    chainStep: DATA.model.chain_step
  };
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function usd(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    if (Math.abs(value) >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (Math.abs(value) >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (Math.abs(value) >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return money.format(value);
  }
  function pct(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }
  function age(value) {
    if (value === null || value === undefined) return 'unknown';
    return value >= 365 ? (value / 365).toFixed(1) + 'y' : Math.max(0, value) + 'd';
  }
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function chains(row) { return row.chains && row.chains.length ? row.chains.join(', ') : 'chain not listed'; }
  function parseHash() {
    var params = new URLSearchParams(window.location.hash.slice(1));
    if (params.has('category')) state.category = params.get('category');
    if (params.has('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }
  function rankedRows() {
    var scored = DATA.rows.map(function (row) {
      var growthPct = Math.max(DATA.model.growth_floor, Math.min(DATA.model.growth_cap, row.change_7d || 0));
      var growthMult = 1 + growthPct / 100 * state.growth;
      var ageDays = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
      var maturityMult = DATA.model.maturity_floor +
        Math.min(Math.max(ageDays, 0), DATA.model.maturity_days) / DATA.model.maturity_days * DATA.model.maturity_range;
      var chainMult = 1 + state.chainStep * Math.min(Math.max(row.chains.length - 1, 0), DATA.model.chain_max_steps);
      var raw = Math.round(row.tvl_usd * state.base * growthMult * maturityMult * chainMult);
      return {
        row: row,
        raw: raw,
        growthPct: growthPct,
        growthMult: growthMult,
        maturityMult: maturityMult,
        chainMult: chainMult
      };
    });
    scored.sort(function (a, b) { return b.raw - a.raw || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0); });
    var previous = Infinity;
    scored.forEach(function (item, index) {
      item.implied = Math.min(item.raw, previous - 1);
      item.rank = index + 1;
      previous = item.implied;
    });
    return scored;
  }
  function allEntries() {
    var pre = rankedRows().map(function (item) { return { row: item.row, score: item, live: false }; });
    var live = DATA.live.map(function (row) { return { row: row, score: null, live: true }; });
    return pre.concat(live);
  }
  function selectedEntries() {
    var q = state.q.trim().toLowerCase();
    return allEntries().filter(function (entry) {
      var row = entry.row;
      if (state.tab === 'pre-token' && entry.live) return false;
      if (state.tab === 'live' && !entry.live) return false;
      if (state.category !== 'all' && (row.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && row.chains.indexOf(state.chain) < 0) return false;
      if (!entry.live && state.mode === 'watchlist' && !row.watchlist) return false;
      if (!entry.live && state.mode === 'early' && row.watchlist) return false;
      var haystack = [row.name, row.slug, row.category || '', row.chains.join(' ')].join(' ').toLowerCase();
      return !q || haystack.indexOf(q) >= 0;
    });
  }
  function sortEntries(entries) {
    var key = state.sort;
    return entries.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (key === 'growth') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (key === 'age') { av = a.row.age_days === null ? Infinity : a.row.age_days; bv = b.row.age_days === null ? Infinity : b.row.age_days; }
      else if (a.live) { av = a.row.mcap_usd || 0; bv = b.row.mcap_usd || 0; }
      else { av = a.score.implied; bv = b.score.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }
  function options(values, selected, allLabel) {
    return '<option value="all">' + allLabel + '</option>' + values.map(function (value) {
      return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>';
    }).join('');
  }
  function sortButton(key, label) {
    var active = state.sort === key;
    return '<th><button type="button" data-sort="' + key + '">' + label +
      (active ? '<span aria-hidden="true">' + (state.dir < 0 ? ' ↓' : ' ↑') + '</span>' : '') + '</button></th>';
  }
  function tableMarkup(entries) {
    var sorted = sortEntries(entries);
    if (!sorted.length) return '<section class="panel empty"><h2>No matches</h2><p>Change the search or filters to see more protocols.</p><button class="button" type="button" data-clear>Clear filters</button></section>';
    var max = Math.max.apply(null, sorted.map(function (entry) { return entry.live ? entry.row.mcap_usd || 0 : entry.score.implied; })) || 1;
    var live = state.tab === 'live';
    var head = live
      ? '<th>Status</th>' + sortButton('name', 'Protocol') + sortButton('tvl', 'TVL') + sortButton('growth', '7d') + sortButton('implied', 'Market cap')
      : sortButton('implied', 'Rank') + sortButton('name', 'Protocol') + sortButton('tvl', 'TVL') + sortButton('growth', '7d') + sortButton('age', 'Age') + sortButton('implied', 'Implied value') + '<th>Set</th>';
    var body = sorted.map(function (entry) {
      var row = entry.row;
      var score = entry.score;
      var value = entry.live ? row.mcap_usd : score.implied;
      var width = Math.max(2, Math.round((value || 0) / max * 100));
      var rank = score ? score.rank : 'LIVE';
      return '<tr data-protocol="' + esc(row.slug) + '" tabindex="0">' +
        (live ? '<td><span class="status live">LIVE</span></td>' : '<td class="num rank">' + rank + '</td>') +
        '<td><div class="name"><b>' + esc(row.name) + '</b><span class="sub">' + esc(row.category || 'Other') + ' · ' + esc(chains(row)) + '</span></div></td>' +
        '<td class="num">' + usd(row.tvl_usd) + '</td>' +
        '<td class="num ' + (row.change_7d !== null && row.change_7d >= 0 ? 'positive' : row.change_7d === null ? '' : 'negative') + '">' + pct(row.change_7d) + '</td>' +
        (live ? '' : '<td class="num">' + age(row.age_days) + '</td>') +
        '<td><div class="value-cell"><div class="bar"><i style="width:' + width + '%"></i></div><b class="num value">' + usd(value) + '</b></div></td>' +
        (live ? '' : '<td><span class="status">' + (row.watchlist ? 'WATCHLIST' : 'EARLY') + '</span></td>') +
        '</tr>';
    }).join('');
    var caption = live
      ? 'Protocols with a token are separated from the implied-value ranking; shown by reported market cap.'
      : 'Pre-token protocols ranked by implied value. Open a row for its model inputs and eight-step plan.';
    return '<section class="panel table-panel"><div class="table-wrap"><table><caption>' + caption + '</caption><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }
  function formulaText(base, growth, chain) {
    return 'round(TVL × ' + Number(base).toFixed(2) + ' × (1 + clamp(change_7d, −80, 200) / 100 × ' +
      Number(growth).toFixed(2) + ') × (0.6 + min(age, 1095) / 1095 × 0.4) × (1 + ' +
      Number(chain).toFixed(2) + ' × min(max(chains − 1, 0), 5)))';
  }
  function dashboardMarkup(entries) {
    var categories = Array.from(new Set(DATA.rows.concat(DATA.live).map(function (row) { return row.category || 'Other'; }))).sort();
    var chainNames = Array.from(new Set(DATA.rows.concat(DATA.live).reduce(function (all, row) { return all.concat(row.chains); }, []))).sort();
    var filtered = entries.length;
    var earlyLabel = DATA.early_size.toLocaleString('en-US');
    return '<div class="shell">' +
      '<header class="top"><div class="brand"><span class="radar-mark" aria-hidden="true"><i></i></span><div><span class="eyebrow">TOKEN RADAR / 01</span><h1>Pre-token watch</h1></div></div>' +
      '<div class="top-meta"><span>SNAPSHOT <b>' + esc(DATA.as_of) + '</b></span><span>MODEL <b>' + esc(DATA.model_version) + '</b></span></div></header>' +
      '<section class="intro"><div><p class="kicker">THE TOKEN LAUNCH RADAR</p><h2>Find signal before the ticker.</h2><p class="lede">A snapshot-led scan of DeFi protocols with no recorded token. Implied value is a consistent screening estimate, not a forecast or token price.</p></div>' +
      '<div class="facts"><div class="fact"><b>' + DATA.watchlist_size + '<small> / 40</small></b><span>Watchlist covered</span></div><div class="fact"><b>' + DATA.board_size + '</b><span>Pre-token ranked</span></div><div class="fact"><b>' + earlyLabel + '</b><span>Below-floor early rows</span></div><div class="fact"><b>' + DATA.live_size + '</b><span>Live set aside</span></div></div></section>' +
      '<section class="controls" aria-label="Board filters"><label class="field search"><span>Search</span><input id="search" type="search" placeholder="Name, slug, category, chain" value="' + esc(state.q) + '"></label>' +
      '<label class="field"><span>Category</span><select id="category">' + options(categories, state.category, 'All categories') + '</select></label>' +
      '<label class="field"><span>Chain</span><select id="chain">' + options(chainNames, state.chain, 'All chains') + '</select></label>' +
      '<div class="field mode-field"><span>Coverage</span><div class="segmented">' +
      ['all', 'watchlist', 'early'].map(function (mode) { return '<button type="button" data-mode="' + mode + '" aria-pressed="' + (state.mode === mode ? 'true' : 'false') + '"' + (state.tab === 'live' && mode !== 'all' ? ' disabled' : '') + '>' + (mode === 'all' ? 'All' : mode === 'watchlist' ? 'Watchlist' : 'Early') + '</button>'; }).join('') +
      '</div></div><div class="tabs" role="tablist"><button type="button" data-tab="pre-token" aria-selected="' + (state.tab === 'pre-token') + '">Pre-token <span>' + DATA.board_size + '</span></button><button type="button" data-tab="live" aria-selected="' + (state.tab === 'live') + '">Live token <span>' + DATA.live_size + '</span></button></div>' +
      '<p class="result-count">' + filtered.toLocaleString('en-US') + ' shown</p></section>' +
      tableMarkup(entries) +
      '<section class="lower-grid"><article class="panel how"><p class="kicker">METHOD / ' + esc(DATA.model_version.toUpperCase()) + '</p><h2>How this ranks</h2><p class="formula">' + esc(formulaText(state.base, state.growth, state.chainStep)) + '</p><p class="sub">TVL, seven-day change, listing age and chain count come only from the sealed snapshot. Unknown age uses 365 days. Already-tokenized protocols stay in the Live tab.</p></article>' +
      '<article class="panel sandbox"><div class="sandbox-head"><div><p class="kicker">MODEL SANDBOX</p><h2>Adjust the lens</h2></div><button class="button reset" type="button" data-reset>Reset</button></div>' +
      sliderMarkup('base', 'Base multiple', 0.10, 0.50, 0.01, state.base, '×') +
      sliderMarkup('growth', 'Growth weight', 0, 1, 0.05, state.growth, '') +
      sliderMarkup('chainStep', 'Chain step', 0, 0.08, 0.005, state.chainStep, '') +
      '<p class="sub">Sandbox scores rerank the full pre-token set instantly. Defaults match the submitted model.</p></article></section>' +
      '<footer><span>MODEL ' + esc(DATA.model_version) + ' · SNAPSHOT ' + esc(DATA.as_of) + '</span><span>Signal for research, not financial advice.</span></footer>' +
      '</div>';
  }
  function sliderMarkup(id, label, min, max, step, value, suffix) {
    var display = id === 'base' ? Number(value).toFixed(2) : id === 'growth' ? Number(value).toFixed(2) : Number(value).toFixed(3);
    return '<label class="slider"><span>' + label + '<b>' + display + suffix + '</b></span><input id="slider-' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></label>';
  }
  function detailMarkup(row, isLive, score) {
    var title = esc(row.name);
    var detail = '<div class="detail-heading"><div><p class="kicker">' + (isLive ? 'LIVE TOKEN · NOT SCORED' : 'RANK ' + score.rank + ' / ' + DATA.board_size) + '</p><h2 id="detail-title">' + title + '</h2><p class="sub">' + esc(row.category || 'Other') + ' · ' + esc(chains(row)) + '</p></div><button class="button close" type="button" data-close aria-label="Close details">Close</button></div>';
    if (isLive) {
      detail += '<section class="detail-section"><h3>Market snapshot</h3><dl class="metrics"><div><dt>TVL</dt><dd>' + usd(row.tvl_usd) + '</dd></div><div><dt>7d change</dt><dd>' + pct(row.change_7d) + '</dd></div><div><dt>Market cap</dt><dd class="amber">' + usd(row.mcap_usd) + '</dd></div></dl><p class="sub">A token is already recorded for this protocol. Its market cap is shown as reported, not estimated by the pre-token model.</p></section>';
      return detail;
    }
    detail += '<section class="detail-section"><h3>Model breakdown</h3><dl class="metrics"><div><dt>TVL</dt><dd>' + usd(row.tvl_usd) + '</dd></div><div><dt>7d growth</dt><dd>' + pct(row.change_7d) + '</dd></div><div><dt>Age</dt><dd>' + age(row.age_days) + (row.age_days === null ? ' <small>(365d default)</small>' : '') + '</dd></div><div><dt>Growth multiplier</dt><dd>' + score.growthMult.toFixed(3) + '</dd></div><div><dt>Maturity multiplier</dt><dd>' + score.maturityMult.toFixed(3) + '</dd></div><div><dt>Chain multiplier</dt><dd>' + score.chainMult.toFixed(3) + '</dd></div><div class="total"><dt>Implied value</dt><dd class="amber">' + usd(score.implied) + '</dd></div></dl><p class="sub">The model uses only snapshot figures; any rounded-score tie is separated by one dollar to keep ranks strict.</p></section>';
    detail += '<section class="detail-section"><h3>Farm plan <span class="sub">8 practical steps · estimates vary by network</span></h3><ol class="steps">' + row.farm_steps.map(function (step) {
      var parts = step.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/);
      return '<li><b>' + esc(parts ? parts[1] : step) + '</b><span class="cost">Cost: ' + esc(parts ? parts[2] : 'see app') + ' · Time: ' + esc(parts ? parts[3] : 'varies') + '</span></li>';
    }).join('') + '</ol></section>';
    return detail;
  }
  function render(focusId) {
    var entries = selectedEntries();
    app.innerHTML = dashboardMarkup(entries);
    app.setAttribute('aria-busy', 'false');
    var search = document.getElementById('search');
    search.addEventListener('input', function () { state.q = search.value; render('search'); });
    document.getElementById('category').addEventListener('change', function (event) {
      state.category = event.target.value; writeHash(); render();
    });
    document.getElementById('chain').addEventListener('change', function (event) { state.chain = event.target.value; render(); });
    app.querySelectorAll('[data-sort]').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-sort');
        if (state.sort === key) state.dir *= -1;
        else { state.sort = key; state.dir = -1; }
        render();
      });
    });
    app.querySelectorAll('[data-mode]').forEach(function (button) {
      button.addEventListener('click', function () { state.mode = button.getAttribute('data-mode'); render(); });
    });
    app.querySelectorAll('[data-tab]').forEach(function (button) {
      button.addEventListener('click', function () { state.tab = button.getAttribute('data-tab'); render(); });
    });
    app.querySelectorAll('[data-protocol]').forEach(function (tr) {
      tr.addEventListener('click', function () { state.selected = tr.getAttribute('data-protocol'); writeHash(); render(); });
      tr.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.selected = tr.getAttribute('data-protocol'); writeHash(); render(); }
      });
    });
    var clear = app.querySelector('[data-clear]');
    if (clear) clear.addEventListener('click', function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.mode = 'all'; writeHash(); render(); });
    app.querySelectorAll('.slider input').forEach(function (input) {
      input.addEventListener('input', function () {
        var key = input.id.slice(7);
        state[key] = Number(input.value);
        render(input.id);
      });
    });
    var reset = app.querySelector('[data-reset]');
    reset.addEventListener('click', function () {
      state.base = DATA.model.base_multiple;
      state.growth = DATA.model.growth_weight;
      state.chainStep = DATA.model.chain_step;
      render();
    });
    var chosen = allEntries().filter(function (entry) { return entry.row.slug === state.selected; })[0];
    if (chosen) {
      var detail = document.createElement('dialog');
      detail.className = 'detail';
      detail.setAttribute('aria-labelledby', 'detail-title');
      detail.innerHTML = detailMarkup(chosen.row, chosen.live, chosen.score);
      app.appendChild(detail);
      detail.querySelector('[data-close]').addEventListener('click', function () { detail.close(); });
      detail.addEventListener('close', function () { state.selected = null; writeHash(); });
      if (typeof detail.showModal === 'function') detail.showModal();
      else detail.setAttribute('open', '');
    }
    if (focusId) {
      var focus = document.getElementById(focusId);
      if (focus) { focus.focus(); if (focus.setSelectionRange) focus.setSelectionRange(focus.value.length, focus.value.length); }
    }
  }
  parseHash();
  render();
  window.addEventListener('hashchange', function () { parseHash(); render(); });
})();
