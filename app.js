// ── State ──
let restaurants = [];
let currentSort = 'rating-desc';
let selectedCategories = new Set();
let selectedLocations = new Set();
let selectedKosher = new Set();
let expandedId = null;
let isDesktop = window.innerWidth >= 900;

// Known location filter names (from filters array)
const LOCATION_FILTERS = new Set(['תל אביב והמרכז', 'מרכז', 'צפון', 'דרום', 'ירושלים', 'השרון']);
const KOSHER_FILTERS = new Set(['כשר', 'כשר למהדרין']);

// ── Utilities ──
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parsePriceNum(s) {
  if (!s) return null;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function encodeLogoUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.origin + u.pathname.split('/').map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/');
  } catch { return url; }
}

function getRestaurantFilterNames(r) {
  if (!r.filters || !Array.isArray(r.filters)) return [];
  return r.filters.map(f => f.text).filter(Boolean);
}

// ── Sort ──
function sortRestaurants(arr, mode) {
  return [...arr].sort((a, b) => {
    switch (mode) {
      case 'rating-desc': return (b.google_rating ?? -1) - (a.google_rating ?? -1);
      case 'rating-asc': return (a.google_rating ?? 99) - (b.google_rating ?? 99);
      case 'reviews-desc': return (b.google_review_count ?? -1) - (a.google_review_count ?? -1);
      case 'reviews-asc': return (a.google_review_count ?? 999999) - (b.google_review_count ?? 999999);
      case 'price-asc':
      case 'price-desc': {
        const dir = mode === 'price-asc' ? 1 : -1;
        if (a._priceNum == null && b._priceNum == null) return 0;
        if (a._priceNum == null) return 1;
        if (b._priceNum == null) return -1;
        return (a._priceNum - b._priceNum) * dir;
      }
      default: return 0;
    }
  });
}

// ── Filter ──
function filterRestaurants(arr) {
  return arr.filter(r => {
    // Category filter (OR within)
    if (selectedCategories.size > 0 && !selectedCategories.has(r.google_category)) return false;
    // Location filter (OR within — check if any of restaurant's filter names match)
    if (selectedLocations.size > 0) {
      const names = getRestaurantFilterNames(r);
      if (!names.some(n => selectedLocations.has(n))) return false;
    }
    // Kosher filter (OR within)
    if (selectedKosher.size > 0) {
      const names = getRestaurantFilterNames(r);
      if (!names.some(n => selectedKosher.has(n))) return false;
    }
    return true;
  });
}

// ── Multi-select dropdown builder ──
function createMultiSelect(id, label, options, selectedSet, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'filter-wrapper';

  const btn = document.createElement('button');
  btn.className = 'filter-btn';
  btn.type = 'button';
  btn.id = id + '-btn';

  const dropdown = document.createElement('div');
  dropdown.className = 'filter-dropdown';
  dropdown.id = id + '-dropdown';

  // Actions row
  const actions = document.createElement('div');
  actions.className = 'filter-dropdown-actions';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.textContent = 'בחר הכל';
  selectAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    options.forEach(o => selectedSet.add(o));
    updateCheckboxes();
    onChange();
  });

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'בטל הכל';
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedSet.clear();
    updateCheckboxes();
    onChange();
  });

  actions.appendChild(selectAllBtn);
  actions.appendChild(clearBtn);
  dropdown.appendChild(actions);

  // Options
  const checkboxes = [];
  options.forEach(opt => {
    const row = document.createElement('label');
    row.className = 'filter-option';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = opt;
    cb.checked = selectedSet.has(opt);
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) selectedSet.add(opt);
      else selectedSet.delete(opt);
      updateBtnLabel();
      onChange();
    });

    const span = document.createElement('span');
    span.textContent = opt;

    row.appendChild(cb);
    row.appendChild(span);
    row.addEventListener('click', (e) => e.stopPropagation());
    dropdown.appendChild(row);
    checkboxes.push(cb);
  });

  function updateCheckboxes() {
    checkboxes.forEach(cb => { cb.checked = selectedSet.has(cb.value); });
    updateBtnLabel();
  }

  function updateBtnLabel() {
    const count = selectedSet.size;
    if (count === 0) {
      btn.textContent = label + ': הכל';
      btn.classList.remove('active');
    } else {
      btn.textContent = label + ': ' + count;
      btn.classList.add('active');
    }
    // Re-add the arrow pseudo-element needs the class
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close other dropdowns first
    document.querySelectorAll('.filter-dropdown.open').forEach(d => {
      if (d !== dropdown) d.classList.remove('open');
    });
    dropdown.classList.toggle('open');
  });

  updateBtnLabel();
  wrapper.appendChild(btn);
  wrapper.appendChild(dropdown);
  return wrapper;
}

// ── Render ──
function renderAll() {
  const filtered = filterRestaurants(restaurants);
  const sorted = sortRestaurants(filtered, currentSort);
  const list = document.getElementById('list');
  list.innerHTML = '';
  document.getElementById('count').textContent = sorted.length + ' מסעדות';

  // If expanded restaurant was filtered out, deselect
  if (expandedId && !sorted.find(r => r.id === expandedId)) {
    expandedId = null;
  }

  sorted.forEach(r => {
    list.appendChild(buildCard(r));
    // On mobile: show detail inline below card
    if (!isDesktop && expandedId === r.id) {
      const det = buildDetail(r);
      det.classList.add('detail-inline');
      list.appendChild(det);
    }
  });

  // On desktop: update side panel
  if (isDesktop) {
    renderDetailPanel();
  }
}

function renderDetailPanel() {
  const panel = document.getElementById('detail-panel');
  panel.innerHTML = '';
  if (!expandedId) {
    panel.innerHTML = `
      <div class="detail-placeholder">
        <div class="detail-placeholder__icon">🍽️</div>
        <div class="detail-placeholder__text">בחר מסעדה לצפייה בפרטים</div>
      </div>`;
    return;
  }
  const r = restaurants.find(r => r.id === expandedId);
  if (r) {
    panel.appendChild(buildDetail(r));
  }
}

function buildCard(r) {
  const div = document.createElement('div');
  const isExpanded = expandedId === r.id;
  let cls = 'card';
  if (r.is_permanently_closed) cls += ' closed';
  if (isExpanded && !isDesktop) cls += ' expanded';
  if (isExpanded && isDesktop) cls += ' selected';
  div.className = cls;
  div.dataset.id = r.id;

  const ratingStr = r.google_rating != null
    ? `<span class="star">★</span> <span class="ltr-num">${r.google_rating.toFixed(1)}</span>`
    : '';
  const reviewStr = r.google_review_count
    ? `(<span class="ltr-num">${r.google_review_count.toLocaleString('he-IL')}</span> ביקורות)`
    : '';
  const catStr = escHtml(r.google_category || 'מסעדה');

  let badges = '';
  if (r.google_price_level) badges += `<span class="badge badge--price">${escHtml(r.google_price_level)}</span>`;
  if (r.easy_kosher === 'כשר') badges += '<span class="badge badge--kosher">כשר</span>';
  else if (r.easy_kosher === 'לא כשר') badges += '<span class="badge badge--not-kosher">לא כשר</span>';
  if (r.is_permanently_closed) badges += '<span class="badge badge--closed">סגור לצמיתות</span>';

  div.innerHTML = `
    <img class="card__logo" src="${r._logoSrc}" alt="${escHtml(r.name)}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="card__fallback" style="display:none">🍽</div>
    <div class="card__info">
      <div class="card__name">${escHtml(r.name)}</div>
      <div class="card__meta">${catStr} · ${ratingStr} ${reviewStr}</div>
      ${badges ? '<div class="card__badges">' + badges + '</div>' : ''}
    </div>`;

  div.addEventListener('click', () => {
    expandedId = expandedId === r.id ? null : r.id;
    renderAll();
    if (!isDesktop && expandedId) {
      const el = document.querySelector('[data-id="' + r.id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  return div;
}

function buildDetail(r) {
  const div = document.createElement('div');
  div.className = 'detail';

  let links = '';
  if (r.link) links += `<a href="${escHtml(r.link)}" target="_blank" rel="noopener">🌐 אתר</a>`;
  if (r.google_menu_link) links += `<a href="${escHtml(r.google_menu_link)}" target="_blank" rel="noopener">📋 תפריט</a>`;
  if (r.google_maps_link) links += `<a href="${escHtml(r.google_maps_link)}" target="_blank" rel="noopener">📍 Google Maps</a>`;
  if (r.easy_url) links += `<a href="${escHtml(r.easy_url)}" target="_blank" rel="noopener">easy.co.il</a>`;
  if (r.easy_facebook) links += `<a href="${escHtml(r.easy_facebook)}" target="_blank" rel="noopener">Facebook</a>`;
  if (r.easy_instagram) links += `<a href="${escHtml(r.easy_instagram)}" target="_blank" rel="noopener">Instagram</a>`;

  let rows = '';
  if (r.address) rows += `<div class="detail__row">📍 ${escHtml(r.address)}</div>`;
  if (r.phone) rows += `<div class="detail__row">📞 <a href="tel:${escHtml(r.phone)}">${escHtml(r.phone)}</a></div>`;

  let hours = '';
  if (r.easy_hours) {
    const dayOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const hRows = dayOrder
      .filter(d => r.easy_hours[d])
      .map(d => {
        const time = escHtml(r.easy_hours[d]).replace(/\n\s*/g, '<br>');
        return `<tr><td class="day">${d}</td><td>${time}</td></tr>`;
      }).join('');
    if (hRows) {
      hours = `<div class="detail__section-title">שעות פתיחה</div><table class="hours-table">${hRows}</table>`;
    }
  }

  let easyInfo = '';
  if (r.easy_rating != null) {
    easyInfo = `<div class="detail__easy"><span dir="ltr" class="ltr-num">easy</span> דירוג: <span dir="ltr" class="ltr-num">${r.easy_rating}/10</span>`;
    if (r.easy_review_count != null) easyInfo += ` (<span class="ltr-num">${r.easy_review_count.toLocaleString('he-IL')}</span> ביקורות)`;
    easyInfo += '</div>';
  }

  const mapUrl = `https://maps.google.com/maps?q=${r.google_latitude},${r.google_longitude}&z=15&output=embed&hl=he`;

  div.innerHTML = `
    ${links ? '<div class="detail__links">' + links + '</div>' : ''}
    ${rows}
    ${hours}
    ${easyInfo}
    <div class="detail__map">
      <iframe src="${mapUrl}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>`;

  return div;
}

// ── Build Controls ──
function buildControls() {
  const controls = document.getElementById('controls');

  // Categories
  const cats = [...new Set(restaurants.map(r => r.google_category).filter(Boolean))].sort();
  const catFilter = createMultiSelect('cat', 'קטגוריה', cats, selectedCategories, renderAll);
  controls.appendChild(catFilter);

  // Locations
  const allFilterNames = new Set();
  restaurants.forEach(r => {
    getRestaurantFilterNames(r).forEach(n => {
      if (LOCATION_FILTERS.has(n)) allFilterNames.add(n);
    });
  });
  const locs = [...allFilterNames].sort();
  if (locs.length > 0) {
    const locFilter = createMultiSelect('loc', 'אזור', locs, selectedLocations, renderAll);
    controls.appendChild(locFilter);
  }

  // Kosher
  const kosherNames = new Set();
  restaurants.forEach(r => {
    getRestaurantFilterNames(r).forEach(n => {
      if (KOSHER_FILTERS.has(n)) kosherNames.add(n);
    });
  });
  const koshers = [...kosherNames].sort();
  if (koshers.length > 0) {
    const kosherFilter = createMultiSelect('kosher', 'כשרות', koshers, selectedKosher, renderAll);
    controls.appendChild(kosherFilter);
  }
}

// ── Close dropdowns on outside click ──
document.addEventListener('click', () => {
  document.querySelectorAll('.filter-dropdown.open').forEach(d => d.classList.remove('open'));
});

// ── Responsive detection ──
window.addEventListener('resize', () => {
  const wasDesktop = isDesktop;
  isDesktop = window.innerWidth >= 900;
  if (wasDesktop !== isDesktop) renderAll();
});

// ── Init ──
async function init() {
  const res = await fetch('./rest_combined.json');
  restaurants = await res.json();
  restaurants.forEach(r => {
    r._priceNum = parsePriceNum(r.google_price_level);
    r._logoSrc = encodeLogoUrl(r.logo_url);
  });
  buildControls();
  renderAll();
}

document.getElementById('sort-select').addEventListener('change', e => {
  currentSort = e.target.value;
  renderAll();
});

init();
