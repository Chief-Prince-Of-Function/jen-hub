/* =========================
   Simple Sister Hub v0
   - Looks like your screenshot
   - Local save first (localStorage)
   - Later: swap save/load to Worker KV
========================= */

const LS_KEY = "sister_hub_local_v0";

const el = (id)=> document.getElementById(id);

const clockEl = el("clock");
const dateLine = el("dateLine");
const savedLine = el("savedLine");

const weatherLabel = el("weatherLabel");
const weatherZip   = el("weatherZip");
const weatherLat   = el("weatherLat");
const weatherLon   = el("weatherLon");
const btnWeatherRefresh = el("btnWeatherRefresh");
const weatherStatus = el("weatherStatus");
const weatherOut = el("weatherOut");

const btnVerseRefresh = el("btnVerseRefresh");
const verseStatus = el("verseStatus");
const verseOut = el("verseOut");

const mantra = el("mantra");
const mantraBig = el("mantraBig");

const workCal = el("workCal");
const workCalPreview = el("workCalPreview");

const homeCal = el("homeCal");
const homeCalPreview = el("homeCalPreview");

const todoText = el("todoText");
const todoPriority = el("todoPriority");
const todoAddBtn = el("todoAddBtn");
const todoList = el("todoList");

const btnSave = el("btnSave");
const btnReset = el("btnReset");
const saveStatus = el("saveStatus");

let state = loadLocal() || defaultState();

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

/* =========================
   Render
========================= */
function render(){
  weatherLabel.value = state.weather.locationLabel || "";
  weatherZip.value = state.weather.zip || "";
  weatherLat.value = state.weather.lat || "";
  weatherLon.value = state.weather.lon || "";

  mantra.value = state.notes.mantra || "";
  mantraBig.textContent = (state.notes.mantra || "Live And Not Just Survive").trim() || "Live And Not Just Survive";

  workCal.value = state.calendars.workEmbedUrl || "";
  homeCal.value = state.calendars.homeEmbedUrl || "";

  renderEmbed(workCal.value, workCalPreview);
  renderEmbed(homeCal.value, homeCalPreview);

  verseOut.textContent = state.verse.lastText
    ? `${state.verse.lastText}\n\n— ${state.verse.lastRef || ""}\n\nCached: ${state.verse.cachedAt || ""}`
    : "Not loaded yet.";

  weatherOut.textContent = state.weather.lastText || "Not loaded yet.";

  todoList.innerHTML = "";
  (state.todos.work || []).forEach((t)=> todoList.appendChild(todoRow(t)));

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

function todoRow(t){
  const row = document.createElement("div");
  row.className = "todoItem";

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

  const title = document.createElement("div");
  title.className = "todoText";
  title.textContent = t.text || "(blank)";

  const meta = document.createElement("div");
  meta.className = "todoMeta";
  meta.textContent = t.createdAt
    ? `Added: ${new Date(t.createdAt).toLocaleDateString()}`
    : "";

  textWrap.appendChild(title);
  textWrap.appendChild(meta);

  left.appendChild(check);
  left.appendChild(textWrap);

  const tag = document.createElement("div");
  tag.className = `tag ${t.priority || "med"}`;
  tag.textContent = `Priority: ${cap(t.priority || "med")}`;

  row.appendChild(left);
  row.appendChild(tag);

  return row;
}

/* =========================
   Events
========================= */
weatherLabel.addEventListener("input", ()=>{
  state.weather.locationLabel = weatherLabel.value;
  autoSave();
});

[weatherZip, weatherLat, weatherLon].forEach((inp)=>{
  inp.addEventListener("input", ()=>{
    state.weather.zip = weatherZip.value.trim();
    state.weather.lat = weatherLat.value.trim();
    state.weather.lon = weatherLon.value.trim();
    autoSave();
  });
});

mantra.addEventListener("input", ()=>{
  state.notes.mantra = mantra.value;
  mantraBig.textContent = mantra.value || "Live And Not Just Survive";
  autoSave();
});

workCal.addEventListener("input", ()=>{
  state.calendars.workEmbedUrl = workCal.value.trim();
  renderEmbed(workCal.value, workCalPreview);
  autoSave();
});

homeCal.addEventListener("input", ()=>{
  state.calendars.homeEmbedUrl = homeCal.value.trim();
  renderEmbed(homeCal.value, homeCalPreview);
  autoSave();
});

todoAddBtn.addEventListener("click", addTodo);
todoText.addEventListener("keydown", (e)=>{
  if(e.key === "Enter") addTodo();
});

btnSave.addEventListener("click", ()=>{
  saveLocal(state);
  setSaveStatus("Saved ✅");
});

btnReset.addEventListener("click", ()=>{
  if(!confirm("Reset everything on THIS device?")) return;
  localStorage.removeItem(LS_KEY);
  state = defaultState();
  setSaveStatus("Reset.");
  render();
});

btnVerseRefresh.addEventListener("click", async ()=>{
  // Placeholder until we wire a real verse API
  verseStatus.textContent = "Loading…";
  verseStatus.classList.remove("muted");

  await sleep(500);

  state.verse.lastText = "“Be strong and courageous. Do not be afraid...”";
  state.verse.lastRef = "Joshua 1:9";
  state.verse.cachedAt = new Date().toLocaleString();

  verseStatus.textContent = "OK";
  verseStatus.classList.add("muted");

  autoSave();
  render();
});

btnWeatherRefresh.addEventListener("click", async ()=>{
  weatherStatus.textContent = "Loading…";
  weatherStatus.classList.remove("muted");

  // Placeholder until we wire real weather
  await sleep(500);

  const label = state.weather.locationLabel || "Home";
  const zip = state.weather.zip ? ` (${state.weather.zip})` : "";
  state.weather.lastText = `Weather for ${label}${zip}\n\nSunny-ish.\nHigh: 72°F\nLow: 55°F`;

  weatherStatus.textContent = "OK";
  weatherStatus.classList.add("muted");

  autoSave();
  render();
});

/* =========================
   Helpers
========================= */
function addTodo(){
  const txt = (todoText.value || "").trim();
  if(!txt) return;

  const p = todoPriority.value || "med";

  state.todos.work = state.todos.work || [];
  state.todos.work.unshift({
    id: crypto.randomUUID(),
    text: txt,
    priority: p,
    done: false,
    createdAt: new Date().toISOString()
  });

  todoText.value = "";
  autoSave();
  render();
}

let _saveTimer = null;
function autoSave(){
  // debounced local save
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(()=>{
    saveLocal(state);
    setSaveStatus("Auto-saved");
  }, 400);
}

function setSaveStatus(txt){
  saveStatus.textContent = txt;
  state.meta.updatedAt = new Date().toISOString();
  savedLine.textContent = `Saved: ${new Date(state.meta.updatedAt).toLocaleString()}`;
}

function saveLocal(obj){
  try{
    obj.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  }catch(e){}
}

function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){
    return null;
  }
}

function defaultState(){
  const now = new Date().toISOString();
  return {
    meta: { createdAt: now, updatedAt: now, schema: 1 },
    weather: { locationLabel: "Home", zip:"", lat:"", lon:"", lastText:"" },
    calendars: { workEmbedUrl:"", homeEmbedUrl:"" },
    verse: { lastText:"", lastRef:"", cachedAt:"" },
    todos: { work: [], home: [] },
    notes: { mantra: "Live And Not Just Survive" }
  };
}

function cap(s){ return (s||"").charAt(0).toUpperCase() + (s||"").slice(1); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* Boot */
render();
setSaveStatus("Loaded");
