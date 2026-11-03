"use strict";
const DEFAULT_TARGET = 120;
const TARGET_KEY = "domino-points-to-win-v1";
let TARGET = loadTarget();
const STORE_KEY = "skyjo-state-v1";
const THEME_KEY = "skyjo-theme-v1";

function loadTarget(){
  const saved = Number(localStorage.getItem(TARGET_KEY));
  return Number.isSafeInteger(saved) && saved > 0 ? saved : DEFAULT_TARGET;
}

let state = load() || {
  players: [],     // {id, name}
  rounds: [],      // [{ scores:{id:n}, raw:{id:n}, closerId, doubledId }]
  picks: {},       // working round: id -> {cards:[v,...]}
  committed: {},   // player id -> whether their current round score is confirmed
  closerId: null,  // who closed the working round
  groups: [],      // saved rosters for quick re-use: [{id, names:[...]}]
};
if(!state.groups) state.groups = [];   // migrate states saved before groups existed
if(!state.committed) state.committed = {}; // migrate older saved games
let playerDrag = null;
let scorecardUndoStack = [];
let scorecardRedoStack = [];

/* ---------- persistence ---------- */
function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function load(){ try{ return JSON.parse(localStorage.getItem(STORE_KEY)); }catch(e){ return null; } }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

/* ---------- model helpers ---------- */
function getPicks(id){ if(!state.picks[id]) state.picks[id] = { cards:[] }; return state.picks[id]; }
function roundScore(id){
  const cards = getPicks(id).cards;
  return cards.length ? Number(cards[cards.length - 1]) : 0;
}
// has the current working round had any input yet?
function anyPicks(){
  const anyCards = state.players.some(pl=>{
    const p = state.picks[pl.id];
    return p && p.cards && p.cards.length > 0;
  });
  return anyCards || !!state.closerId;
}
function allPlayersCommitted(){
  return state.players.length > 0 && state.players.every(pl=>state.committed[pl.id] === true);
}

function cardClass(v){
  if(v < 0) return "neg";
  if(v === 0) return "zero";
  if(v <= 4) return "low";
  if(v <= 8) return "mid";
  return "high";
}

function totalFor(id){
  let t = 0;
  state.rounds.forEach(r => {
    t += Number(r.scores[id]||0);
  });
  return t;
}
function highestTotal(){
  if(state.players.length === 0) return 0;
  return Math.max(...state.players.map(pl => totalFor(pl.id)));
}
function gameOver(){ return highestTotal() >= TARGET; }

/* ---------- rendering ---------- */
function render(){
  renderWin();
  renderGameResults();
  renderStandings();
  renderRoundEntry();
  renderHistory();
  renderGroups();
  document.getElementById("roundTitle").textContent = "Round " + (state.rounds.length + 1) + " Scorecards";
  updateScorecardHistoryControls();
  document.querySelector(".commitbar").hidden = !allPlayersCommitted() || !state.players.some(player=>player.id===state.closerId);
  save();
}

function scorecardSnapshot(){
  return {
    picks: JSON.parse(JSON.stringify(state.picks)),
    committed: {...state.committed},
    closerId: state.closerId
  };
}
function recordScorecardChange(){
  scorecardUndoStack.push(scorecardSnapshot());
  if(scorecardUndoStack.length > 100) scorecardUndoStack.shift();
  scorecardRedoStack = [];
}
function restoreScorecardSnapshot(snapshot){
  state.picks = snapshot.picks;
  state.committed = snapshot.committed;
  state.closerId = snapshot.closerId;
}
function updateScorecardHistoryControls(){
  document.getElementById("scorecardUndo").disabled = scorecardUndoStack.length === 0;
  document.getElementById("scorecardRedo").disabled = scorecardRedoStack.length === 0;
}
function undoScorecardAction(){
  if(scorecardUndoStack.length === 0) return;
  scorecardRedoStack.push(scorecardSnapshot());
  restoreScorecardSnapshot(scorecardUndoStack.pop());
  render();
}
function redoScorecardAction(){
  if(scorecardRedoStack.length === 0) return;
  scorecardUndoStack.push(scorecardSnapshot());
  restoreScorecardSnapshot(scorecardRedoStack.pop());
  render();
}
function clearScorecardHistory(){
  scorecardUndoStack = [];
  scorecardRedoStack = [];
}

function ordinal(place){
  const remainder = place % 100;
  if(remainder >= 11 && remainder <= 13) return place + "th";
  return place + ({1:"st",2:"nd",3:"rd"}[place % 10] || "th");
}

function renderGameResults(){
  const backdrop = document.getElementById("resultsBackdrop");
  if(!gameOver() || state.players.length === 0){
    state.resultsDismissedFor = null;
    backdrop.hidden = true;
    return;
  }
  const results = state.players.map(player=>({player,total:totalFor(player.id)}))
    .sort((a,b)=>b.total-a.total || a.player.name.localeCompare(b.player.name));
  const resultKey = results.map(result=>`${result.player.id}:${result.total}`).join("|");
  if(state.resultsDismissedFor === resultKey) return;

  const winningScore = results[0].total;
  const winners = results.filter(result=>result.total === winningScore);
  const winnerNames = winners.map(result=>escapeHtml(result.player.name)).join(" &amp; ");
  document.getElementById("resultsWinner").innerHTML = winners.length > 1
    ? `${winnerNames} tie with <b>${winningScore}</b> ${winningScore === 1 ? "point" : "points"}.`
    : `${winnerNames} wins with <b>${winningScore}</b> ${winningScore === 1 ? "point" : "points"}.`;

  let previousScore = null;
  let place = 0;
  document.getElementById("resultsList").innerHTML = results.map((result,index)=>{
    if(result.total !== previousScore) place = index + 1;
    previousScore = result.total;
    return `<li class="result-row ${result.total === winningScore ? "winner" : ""}">
      <span class="result-place">${ordinal(place)}</span>
      <span class="result-name">${escapeHtml(result.player.name)}</span>
      <span class="result-score">${result.total}</span>
    </li>`;
  }).join("");
  backdrop.hidden = false;
}

function returnToScoreboard(){
  const results = state.players.map(player=>({player,total:totalFor(player.id)}))
    .sort((a,b)=>b.total-a.total || a.player.name.localeCompare(b.player.name));
  state.resultsDismissedFor = results.map(result=>`${result.player.id}:${result.total}`).join("|");
  document.getElementById("resultsBackdrop").hidden = true;
  save();
  document.getElementById("standings").scrollIntoView({behavior:"smooth",block:"start"});
}

function renderWin(){
  const wrap = document.getElementById("winWrap");
  if(!gameOver() || state.players.length === 0){ wrap.innerHTML = ""; return; }
  const high = highestTotal();
  const winnersList = state.players.filter(p => totalFor(p.id) === high);
  const names = winnersList.map(p=>p.name).join(" & ");
  const txt = winnersList.length>1
    ? "🏆 Tie at " + high + "! " + names + " win"
    : "🏆 " + names + " wins with " + high + "!";
  wrap.innerHTML = '<section><div class="winbanner">'+escapeHtml(txt)+'</div></section>';
}

function renderStandings(){
  const el = document.getElementById("standings");
  const previousRows = new Map([...el.querySelectorAll(".prow")].map((row,index)=>[
    row.dataset.playerId,
    { top:row.getBoundingClientRect().top, total:Number(row.querySelector(".tot").textContent), index }
  ]));
  if(state.players.length === 0){
    el.innerHTML = '<div class="empty">No players yet — add some at the bottom to start.</div>';
    return;
  }
  const high = highestTotal();
  const over = gameOver();
  const sorted = state.players.slice().sort((a,b)=> totalFor(b.id)-totalFor(a.id)); // highest total first
  el.innerHTML = sorted.map((pl,i)=>{
    const tot = totalFor(pl.id);
    const room = Math.max(0, TARGET - tot);
    const isLead = tot === high;
    const isOut = tot >= TARGET;
    const pct = Math.min(100, tot/TARGET*100);
    const awayHtml = isOut ? '<b>OVER '+TARGET+'</b>'
                           : '<b>'+room+'</b><br>to '+TARGET;
    return `<div class="prow ${isOut?'out':''} ${isLead?'lead':''} ${(!isOut&&room<=20&&!isLead)?'danger':''}" data-player-id="${pl.id}">
      <div class="rank">${i+1}</div>
      <div style="flex:1 1 auto; min-width:0;">
        <div class="nm" onclick="renamePlayer('${pl.id}')" title="tap to rename">${escapeHtml(pl.name)}${isLead?' 🟢':''}</div>
        <div class="barwrap"><div class="bar" style="width:${pct}%"></div></div>
      </div>
      <div class="tot">${tot}</div>
      <div class="away">${awayHtml}</div>
      <div class="x" onclick="deletePlayer('${pl.id}')" title="remove">✕</div>
    </div>`;
  }).join("");

  const rows = [...el.querySelectorAll(".prow")];
  rows.forEach((row,index)=>{
    const before = previousRows.get(row.dataset.playerId);
    if(!before) return;
    const afterTop = row.getBoundingClientRect().top;
    const scoreChanged = before.total !== Number(row.querySelector(".tot").textContent);
    const moved = Math.abs(before.top - afterTop) > 1;
    if(moved){
      row.style.transform = `translateY(${before.top-afterTop}px)`;
      row.style.transition = "none";
    }
    if(scoreChanged) row.classList.add("score-updated");
    if(moved) requestAnimationFrame(()=>{
      row.style.transition = "transform 1100ms cubic-bezier(.2,.72,.22,1)";
      row.style.transform = "translateY(0)";
      window.setTimeout(()=>{ row.style.transition=""; row.style.transform=""; },1150);
    });
    if(scoreChanged) window.setTimeout(()=>row.classList.remove("score-updated"),1150);
  });
}

function renderRoundEntry(){
  const el = document.getElementById("roundEntry");
  const canReorderPlayers = state.rounds.length === 0;
  const previousOrder = new Map([...el.querySelectorAll(".player-round")].map((card,index)=>[
    card.dataset.playerId,
    {top:card.getBoundingClientRect().top,index}
  ]));
  if(state.players.length === 0){
    el.innerHTML = '<div class="empty">Add players to begin scoring a round.</div>';
    return;
  }
  el.innerHTML = state.players.map(pl=>{
    const picks = getPicks(pl.id).cards;
    const selected = picks.length ? Number(picks[picks.length - 1]) : null;
    const scorePadBtns = [1,2,3,4,6,8].map(v=>
      `<button type="button" class="score-pad-btn ${selected===v?'is-selected':''}" aria-pressed="${selected===v}" onclick="selectScorePad('${pl.id}',${v})">${v}</button>`
    ).join("");
    const isCloser = state.closerId === pl.id;
    const isCommitted = state.committed[pl.id] === true;
    return `<div class="player-round" data-player-id="${pl.id}">
      <div class="pr-head">
        ${canReorderPlayers ? `<button type="button" class="drag-handle" aria-label="Reorder ${escapeHtml(pl.name)}; use the up and down arrow keys" title="Drag to reorder players">⠿</button>` : ""}
        <div class="nm">${escapeHtml(pl.name)}</div>
        <button type="button" class="chip outfirst ${isCloser?'on':''}" onclick="toggleCloser('${pl.id}')" title="mark as the first player to declare">First to Declare</button>
      </div>
      <div class="pr-body">
        <div class="score-pad-section">
          <div class="score-pad-label">Score pads</div>
          <div class="score-pad"><button type="button" class="score-pad-btn score-pad-zero ${selected===0?'is-selected':''}" aria-pressed="${selected===0}" onclick="selectScorePad('${pl.id}',0)">0</button>${scorePadBtns}</div>
        </div>
      </div>
      <div class="pr-foot">
        <button class="btn small accent" onclick="undoCard('${pl.id}')">↶ Undo</button>
        <button class="btn small danger" onclick="clearPicks('${pl.id}')">Clear</button>
        <button class="btn small score-commit ${isCommitted?'is-committed':''}" onclick="togglePlayerCommit('${pl.id}')" aria-pressed="${isCommitted}">${isCommitted?'Scores Committed ✓':'Commit Scores'}</button>
      </div>
    </div>`;
  }).join("");

  [...el.querySelectorAll(".player-round")].forEach((card,index)=>{
    const previous = previousOrder.get(card.dataset.playerId);
    if(!previous || previous.index === index) return;
    const newTop = card.getBoundingClientRect().top;
    card.style.transform = `translateY(${previous.top-newTop}px)`;
    card.style.transition = "none";
    requestAnimationFrame(()=>{
      card.style.transition = "transform 700ms cubic-bezier(.2,.72,.22,1)";
      card.style.transform = "translateY(0)";
      window.setTimeout(()=>{card.style.transition="";card.style.transform="";},750);
    });
  });
}

function clearPlayerDrag(){
  if(!playerDrag) return;
  document.querySelectorAll(".player-round.dragging,.player-round.drop-before,.player-round.drop-after")
    .forEach(card=>card.classList.remove("dragging","drop-before","drop-after"));
  playerDrag = null;
}

function handlePlayerPointerDown(event){
  const handle = event.target.closest(".drag-handle");
  if(!handle || (event.pointerType === "mouse" && event.button !== 0)) return;
  const card = handle.closest(".player-round");
  if(!card) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  playerDrag = {id:card.dataset.playerId,pointerId:event.pointerId,startY:event.clientY,lastY:event.clientY,active:false};
}

function handlePlayerPointerMove(event){
  if(!playerDrag || event.pointerId !== playerDrag.pointerId) return;
  playerDrag.lastY = event.clientY;
  const source = document.querySelector(`.player-round[data-player-id="${playerDrag.id}"]`);
  if(!source) return;
  if(!playerDrag.active && Math.abs(event.clientY-playerDrag.startY) < 6) return;
  playerDrag.active = true;
  source.classList.add("dragging");
  source.style.transform = `translateY(${event.clientY-playerDrag.startY}px)`;
  document.querySelectorAll(".player-round.drop-before,.player-round.drop-after")
    .forEach(card=>card.classList.remove("drop-before","drop-after"));
  const target = document.elementsFromPoint(event.clientX,event.clientY)
    .map(element=>element.closest(".player-round"))
    .find(card=>card && card !== source);
  if(target){
    const rect = target.getBoundingClientRect();
    target.classList.add(event.clientY > rect.top+rect.height/2 ? "drop-after" : "drop-before");
  }
}

function handlePlayerPointerUp(event){
  if(!playerDrag || event.pointerId !== playerDrag.pointerId) return;
  const drag = playerDrag;
  const source = document.querySelector(`.player-round[data-player-id="${drag.id}"]`);
  let target = null;
  let after = false;
  if(drag.active){
    target = document.elementsFromPoint(event.clientX,event.clientY)
      .map(element=>element.closest(".player-round"))
      .find(card=>card && card !== source);
    if(target){
      const rect = target.getBoundingClientRect();
      after = event.clientY > rect.top+rect.height/2;
    }
  }
  if(source) source.style.transform = "";
  clearPlayerDrag();
  if(!target) return;
  const fromIndex = state.players.findIndex(player=>player.id===drag.id);
  const targetIndex = state.players.findIndex(player=>player.id===target.dataset.playerId);
  if(fromIndex < 0 || targetIndex < 0) return;
  let insertIndex = targetIndex + (after ? 1 : 0);
  const [player] = state.players.splice(fromIndex,1);
  if(fromIndex < insertIndex) insertIndex--;
  state.players.splice(insertIndex,0,player);
  if(fromIndex !== insertIndex) render();
}

function handlePlayerHandleKeydown(event){
  if(event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const handle = event.target.closest(".drag-handle");
  if(!handle) return;
  event.preventDefault();
  const id = handle.closest(".player-round").dataset.playerId;
  const index = state.players.findIndex(player=>player.id===id);
  const nextIndex = Math.max(0,Math.min(state.players.length-1,index+(event.key === "ArrowUp" ? -1 : 1)));
  if(index === nextIndex) return;
  const [player] = state.players.splice(index,1);
  state.players.splice(nextIndex,0,player);
  render();
  document.querySelector(`.player-round[data-player-id="${id}"] .drag-handle`)?.focus();
}

function renderHistory(){
  const t = document.getElementById("history");
  if(state.players.length === 0){ t.innerHTML = ""; return; }
  let head = '<thead><tr><th>R</th>' +
    state.players.map(pl=>`<th>${escapeHtml(pl.name)}</th>`).join("") +
    '<th></th></tr></thead>';
  let rows = state.rounds.map((r,ri)=>{
    const cells = state.players.map(pl=>{
      const v = Number(r.scores[pl.id]||0);
      const crowned = r.closerId === pl.id;
      const doubled = r.doubledId === pl.id;
      const ind = (crowned?'👑':'') + (doubled?'<span class="x2">(×2)</span>':'');
      return `<td class="${doubled?'dbl':''}">
        <div class="scorecell">
          <input type="number" inputmode="numeric" value="${v}" title="${crowned?'closed this round':''}${doubled?' (doubled)':''}"
          onchange="editScore(${ri},'${pl.id}',this.value)">${ind?`<span class="ind">${ind}</span>`:''}
        </div>
      </td>`;
    }).join("");
    return `<tr><td class="rndlbl">${ri+1}</td>${cells}<td><span class="delr" onclick="deleteRound(${ri})" title="delete round">✕</span></td></tr>`;
  }).join("");
  if(state.rounds.length === 0){
    rows = `<tr><td class="rndlbl">—</td><td colspan="${state.players.length+1}" class="empty" style="padding:10px;">No rounds committed yet.</td></tr>`;
  }
  let foot = '<tfoot><tr><td class="rndlbl">Σ</td>' +
    state.players.map(pl=>`<td>${totalFor(pl.id)}</td>`).join("") +
    '<td></td></tr></tfoot>';
  t.innerHTML = head + '<tbody>'+rows+'</tbody>' + foot;
}

function renderGroups(){
  const el = document.getElementById("groups");
  if(!el) return;
  if(!state.groups || state.groups.length === 0){ el.innerHTML = ""; return; }
  el.innerHTML = '<div class="groups-lbl">Saved player groups — tap to start a new game</div>' +
    state.groups.map(g=>
      `<div class="grp">
        <button class="grp-use" onclick="useGroup('${g.id}')" title="new game with these players">${escapeHtml(g.names.join(", "))}</button>
        <span class="grp-x" onclick="deleteGroup('${g.id}')" title="remove group">✕</span>
      </div>`
    ).join("");
}

/* ---------- actions ---------- */
function addPlayer(){
  const inp = document.getElementById("newPlayerName");
  const name = inp.value.trim();
  if(!name) return;
  clearScorecardHistory();
  state.players.push({ id:uid(), name });
  inp.value = "";
  render();
}
async function deletePlayer(id){
  const pl = state.players.find(p=>p.id===id);
  if(!pl) return;
  if(!(await confirmModal("Remove "+pl.name+"? Their scores in all rounds will be dropped.", "Remove"))) return;
  clearScorecardHistory();
  state.players = state.players.filter(p=>p.id!==id);
  delete state.picks[id];
  delete state.committed[id];
  if(state.closerId === id) state.closerId = null;
  state.rounds.forEach(r=>{ delete r.scores[id]; if(r.raw) delete r.raw[id]; });
  render();
}
function renamePlayer(id){
  const pl = state.players.find(p=>p.id===id);
  if(!pl) return;
  const nn = prompt("Rename player:", pl.name);
  if(nn && nn.trim()){ pl.name = nn.trim().slice(0,18); render(); }
}
function invalidateCommit(id){ delete state.committed[id]; }
function selectScorePad(id,v){
  recordScorecardChange();
  getPicks(id).cards = [Number(v)];
  invalidateCommit(id);
  render();
}
function undoCard(id){
  if(getPicks(id).cards.length === 0) return;
  recordScorecardChange();
  getPicks(id).cards = [];
  invalidateCommit(id);
  render();
}
function clearPicks(id){
  if(getPicks(id).cards.length === 0 && state.committed[id] !== true) return;
  recordScorecardChange();
  state.picks[id] = {cards:[]};
  invalidateCommit(id);
  render();
}
function togglePlayerCommit(id){
  recordScorecardChange();
  if(state.committed[id]) delete state.committed[id];
  else state.committed[id] = true;
  render();
}
function toggleCloser(id){
  recordScorecardChange();
  state.closerId = (state.closerId === id) ? null : id;
  render();
}

function commitRound(){
  if(state.players.length === 0){ alert("Add players first."); return; }
  if(!allPlayersCommitted() || !state.players.some(player=>player.id===state.closerId)) return;

  const raw = {};
  state.players.forEach(pl=>{ raw[pl.id] = roundScore(pl.id); });

  const scores = Object.assign({}, raw);
  let doubledId = null;
  const closer = state.closerId;

  if(closer && state.players.some(p=>p.id===closer)){
    const cs = raw[closer];
    const others = state.players.filter(p=>p.id!==closer).map(p=>raw[p.id]);
    const strictlyLowest = others.every(o => cs < o);
    // Skyjo rule: closer doubles unless they alone have the lowest; no penalty if score <= 0
    if(cs > 0 && !strictlyLowest){
      scores[closer] = cs * 2;
      doubledId = closer;
    }
  }

  state.rounds.push({ scores, raw, closerId: closer || null, doubledId });
  clearScorecardHistory();
  rememberGroup();  // this roster is now a reusable player group
  state.picks = {};
  state.committed = {};
  state.closerId = null;
  render();
  window.scrollTo({ top:0, behavior:"smooth" });
}

function groupKey(names){ return names.map(n=>n.trim().toLowerCase()).sort().join("\u0001"); }
function rememberGroup(){
  const names = state.players.map(p=>p.name.trim()).filter(Boolean);
  if(names.length === 0) return;
  const key = groupKey(names);
  if(state.groups.some(g=> groupKey(g.names) === key)) return; // identical roster already saved
  state.groups.push({ id:uid(), names });
}
async function useGroup(id){
  const g = state.groups.find(x=>x.id===id);
  if(!g) return;
  if((state.rounds.length > 0 || anyPicks()) &&
     !(await confirmModal("Start a new game with " + g.names.join(", ") + "? This clears the current game.", "Start"))) return;
  state.players = g.names.map(n=>({ id:uid(), name:n }));
  clearScorecardHistory();
  state.rounds = [];
  state.picks = {};
  state.committed = {};
  state.closerId = null;
  render();
  window.scrollTo({ top:0, behavior:"smooth" });
}
function deleteGroup(id){
  state.groups = state.groups.filter(g=>g.id!==id);
  render();
}

function editScore(roundIdx, id, val){
  const v = Math.round(Number(val)||0);
  state.rounds[roundIdx].scores[id] = v;
  render();
}
async function deleteRound(idx){
  if(!(await confirmModal("Delete round "+(idx+1)+"?", "Delete"))) return;
  state.rounds.splice(idx,1);
  render();
}
async function newGame(){
  const choice = await confirmModal(
    "Start a new game? Keep the current players or clear the roster and add new players.",
    "Keep Players",
    "New Players"
  );
  if(!choice) return;
  clearScorecardHistory();
  if(choice === "alternate") state.players = [];
  state.rounds = [];
  state.picks = {};
  state.committed = {};
  state.closerId = null;
  render();
}

/* custom confirm — native confirm() is blocked/suppressed by some browsers (e.g. Brave) */
function confirmModal(message, okLabel, alternateLabel){
  return new Promise(resolve=>{
    const back = document.getElementById("modalBack");
    const msg = document.getElementById("modalMsg");
    const ok = document.getElementById("modalOk");
    const cancel = document.getElementById("modalCancel");
    const alternate = document.getElementById("modalAlternate");
    msg.textContent = message;
    ok.textContent = okLabel || "OK";
    alternate.textContent = alternateLabel || "";
    alternate.hidden = !alternateLabel;
    back.classList.add("show");
    function done(result){
      back.classList.remove("show");
      ok.onclick = cancel.onclick = alternate.onclick = back.onclick = null;
      resolve(result);
    }
    ok.onclick = ()=> done(true);
    cancel.onclick = ()=> done(false);
    alternate.onclick = ()=> done("alternate");
    back.onclick = e=>{ if(e.target === back) done(false); };
  });
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- appearance ---------- */
function setTheme(theme){
  const selected = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = selected;
  localStorage.setItem(THEME_KEY, selected);
  document.querySelectorAll("[data-theme-choice]").forEach(button=>{
    const active = button.dataset.themeChoice === selected;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector('meta[name="theme-color"]').content = selected === "dark" ? "#191b1f" : "#ffffff";
}

/* ---------- wire up ---------- */
document.getElementById("addPlayerBtn").onclick = addPlayer;
document.getElementById("newPlayerName").addEventListener("keydown", e=>{ if(e.key==="Enter") addPlayer(); });
document.getElementById("commitBtn").onclick = commitRound;
document.getElementById("newGameBtn").onclick = newGame;
document.getElementById("returnToScoreboard").onclick = returnToScoreboard;
document.getElementById("scorecardUndo").onclick = undoScorecardAction;
document.getElementById("scorecardRedo").onclick = redoScorecardAction;
const targetLbl = document.getElementById("targetLbl");
const pointsToWinInput = document.getElementById("pointsToWinInput");
function updateTargetDisplay(){
  targetLbl.textContent = TARGET;
  pointsToWinInput.value = TARGET;
  document.querySelector(".target").firstChild.textContent = "Points to win ";
}
updateTargetDisplay();
pointsToWinInput.addEventListener("change", ()=>{
  const newTarget = Number(pointsToWinInput.value);
  if(!Number.isSafeInteger(newTarget) || newTarget < 1){
    pointsToWinInput.value = TARGET;
    return;
  }
  TARGET = newTarget;
  localStorage.setItem(TARGET_KEY, String(TARGET));
  updateTargetDisplay();
  render();
});
const roundEntryEl = document.getElementById("roundEntry");
roundEntryEl.addEventListener("pointerdown", handlePlayerPointerDown);
roundEntryEl.addEventListener("pointermove", handlePlayerPointerMove);
roundEntryEl.addEventListener("pointerup", handlePlayerPointerUp);
roundEntryEl.addEventListener("pointercancel", clearPlayerDrag);
roundEntryEl.addEventListener("keydown", handlePlayerHandleKeydown);
setTheme(localStorage.getItem(THEME_KEY) || "light");
document.querySelectorAll("[data-theme-choice]").forEach(button=>{
  button.addEventListener("click", ()=>setTheme(button.dataset.themeChoice));
});
document.getElementById("instructionsLink").addEventListener("click", ()=>{
  document.getElementById("settingsMenu").open = false;
});
document.getElementById("refreshApp").addEventListener("click", ()=>window.location.reload());
document.getElementById("settingsClose").addEventListener("click", ()=>{
  document.getElementById("settingsMenu").open = false;
  document.querySelector("#settingsMenu summary").focus();
});

/* ---------- block pinch / double-tap / ctrl-wheel page zoom ---------- */
document.addEventListener("gesturestart",  e=>e.preventDefault());
document.addEventListener("gesturechange", e=>e.preventDefault());
document.addEventListener("gestureend",    e=>e.preventDefault());
document.addEventListener("dblclick", e=>e.preventDefault());
document.addEventListener("touchmove", e=>{ if(e.touches.length > 1) e.preventDefault(); }, {passive:false});
document.addEventListener("wheel", e=>{ if(e.ctrlKey) e.preventDefault(); }, {passive:false});
window.addEventListener("keydown", e=>{ if((e.ctrlKey||e.metaKey) && ["+","-","=","0"].includes(e.key)) e.preventDefault(); });

render();
