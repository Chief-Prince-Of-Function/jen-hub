/* =========================
   Simple Sister Hub v0
   - Looks like your screenshot
   - Cloud save/load via Cloudflare Worker + KV
   - LocalStorage kept as a backup fallback
========================= */

const LS_KEY = "sister_hub_local_v0";
const HUB_API_URL = "https://jen-hub-api.fusco13pi.workers.dev";
const SECRET_KEY  = "jen_hub_secret_v1";
const ICS_PROXY_ORIGIN_KEY = "sister_hub_ics_proxy_origin";
const DEFAULT_ICS_PROXY_ORIGIN = "https://jen-hub.fusco13pi.workers.dev";
const ICS_PROXY_URL = `${getIcsProxyOrigin()}/ics?url=`;
const DAILY_QUOTE_API_URL = "https://type.fit/api/quotes";
const DAILY_QUOTE_PROXY_URL = "https://api.allorigins.win/raw?url=";
const DEFAULT_WORK_CAL_URL = "https://outlook.office365.com/owa/calendar/a4c348f42482496c8c7fe1da5bf37c5e@nichir.onmicrosoft.com/Calendar/calendar.ics";
const DEFAULT_HOME_CAL_URLS = [
  "https://rest.cozi.com/api/ext/1103/c386f1c4-cb7d-4e9f-9f4b-b875e2503578/icalendar/feed/feed.ics",
  "https://rest.cozi.com/api/ext/1103/64ed9ef6-f0a6-490c-8923-3b753f2ac638/icalendar/feed/feed.ics",
  "https://rest.cozi.com/api/ext/1103/6e5c8ab7-1c9f-4fa5-a958-faa0901bafa2/icalendar/feed/feed.ics",
  "https://rest.cozi.com/api/ext/1103/404bc8c0-b4f3-4ca8-8653-9f9ddece9a68/icalendar/feed/feed.ics",
  "https://rest.cozi.com/api/ext/1103/a5f61ad0-bda3-451a-b85b-17c03a03ca1a/icalendar/feed/feed.ics",
];
const CURRENT_SCHEMA = 10;

const el = (id)=> document.getElementById(id);

/* =========================
   Cloud helpers
========================= */
function getSecret(){
  return (localStorage.getItem(SECRET_KEY) || "").trim();
}

function ensureSecret(){
  let s = getSecret();
  if(!s){
    s = (window.prompt("Enter hub key (one-time per device):") || "").trim();
    if(s) localStorage.setItem(SECRET_KEY, s);
  }
  return s;
}

async function hubFetch(path, options = {}){
  const secret = ensureSecret();
  if(!secret) throw new Error("Missing hub key");

  const res = await fetch(`${HUB_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Secret": secret,
      ...(options.headers || {}),
    },
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const payload = isJson ? await res.json().catch(()=> ({})) : await res.text().catch(()=> "");

  if(!res.ok){
    throw new Error(payload?.error || `${res.status} ${res.statusText}`);
  }
  return payload;
}

async function loadRemote(){
  return hubFetch("/data", { method: "GET" });
}

async function saveRemote(fullState){
  return hubFetch("/data", { method: "POST", body: JSON.stringify(fullState) });
}

/* =========================
   DOM refs
========================= */
const clockEl = el("clock");
const dateLine = el("dateLine");
const savedLine = el("savedLine");

const weatherLabel = el("weatherLabel");
const weatherZip   = el("weatherZip");
const btnWeatherRefresh = el("btnWeatherRefresh");
const weatherStatus = el("weatherStatus");
const weatherOut = el("weatherOut");

const btnVerseRefresh = el("btnVerseRefresh");
const verseStatus = el("verseStatus");
const verseOut = el("verseOut");

const mantra = el("mantra");
const mantraBig = el("mantraBig");

const workCalPreview = el("workCalPreview");

const homeCal = el("homeCal");
const homeCalPreview = el("homeCalPreview");

const todoText = el("todoText");
const todoDueDate = el("todoDueDate");
const todoPriority = el("todoPriority");
const todoAddBtn = el("todoAddBtn");
const todoSort = el("todoSort");
const todoFilter = el("todoFilter");
const todoList = el("todoList");

const homeTodoListSelect = el("homeTodoListSelect");
const homeTodoListCreate = el("homeTodoListCreate");
const homeTodoListDelete = el("homeTodoListDelete");
const homeTodoText = el("homeTodoText");
const homeTodoAddBtn = el("homeTodoAddBtn");
const homeTodoList = el("homeTodoList");

const workNotes = el("workNotes");

const btnSave = el("btnSave");
const btnReset = el("btnReset");
const saveStatus = el("saveStatus");

/* =========================
   State + boot
========================= */
let state = defaultState();

(async function boot(){
  try{
    const remote = await loadRemote();
    state = remote && typeof remote === "object" ? migrateState(remote) : defaultState();

    // keep a local backup mirror (helpful if cloud ever fails)
    try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(_){}

    setSaveStatus("Loaded ✅ (cloud)");
  }catch(err){
    state = migrateState(loadLocal()) || defaultState();
    setSaveStatus("Loaded ⚠️ (local) — " + (err?.message || err));
  }
  render();
  refreshDailyMantraQuote();
  initCollapsibleCards();
})();

/* =========================
   Clock
========================= */
function tick(){
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  dateLine.textContent = now.toLocaleDateString([], { weekday:"long", month:"long", day:"numeric" });
}
tick();
setInterval(tick, 1000);
setInterval(()=> refreshDailyMantraQuote(), 1000 * 60 * 60);

/* =========================
   Render
========================= */
function render(){
  weatherLabel.value = state.weather.locationLabel || "";
  weatherZip.value = state.weather.zip || "";

  mantra.value = state.notes.mantra || "";
  mantraBig.textContent = (state.notes.mantra || "Live And Not Just Survive").trim() || "Live And Not Just Survive";

  homeCal.value = (state.calendars.homeEmbedUrls || []).join("\n");

  renderWorkCalendar(state.calendars.workEmbedUrl, workCalPreview);
  renderHomeCalendar(state.calendars.homeEmbedUrls, homeCalPreview);

  verseOut.textContent = state.verse.lastText
    ? `${state.verse.lastText}\n\n— ${state.verse.lastRef || ""}\n\nCached: ${state.verse.cachedAt || ""}`
    : "Not loaded yet.";

  renderWeather();

  todoSort.value = state.todos.workSort || "manual";
  todoFilter.value = state.todos.workFilter || "high";
  todoList.innerHTML = "";
  const workTodos = getWorkTodosForDisplay();
  workTodos.forEach((t, index)=> todoList.appendChild(todoRow(t, {
    index,
    total: workTodos.length,
    sortMode: state.todos.workSort || "manual",
  })));
  renderHomeTodos();

  workNotes.value = state.notes.workNotes || "";

  savedLine.textContent = state.meta.updatedAt
    ? `Saved: ${new Date(state.meta.updatedAt).toLocaleString()}`
    : "Saved: —";
}

function renderEmbed(url, host){
  const u = (url || "").trim();
  if(!u){
    host.innerHTML = "Paste a calendar embed link above.";
    return;
  }

  if(looksLikeIcs(u)){
    renderIcsCalendar(u, host);
    return;
  }

  // If it looks like an embed link, try iframe
  const looksEmbeddable = u.includes("calendar.google.com") || u.includes("embed");
  if(looksEmbeddable){
    host.innerHTML = `
      <iframe
        src="${escapeHtml(u)}"
        style="width:100%; height:240px; border:0; border-radius:14px; background:rgba(0,0,0,.08);"
        loading="lazy"
      ></iframe>
    `;
  }else{
    host.innerHTML = `<a href="${escapeHtml(u)}" target="_blank" rel="noopener" style="color:rgba(255,255,255,.9); font-weight:800;">
      Open calendar link
    </a>`;
  }
}

function renderWorkCalendar(url, host){
  const cleanUrl = (url || "").trim();
  if(!cleanUrl){
    host.innerHTML = "Work calendar not configured.";
    return;
  }
  renderIcsCalendar(cleanUrl, host);
}

function renderWeather(){
  const data = state.weather.lastData;
  if(!data){
    weatherOut.textContent = state.weather.lastText || "Not loaded yet.";
    return;
  }

  const location = escapeHtml(data.locationName || "Local weather");
  const zipValue = (state.weather.zip || data.zip || "").trim();
  const zip = zipValue ? ` <span class="mutedSmall">(${escapeHtml(zipValue)})</span>` : "";
  const description = escapeHtml(data.description || "Weather unavailable");
  const icon = data.icon?.symbol || "🌤️";
  const currentTemp = escapeHtml(data.currentTemp || "—");
  const feelsLike = data.feelsLike ? `Feels like ${escapeHtml(data.feelsLike)}` : "Feels like —";
  const high = escapeHtml(data.high || "—");
  const low = escapeHtml(data.low || "—");
  const updatedAt = escapeHtml(data.updatedAt || "");
  const linkUrl = zipValue
    ? `https://weather.com/weather/today/l/${encodeURIComponent(zipValue)}`
    : "https://weather.com/";

  const linkMarkup = `<a class="weatherLink" href="${linkUrl}" target="_blank" rel="noopener">Weather.com ↗</a>`;

  weatherOut.innerHTML = `
    <div class="weatherPanel">
      <div class="weatherHeader">
        <div class="weatherIcon" aria-hidden="true">${icon}</div>
        <div class="weatherSummary">
          <div class="weatherLocation">${location}${zip}</div>
          <div class="weatherDescription">${description}</div>
        </div>
      </div>
      <div class="weatherMetrics">
        <div class="weatherMetric">
          <div class="metricRow"><span class="metricIcon">🌡️</span>Now</div>
          <div class="metricValue">${currentTemp}</div>
          <div class="metricSub">${feelsLike}</div>
        </div>
        <div class="weatherMetric">
          <div class="metricRow"><span class="metricIcon">🛰️</span>Status</div>
          <div class="metricValue">${description}</div>
          <div class="metricSub">Condition summary</div>
        </div>
        <div class="weatherMetric">
          <div class="metricRow"><span class="metricIcon">🔆</span>High</div>
          <div class="metricValue">${high}</div>
          <div class="metricSub">Today&#39;s high</div>
        </div>
        <div class="weatherMetric">
          <div class="metricRow"><span class="metricIcon">🌙</span>Low</div>
          <div class="metricValue">${low}</div>
          <div class="metricSub">Tonight&#39;s low</div>
        </div>
      </div>
      <div class="weatherFooter">
        <div class="weatherUpdated">Updated: ${updatedAt}</div>
        ${linkMarkup}
      </div>
    </div>
  `;
}

function looksLikeIcs(url){
  const clean = url.toLowerCase();
  return clean.endsWith(".ics") || clean.includes("/ical") || clean.includes("icalendar");
}

function renderHomeCalendar(urls, host){
  const cleanUrls = (urls || []).map((url)=> url.trim()).filter(Boolean);
  if(!cleanUrls.length){
    host.innerHTML = "No home calendars configured.";
    return;
  }
  renderIcsCalendar(cleanUrls, host);
}

async function renderIcsCalendar(urls, host){
  const requestId = String((Number(host.dataset.requestId) || 0) + 1);
  host.dataset.requestId = requestId;
  host.innerHTML = "Loading calendar…";

  try{
    const icsTexts = await fetchMultipleIcsTexts(urls);
    const events = icsTexts.flatMap((text)=> parseIcsEvents(text));
    const upcoming = filterUpcomingEvents(events).slice(0, 6);

    if(host.dataset.requestId !== requestId) return;

    if(upcoming.length === 0){
      host.innerHTML = "No upcoming events found.";
      return;
    }

    host.innerHTML = `
      <div class="calendarList">
        ${upcoming.map((event)=>{
          const dateText = formatEventDate(event);
          return `
            <div class="calendarItem">
              <div class="calendarItemTitle">${escapeHtml(event.summary || "(No title)")}</div>
              <div class="calendarItemMeta">${escapeHtml(dateText)}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }catch(err){
    if(host.dataset.requestId !== requestId) return;
    host.innerHTML = `<span class="muted">Unable to load calendar feed. ${escapeHtml(err?.message || err)}</span>`;
  }
}

async function fetchMultipleIcsTexts(urls){
  const list = Array.isArray(urls) ? urls : [urls];
  const results = await Promise.allSettled(list.map((url)=> fetchIcsText(url)));
  const successes = results
    .filter((result)=> result.status === "fulfilled")
    .map((result)=> result.value);

  if(successes.length === 0){
    const firstError = results.find((result)=> result.status === "rejected");
    throw (firstError && firstError.reason) || new Error("Unable to load calendar feed.");
  }
  return successes;
}

async function fetchIcsText(url){
  const proxyUrl = `${ICS_PROXY_URL}${encodeURIComponent(url)}`;
  const proxyResult = await tryFetchText(proxyUrl);
  if(proxyResult.ok) return proxyResult.text;

  const fallbackUrl = `${DAILY_QUOTE_PROXY_URL}${encodeURIComponent(url)}`;
  const fallbackResult = await tryFetchText(fallbackUrl);
  if(fallbackResult.ok) return fallbackResult.text;

  throw new Error(proxyResult.error || fallbackResult.error || "Unable to load calendar feed.");
}

async function tryFetchText(url){
  try{
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok){
      return { ok: false, error: `Unable to load calendar feed (${res.status}).` };
    }
    return { ok: true, text: await res.text() };
  }catch(err){
    return { ok: false, error: err?.message || String(err) };
  }
}

function parseIcsEvents(text){
  const lines = text
    .split(/\r?\n/)
    .reduce((acc, line)=>{
      if(line.startsWith(" ") || line.startsWith("\t")){
        acc[acc.length - 1] += line.trim();
      }else{
        acc.push(line.trim());
      }
      return acc;
    }, []);

  const events = [];
  let current = null;

  lines.forEach((line)=>{
    if(line === "BEGIN:VEVENT"){
      current = { summary: "" };
      return;
    }
    if(line === "END:VEVENT"){
      if(current){
        events.push(current);
      }
      current = null;
      return;
    }
    if(!current) return;

    const [rawKey, ...rest] = line.split(":");
    if(!rawKey || rest.length === 0) return;
    const value = rest.join(":");
    const key = rawKey.toUpperCase();

    if(key.startsWith("SUMMARY")){
      current.summary = value;
    }
    if(key.startsWith("DTSTART")){
      current.start = parseIcsDate(value);
      current.allDay = value.length === 8;
    }
    if(key.startsWith("DTEND")){
      current.end = parseIcsDate(value);
    }
  });

  return events.filter((event)=> event.start instanceof Date && !Number.isNaN(event.start.getTime()));
}

function parseIcsDate(value){
  if(!value) return null;
  const clean = value.replace("Z", "");
  const isUtc = value.endsWith("Z");

  if(clean.length === 8){
    const year = Number(clean.slice(0, 4));
    const month = Number(clean.slice(4, 6)) - 1;
    const day = Number(clean.slice(6, 8));
    return new Date(year, month, day);
  }

  if(clean.length >= 15){
    const year = Number(clean.slice(0, 4));
    const month = Number(clean.slice(4, 6)) - 1;
    const day = Number(clean.slice(6, 8));
    const hour = Number(clean.slice(9, 11));
    const minute = Number(clean.slice(11, 13));
    const second = Number(clean.slice(13, 15));
    if(isUtc){
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    }
    return new Date(year, month, day, hour, minute, second);
  }

  return null;
}

function filterUpcomingEvents(events){
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return events
    .filter((event)=>{
      if(!event.start) return false;
      if(event.end && event.end >= startOfToday) return true;
      return event.start >= startOfToday;
    })
    .sort((a, b)=> a.start - b.start);
}

function formatEventDate(event){
  if(!event.start) return "";
  if(event.allDay){
    return event.start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }

  return event.start.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function todoRow(t, options = {}){
  const row = document.createElement("div");
  row.className = "todoItem";
  const itemIndex = Number.isFinite(options.index) ? options.index : 0;
  const itemTotal = Number.isFinite(options.total) ? options.total : 0;

  const left = document.createElement("div");
  left.className = "todoLeft";

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "todoCheck";
  check.checked = !!t.done;
  check.addEventListener("change", ()=>{
    t.done = check.checked;
    autoSave();
    render();
  });

  const textWrap = document.createElement("div");
  textWrap.className = "todoTextWrap";

  const title = createTodoTextInput(t, {
    label: "Work to do item",
    onUpdate: ()=> {
      autoSave();
      render();
    },
  });

  const meta = document.createElement("div");
  meta.className = "todoMeta";
  const metaParts = [];
  if(t.createdAt){
    metaParts.push(`Added: ${new Date(t.createdAt).toLocaleDateString()}`);
  }
  if(t.dueDate){
    metaParts.push(`Due: ${formatDueDate(t.dueDate)}`);
  }
  meta.textContent = metaParts.join(" · ");

  textWrap.appendChild(title);
  textWrap.appendChild(meta);

  left.appendChild(check);
  left.appendChild(textWrap);

  const actions = document.createElement("div");
  actions.className = "todoActions";

  const tag = document.createElement("div");
  tag.className = `tag ${t.priority || "med"}`;
  tag.textContent = `Priority: ${cap(t.priority || "med")}`;

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btnSmall btnIcon btnDanger";
  del.setAttribute("aria-label", "Delete item");
  del.textContent = "×";
  del.addEventListener("click", ()=>{
    deleteTodo(t.id);
  });

  const moveWrap = document.createElement("div");
  moveWrap.className = "todoMove";

  const canMove = (options.sortMode || "manual") === "manual";
  const moveUp = document.createElement("button");
  moveUp.type = "button";
  moveUp.className = "btn btnSmall btnIcon";
  moveUp.setAttribute("aria-label", "Move item up");
  moveUp.textContent = "↑";
  moveUp.disabled = !canMove || itemIndex <= 0;
  moveUp.addEventListener("click", ()=> {
    moveWorkTodo(t.id, -1);
  });

  const moveDown = document.createElement("button");
  moveDown.type = "button";
  moveDown.className = "btn btnSmall btnIcon";
  moveDown.setAttribute("aria-label", "Move item down");
  moveDown.textContent = "↓";
  moveDown.disabled = !canMove || itemIndex >= (itemTotal - 1);
  moveDown.addEventListener("click", ()=> {
    moveWorkTodo(t.id, 1);
  });

  moveWrap.appendChild(moveUp);
  moveWrap.appendChild(moveDown);

  const actionRow = document.createElement("div");
  actionRow.className = "todoActionRow";
  actionRow.appendChild(moveWrap);
  actionRow.appendChild(del);

  actions.appendChild(tag);
  actions.appendChild(actionRow);

  row.appendChild(left);
  row.appendChild(actions);

  return row;
}

function homeTodoRow(t, options = {}){
  const row = document.createElement("div");
  row.className = "todoItem";
  const itemIndex = Number.isFinite(options.index) ? options.index : 0;
  const itemTotal = Number.isFinite(options.total) ? options.total : 0;

  const left = document.createElement("div");
  left.className = "todoLeft";

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "todoCheck";
  check.checked = !!t.done;
  check.addEventListener("change", ()=> {
    t.done = check.checked;
    autoSave();
    render();
  });

  const textWrap = document.createElement("div");
  textWrap.className = "todoTextWrap";
  const title = createTodoTextInput(t, {
    label: "Home to do item",
    onUpdate: ()=> {
      autoSave();
      render();
    },
  });
  textWrap.appendChild(title);

  left.appendChild(check);
  left.appendChild(textWrap);

  const actions = document.createElement("div");
  actions.className = "todoActions";

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btnSmall btnIcon btnDanger";
  del.setAttribute("aria-label", "Delete item");
  del.textContent = "×";
  del.addEventListener("click", ()=> {
    deleteHomeTodo(t.id);
  });

  const moveWrap = document.createElement("div");
  moveWrap.className = "todoMove";

  const moveUp = document.createElement("button");
  moveUp.type = "button";
  moveUp.className = "btn btnSmall btnIcon";
  moveUp.setAttribute("aria-label", "Move item up");
  moveUp.textContent = "↑";
  moveUp.disabled = itemIndex <= 0;
  moveUp.addEventListener("click", ()=> {
    moveHomeTodo(t.id, -1);
  });

  const moveDown = document.createElement("button");
  moveDown.type = "button";
  moveDown.className = "btn btnSmall btnIcon";
  moveDown.setAttribute("aria-label", "Move item down");
  moveDown.textContent = "↓";
  moveDown.disabled = itemIndex >= (itemTotal - 1);
  moveDown.addEventListener("click", ()=> {
    moveHomeTodo(t.id, 1);
  });

  moveWrap.appendChild(moveUp);
  moveWrap.appendChild(moveDown);

  const actionRow = document.createElement("div");
  actionRow.className = "todoActionRow";
  actionRow.appendChild(moveWrap);
  actionRow.appendChild(del);

  actions.appendChild(actionRow);

  row.appendChild(left);
  row.appendChild(actions);

  return row;
}

/* =========================
   Events
========================= */
weatherLabel.addEventListener("input", ()=>{
  state.weather.locationLabel = weatherLabel.value;
  autoSave();
});

weatherZip.addEventListener("input", ()=>{
  state.weather.zip = weatherZip.value.trim();
  autoSave();
});

mantra.addEventListener("input", ()=>{
  state.notes.mantra = mantra.value;
  mantraBig.textContent = mantra.value || "Live And Not Just Survive";
  autoSave();
});

workNotes.addEventListener("input", ()=>{
  state.notes.workNotes = workNotes.value;
  autoSave();
});


todoAddBtn.addEventListener("click", addTodo);
todoText.addEventListener("keydown", (e)=>{
  if(e.key === "Enter") addTodo();
});

todoSort.addEventListener("change", ()=> {
  state.todos.workSort = todoSort.value;
  autoSave();
  render();
});

todoFilter.addEventListener("change", ()=> {
  state.todos.workFilter = todoFilter.value;
  autoSave();
  render();
});

homeTodoListSelect.addEventListener("change", ()=>{
  const homeTodos = ensureHomeTodoState();
  homeTodos.selectedListId = homeTodoListSelect.value;
  autoSave();
  render();
});

homeTodoListCreate.addEventListener("click", createHomeTodoList);
homeTodoListDelete.addEventListener("click", deleteSelectedHomeTodoList);
homeTodoAddBtn.addEventListener("click", addHomeTodo);
homeTodoText.addEventListener("keydown", (e)=>{
  if(e.key === "Enter") addHomeTodo();
});

btnSave.addEventListener("click", async ()=>{
  await saveNow("Saved");
});

btnReset.addEventListener("click", ()=>{
  if(!confirm("Reset everything on THIS device? (Cloud data will remain)")) return;
  localStorage.removeItem(LS_KEY);
  // Keep the secret so it can still load cloud on refresh
  state = defaultState();
  setSaveStatus("Reset (local).");
  render();
});

btnVerseRefresh.addEventListener("click", async ()=>{
  verseStatus.textContent = "Loading…";
  verseStatus.classList.remove("muted");

  try{
    const verse = await fetchVerseOfDay();
    state.verse.lastText = verse.text;
    state.verse.lastRef = verse.reference;
    state.verse.cachedAt = new Date().toLocaleString();

    verseStatus.textContent = "OK";
    verseStatus.classList.add("muted");
  }catch(err){
    verseStatus.textContent = `Error: ${err?.message || err}`;
    verseStatus.classList.remove("muted");
  }

  autoSave();
  render();
});

btnWeatherRefresh.addEventListener("click", async ()=>{
  weatherStatus.textContent = "Loading…";
  weatherStatus.classList.remove("muted");

  try{
    const weather = await fetchWeather();
    state.weather.lastText = weather.text;
    state.weather.lastData = weather.data;
    weatherStatus.textContent = "OK";
    weatherStatus.classList.add("muted");
  }catch(err){
    weatherStatus.textContent = `Error: ${err?.message || err}`;
    weatherStatus.classList.remove("muted");
  }

  autoSave();
  render();
});

/* =========================
   Save / Autosave (cloud + local backup)
========================= */
async function saveNow(label = "Saved"){
  try{
    state.meta.updatedAt = new Date().toISOString();

    // Local backup always
    try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(_){}

    // Cloud save
    await saveRemote(state);

    setSaveStatus(`${label} ✅ (cloud)`);
  }catch(err){
    setSaveStatus(`${label} ⚠️ (local only) — ` + (err?.message || err));
  }
}

let _saveTimer = null;
function autoSave(){
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(()=>{ saveNow("Auto-saved"); }, 700);
}

/* =========================
   Helpers
========================= */
function addTodo(){
  const txt = (todoText.value || "").trim();
  if(!txt) return;

  const p = todoPriority.value || "med";
  const dueDate = (todoDueDate.value || "").trim();

  state.todos.work = state.todos.work || [];
  state.todos.work.unshift({
    id: crypto.randomUUID(),
    text: txt,
    priority: p,
    done: false,
    createdAt: new Date().toISOString(),
    dueDate: dueDate || ""
  });

  todoText.value = "";
  todoDueDate.value = "";
  autoSave();
  render();
}

function deleteTodo(id){
  state.todos.work = (state.todos.work || []).filter((t)=> t.id !== id);
  autoSave();
  render();
}

function moveWorkTodo(id, direction){
  const workTodos = state.todos.work || [];
  const index = workTodos.findIndex((t)=> t.id === id);
  if(index < 0) return;
  const nextIndex = index + direction;
  if(nextIndex < 0 || nextIndex >= workTodos.length) return;
  const [item] = workTodos.splice(index, 1);
  workTodos.splice(nextIndex, 0, item);
  autoSave();
  render();
}

function moveHomeTodo(id, direction){
  const activeList = getSelectedHomeTodoList();
  if(!activeList) return;
  const items = activeList.items || [];
  const index = items.findIndex((item)=> item.id === id);
  if(index < 0) return;
  const nextIndex = index + direction;
  if(nextIndex < 0 || nextIndex >= items.length) return;
  const [item] = items.splice(index, 1);
  items.splice(nextIndex, 0, item);
  autoSave();
  render();
}

function renderHomeTodos(){
  const homeTodos = ensureHomeTodoState();
  const lists = homeTodos.lists || [];
  if(lists.length === 0){
    homeTodoListSelect.innerHTML = "";
    homeTodoList.innerHTML = `<div class="muted">No lists yet. Create one above.</div>`;
    return;
  }

  if(!lists.find((list)=> list.id === homeTodos.selectedListId)){
    homeTodos.selectedListId = lists[0].id;
  }

  homeTodoListSelect.innerHTML = "";
  lists.forEach((list)=>{
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    if(list.id === homeTodos.selectedListId) option.selected = true;
    homeTodoListSelect.appendChild(option);
  });

  const activeList = getSelectedHomeTodoList();
  homeTodoList.innerHTML = "";
  if(activeList){
    (activeList.items || []).forEach((item, index)=> {
      homeTodoList.appendChild(homeTodoRow(item, {
        index,
        total: activeList.items.length,
      }));
    });
  }
}

function getWorkTodosForDisplay(){
  const workTodos = state.todos.work || [];
  const mode = state.todos.workSort || "manual";
  const filter = state.todos.workFilter || "high";
  const filtered = filter === "all"
    ? workTodos
    : workTodos.filter((item)=> (item.priority || "med") === filter);
  if(mode !== "priority") return filtered;
  const priorityRank = { high: 0, med: 1, low: 2 };
  return [...filtered].sort((a, b)=> {
    const rankDiff = (priorityRank[a.priority || "med"] ?? 1) - (priorityRank[b.priority || "med"] ?? 1);
    if(rankDiff !== 0) return rankDiff;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });
}

function addHomeTodo(){
  const txt = (homeTodoText.value || "").trim();
  if(!txt) return;
  const activeList = getSelectedHomeTodoList();
  if(!activeList) return;

  activeList.items = activeList.items || [];
  activeList.items.unshift({
    id: crypto.randomUUID(),
    text: txt,
    done: false,
    createdAt: new Date().toISOString(),
  });

  homeTodoText.value = "";
  autoSave();
  render();
}

function deleteHomeTodo(id){
  const activeList = getSelectedHomeTodoList();
  if(!activeList) return;
  activeList.items = (activeList.items || []).filter((item)=> item.id !== id);
  autoSave();
  render();
}

function createHomeTodoList(){
  const name = (window.prompt("Name the new list:") || "").trim();
  if(!name) return;

  const homeTodos = ensureHomeTodoState();
  const newList = {
    id: crypto.randomUUID(),
    name,
    items: [],
  };

  homeTodos.lists.push(newList);
  homeTodos.selectedListId = newList.id;
  autoSave();
  render();
}

function deleteSelectedHomeTodoList(){
  const homeTodos = ensureHomeTodoState();
  const activeList = getSelectedHomeTodoList();
  if(!activeList) return;
  if(homeTodos.lists.length <= 1){
    window.alert("Keep at least one list.");
    return;
  }
  const confirmDelete = window.confirm(`Delete the "${activeList.name}" list?`);
  if(!confirmDelete) return;

  homeTodos.lists = homeTodos.lists.filter((list)=> list.id !== activeList.id);
  homeTodos.selectedListId = homeTodos.lists[0]?.id || "";
  autoSave();
  render();
}

function getSelectedHomeTodoList(){
  const homeTodos = ensureHomeTodoState();
  return (homeTodos.lists || []).find((list)=> list.id === homeTodos.selectedListId);
}

function ensureHomeTodoState(){
  if(!state.todos) state.todos = { work: [], home: [] };
  if(!state.todos.home || Array.isArray(state.todos.home)){
    state.todos.home = normalizeHomeTodoState(state.todos.home);
  }
  state.todos.home.lists = state.todos.home.lists || [];
  if(!state.todos.home.selectedListId && state.todos.home.lists.length){
    state.todos.home.selectedListId = state.todos.home.lists[0].id;
  }
  return state.todos.home;
}

function normalizeHomeTodoState(raw){
  if(raw && !Array.isArray(raw) && Array.isArray(raw.lists)){
    return {
      lists: raw.lists.map((list)=> ({
        id: list.id || crypto.randomUUID(),
        name: list.name || "Untitled",
        items: Array.isArray(list.items) ? list.items : [],
      })),
      selectedListId: raw.selectedListId || raw.lists?.[0]?.id || "",
    };
  }

  const defaultLists = ["Home To Do", "Groceries"].map((name)=> ({
    id: crypto.randomUUID(),
    name,
    items: [],
  }));

  if(Array.isArray(raw) && raw.length){
    defaultLists[0].items = raw.map((item)=> ({
      id: item.id || crypto.randomUUID(),
      text: item.text || "(blank)",
      done: !!item.done,
      createdAt: item.createdAt || new Date().toISOString(),
    }));
  }

  return {
    lists: defaultLists,
    selectedListId: defaultLists[0]?.id || "",
  };
}

function setSaveStatus(txt){
  saveStatus.textContent = txt;
  state.meta.updatedAt = new Date().toISOString();
  savedLine.textContent = `Saved: ${new Date(state.meta.updatedAt).toLocaleString()}`;
}

function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(_){
    return null;
  }
}

function migrateState(baseState){
  if(!baseState || typeof baseState !== "object") return baseState;

  const stateToMigrate = { ...baseState };
  const meta = stateToMigrate.meta || {};
  const schema = Number(meta.schema || 1);

  if(schema < 2){
    stateToMigrate.calendars = stateToMigrate.calendars || {};
    if(!stateToMigrate.calendars.homeEmbedUrl){
      stateToMigrate.calendars.homeEmbedUrl = DEFAULT_HOME_CAL_URLS[0];
    }
  }

  if(schema < 3){
    stateToMigrate.calendars = stateToMigrate.calendars || {};
    stateToMigrate.calendars.homeEmbedUrls = [...DEFAULT_HOME_CAL_URLS];
    delete stateToMigrate.calendars.homeEmbedUrl;
  }

  if(schema < 4){
    stateToMigrate.todos = stateToMigrate.todos || { work: [], home: [] };
    stateToMigrate.todos.home = normalizeHomeTodoState(stateToMigrate.todos.home);
  }

  if(schema < 5){
    stateToMigrate.todos = stateToMigrate.todos || { work: [], home: [] };
    stateToMigrate.todos.workSort = stateToMigrate.todos.workSort || "manual";
  }

  if(schema < 6){
    stateToMigrate.notes = stateToMigrate.notes || {};
    stateToMigrate.notes.workNotes = stateToMigrate.notes.workNotes || "";
  }

  if(schema < 7){
    stateToMigrate.notes = stateToMigrate.notes || {};
    stateToMigrate.notes.mantra = stateToMigrate.notes.mantra || "Live And Not Just Survive";
    stateToMigrate.notes.workNotes = stateToMigrate.notes.workNotes || "";
    stateToMigrate.notes.mantraLastFetched = stateToMigrate.notes.mantraLastFetched || "";
    stateToMigrate.notes.mantraLastQuote = stateToMigrate.notes.mantraLastQuote || "";
    stateToMigrate.notes.mantraLastAuthor = stateToMigrate.notes.mantraLastAuthor || "";
  }

  if(schema < 8){
    stateToMigrate.todos = stateToMigrate.todos || { work: [], home: [] };
    stateToMigrate.todos.workFilter = stateToMigrate.todos.workFilter || "high";
  }

  if(schema < 9){
    stateToMigrate.weather = stateToMigrate.weather || {};
    stateToMigrate.weather.lastData = stateToMigrate.weather.lastData || null;
  }

  if(schema < 10){
    stateToMigrate.calendars = stateToMigrate.calendars || {};
    if(!stateToMigrate.calendars.workEmbedUrl){
      stateToMigrate.calendars.workEmbedUrl = DEFAULT_WORK_CAL_URL;
    }
  }

  stateToMigrate.meta = { ...meta, schema: CURRENT_SCHEMA };
  return stateToMigrate;
}

function defaultState(){
  const now = new Date().toISOString();
  const homeLists = ["Home To Do", "Groceries"].map((name)=> ({
    id: crypto.randomUUID(),
    name,
    items: [],
  }));
  return {
    meta: { createdAt: now, updatedAt: now, schema: CURRENT_SCHEMA },
    weather: { locationLabel: "Home", zip:"", lat:"", lon:"", lastText:"", lastData: null },
    calendars: { workEmbedUrl: DEFAULT_WORK_CAL_URL, homeEmbedUrls: [...DEFAULT_HOME_CAL_URLS] },
    verse: { lastText:"", lastRef:"", cachedAt:"" },
    todos: {
      work: [],
      workSort: "manual",
      workFilter: "high",
      home: { lists: homeLists, selectedListId: homeLists[0]?.id || "" }
    },
    notes: {
      mantra: "Live And Not Just Survive",
      workNotes: "",
      mantraLastFetched: "",
      mantraLastQuote: "",
      mantraLastAuthor: "",
    }
  };
}

function cap(s){ return (s||"").charAt(0).toUpperCase() + (s||"").slice(1); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function formatDueDate(value){
  if(!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if(Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function createTodoTextInput(todo, options = {}){
  const input = document.createElement("textarea");
  input.rows = 1;
  input.className = "todoText todoTextInput";
  input.value = todo.text || "";
  input.placeholder = "(blank)";
  input.setAttribute("aria-label", options.label || "Todo item");
  input.spellcheck = true;

  const resize = ()=> {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  };

  const commit = ()=>{
    const next = input.value.replace(/\s+/g, " ").trim();
    todo.text = next;
    input.value = next;
    resize();
    if(typeof options.onUpdate === "function"){
      options.onUpdate();
    }
  };

  input.addEventListener("input", ()=> {
    resize();
  });
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event)=> {
    if(event.key === "Enter"){
      event.preventDefault();
      input.blur();
    }
    if(event.key === "Escape"){
      event.preventDefault();
      input.value = todo.text || "";
      input.blur();
    }
  });

  resize();
  requestAnimationFrame(resize);
  return input;
}

function initCollapsibleCards(){
  document.querySelectorAll(".card").forEach((card)=> {
    if(card.dataset.collapsibleInitialized === "true") return;
    const header = card.querySelector(".cardHeader");
    const toggle = card.querySelector(".cardToggle");
    const body = card.querySelector(".cardBody");
    if(!header || !toggle || !body) return;
    card.dataset.collapsibleInitialized = "true";
    toggle.addEventListener("click", ()=> {
      const collapsed = card.classList.toggle("is-collapsed");
      toggle.textContent = collapsed ? "Expand" : "Collapse";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    });
  });
}

function getIcsProxyOrigin(){
  const params = new URLSearchParams(window.location.search);
  const fromQuery = (params.get("icsProxy") || "").trim();
  if(fromQuery){
    localStorage.setItem(ICS_PROXY_ORIGIN_KEY, fromQuery);
    return stripTrailingSlash(fromQuery);
  }

  const fromWindow = (window.ICS_PROXY_ORIGIN || "").trim();
  if(fromWindow){
    return stripTrailingSlash(fromWindow);
  }

  const fromStorage = (localStorage.getItem(ICS_PROXY_ORIGIN_KEY) || "").trim();
  if(fromStorage){
    return stripTrailingSlash(fromStorage);
  }

  if(window.location.hostname.endsWith("github.io")){
    return stripTrailingSlash(DEFAULT_ICS_PROXY_ORIGIN);
  }

  return window.location.origin;
}

function stripTrailingSlash(value){
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getLocalDateKey(date = new Date()){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchDailyQuote(){
  const quoteUrl = `${DAILY_QUOTE_PROXY_URL}${encodeURIComponent(DAILY_QUOTE_API_URL)}`;
  const res = await fetch(quoteUrl, { cache: "no-store" });
  if(!res.ok){
    throw new Error("Quote service unavailable.");
  }
  const data = await res.json();
  if(!Array.isArray(data) || !data.length){
    throw new Error("Unexpected quote response.");
  }

  const todayKey = getLocalDateKey();
  const dateSeed = Number(todayKey.replaceAll("-", "")) || Date.now();
  const index = dateSeed % data.length;
  const entry = data[index] || {};
  const content = String(entry?.text || "").trim();
  const author = String(entry?.author || "").trim();

  if(!content){
    throw new Error("Unexpected quote response.");
  }

  const text = author ? `“${content}” — ${author}` : `“${content}”`;
  return { text, content, author };
}

async function refreshDailyMantraQuote(){
  const todayKey = getLocalDateKey();
  if(state.notes?.mantraLastFetched === todayKey){
    return;
  }

  try{
    const quote = await fetchDailyQuote();
    state.notes = state.notes || {};
    state.notes.mantra = quote.text;
    state.notes.mantraLastFetched = todayKey;
    state.notes.mantraLastQuote = quote.content;
    state.notes.mantraLastAuthor = quote.author;
    autoSave();
    render();
  }catch(err){
    console.warn("Daily quote fetch failed.", err);
  }
}

async function fetchVerseOfDay(){
  const verseUrl = "https://beta.ourmanna.com/api/v1/get/?format=json";
  const res = await fetch(verseUrl);
  if(!res.ok){
    throw new Error("Verse service unavailable.");
  }
  const data = await res.json();
  const text = (data?.verse?.details?.text || "").trim();
  const reference = (data?.verse?.details?.reference || "").trim();
  const version = (data?.verse?.details?.version || "").trim();

  if(!text || !reference){
    throw new Error("Unexpected verse response.");
  }

  return {
    text: `“${text}”`,
    reference: version ? `${reference} (${version})` : reference,
  };
}

async function fetchWeather(){
  const label = (state.weather.locationLabel || "Home").trim();
  const latRaw = state.weather.lat.trim();
  const lonRaw = state.weather.lon.trim();
  const zip = state.weather.zip.trim();

  let location = null;
  if(latRaw && lonRaw){
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if(Number.isNaN(lat) || Number.isNaN(lon)){
      throw new Error("Latitude/longitude must be numbers.");
    }
    location = { lat, lon, name: label };
  }else if(zip){
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", zip);
    geoUrl.searchParams.set("count", "1");
    geoUrl.searchParams.set("language", "en");
    geoUrl.searchParams.set("format", "json");
    const geoRes = await fetch(geoUrl);
    if(!geoRes.ok){
      throw new Error("Unable to find that ZIP code.");
    }
    const geo = await geoRes.json();
    const hit = geo?.results?.[0];
    if(!hit){
      throw new Error("Unable to find that ZIP code.");
    }
    location = {
      lat: hit.latitude,
      lon: hit.longitude,
      name: `${hit.name}${hit.admin1 ? `, ${hit.admin1}` : ""}`,
    };
  }else{
    throw new Error("Add a ZIP or latitude/longitude first.");
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", location.lat);
  forecastUrl.searchParams.set("longitude", location.lon);
  forecastUrl.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code");
  forecastUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code");
  forecastUrl.searchParams.set("temperature_unit", "fahrenheit");
  forecastUrl.searchParams.set("timezone", "auto");

  const forecastRes = await fetch(forecastUrl);
  if(!forecastRes.ok){
    throw new Error("Weather service unavailable.");
  }
  const data = await forecastRes.json();

  const current = data.current || {};
  const daily = data.daily || {};
  const weatherCode = current.weather_code ?? daily.weather_code?.[0];
  const description = describeWeatherCode(weatherCode);
  const icon = getWeatherIcon(weatherCode);

  const currentTemp = formatTemp(current.temperature_2m);
  const feelsLike = formatTemp(current.apparent_temperature);
  const high = formatTemp(daily.temperature_2m_max?.[0]);
  const low = formatTemp(daily.temperature_2m_min?.[0]);
  const updatedAt = new Date().toLocaleString();

  const linkUrl = zip
    ? new URL(`https://weather.com/weather/today/l/${encodeURIComponent(zip)}`)
    : new URL("https://weather.com/");

  const lines = [
    `Weather for ${location.name || label}${zip ? ` (${zip})` : ""}`,
    "",
    `${description}`,
    `Now: ${currentTemp}${feelsLike ? ` (feels like ${feelsLike})` : ""}`,
    `High: ${high} · Low: ${low}`,
    `Updated: ${updatedAt}`
  ];

  return {
    text: lines.join("\n"),
    data: {
      locationName: location.name || label,
      zip,
      description,
      currentTemp,
      feelsLike,
      high,
      low,
      updatedAt,
      icon,
      linkUrl: linkUrl.toString(),
    },
  };
}

function formatTemp(value){
  if(value === undefined || value === null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))}°F`;
}

function describeWeatherCode(code){
  const table = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snowfall",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  if(code === undefined || code === null) return "Weather unavailable";
  return table[code] || "Weather unavailable";
}

function getWeatherIcon(code){
  if(code === undefined || code === null){
    return { symbol: "❔", label: "Unknown" };
  }
  if(code === 0) return { symbol: "☀️", label: "Clear" };
  if(code <= 2) return { symbol: "🌤️", label: "Mostly clear" };
  if(code === 3) return { symbol: "☁️", label: "Overcast" };
  if(code === 45 || code === 48) return { symbol: "🌫️", label: "Fog" };
  if(code >= 51 && code <= 57) return { symbol: "🌦️", label: "Drizzle" };
  if(code >= 61 && code <= 67) return { symbol: "🌧️", label: "Rain" };
  if(code >= 71 && code <= 77) return { symbol: "❄️", label: "Snow" };
  if(code >= 80 && code <= 82) return { symbol: "🌧️", label: "Showers" };
  if(code >= 85 && code <= 86) return { symbol: "🌨️", label: "Snow showers" };
  if(code >= 95) return { symbol: "⛈️", label: "Thunderstorm" };
  return { symbol: "🌥️", label: "Cloudy" };
}
