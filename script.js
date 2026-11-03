"use strict";
const DEFAULT_TARGET = 120;
const TARGET_KEY = "domino-points-to-win-v1";
let TARGET = loadTarget();
const STORE_KEY = "skyjo-state-v1";
const THEME_KEY = "skyjo-theme-v1";
const PLAYER_COLORS = ["#1677e8", "#f28c28", "#ffff00", "#000000", "#d83b3b", "#249447"];
const EXTRA_PLAYER_COLORS = ["#8c52d8", "#168f9a", "#a25e32", "#d450a5"];

function playerColor(index){
  return PLAYER_COLORS[index] || EXTRA_PLAYER_COLORS[(index-PLAYER_COLORS.length)%EXTRA_PLAYER_COLORS.length];
}
function playerHeaderTextColor(color){
  const value = color.slice(1);
  const red = parseInt(value.slice(0,2),16);
  const green = parseInt(value.slice(2,4),16);
  const blue = parseInt(value.slice(4,6),16);
  return (red*299+green*587+blue*114)/1000 > 145 ? "#17202e" : "#ffffff";
}

function loadTarget(){
  const saved = Number(localStorage.getItem(TARGET_KEY));
  return Number.isSafeInteger(saved) && saved > 0 ? saved : DEFAULT_TARGET;
}

let state = load() || {
  players: [],     // {id, name}
  rounds: [],      // [{ scores:{id:n}, raw:{id:n}, entries:{id:[score,...]} }]
  picks: {},       // working round: id -> {cards:[v,...]}
  lastScorerId: null,
  groups: [],      // saved rosters for quick re-use: [{id, names:[...]}]
};
if(!state.groups) state.groups = [];   // migrate states saved before groups existed
if(!state.picks) state.picks = {};
if(!Array.isArray(state.passedPlayers)) state.passedPlayers = [];
if(!Object.prototype.hasOwnProperty.call(state,"lastScorerId")){
  state.lastScorerId = state.passedPlayers.length
    ? state.passedPlayers[state.passedPlayers.length - 1]
    : null;
}
delete state.passedPlayers;
if(!state.lastScorerId && state.rounds.length){
  const lastRoundTurns = state.rounds[state.rounds.length - 1].turns;
  if(Array.isArray(lastRoundTurns) && lastRoundTurns.length){
    state.lastScorerId = lastRoundTurns[lastRoundTurns.length - 1].playerId;
  }
}
if(!Array.isArray(state.currentEntries)){
  state.currentEntries = [];
  const maxEntries = Math.max(0,...state.players.map(pl=>state.picks[pl.id]?.cards?.length || 0));
  for(let entryIndex=0;entryIndex<maxEntries;entryIndex++){
    state.players.forEach(pl=>{
      const score = state.picks[pl.id]?.cards?.[entryIndex];
      if(score !== undefined){
        state.currentEntries.push({playerId:pl.id,score:Number(score),playerEntryIndex:entryIndex});
      }
    });
  }
}
if(typeof state.hasScoredOnce !== "boolean"){
  state.hasScoredOnce = state.rounds.length > 0 ||
    Object.values(state.picks).some(picks=>picks && picks.cards && picks.cards.length > 0);
}
delete state.committed; // discard the previous per-player confirmation state
delete state.closerId; // discard the removed first-to-declare setting from saved games
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
  return cards.reduce((sum,value)=>sum+Number(value||0),0);
}
// has the current working round had any input yet?
function anyPicks(){
  const anyCards = state.players.some(pl=>{
    const p = state.picks[pl.id];
    return p && p.cards && p.cards.length > 0;
  });
  return anyCards;
}
function hasScoreSelected(id){
  const picks = state.picks[id];
  return !!(picks && picks.cards && picks.cards.length);
}
function activeScorecardPlayerId(){
  if(state.players.length === 0) return null;
  const lastIndex = state.players.findIndex(pl=>pl.id===state.lastScorerId);
  return state.players[(lastIndex + 1) % state.players.length].id;
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
  document.getElementById("endRoundBtn").hidden = !state.hasScoredOnce;
  updateScorecardHistoryControls();
  save();
}

function scorecardSnapshot(){
  return {
    picks: JSON.parse(JSON.stringify(state.picks)),
    rounds: JSON.parse(JSON.stringify(state.rounds)),
    currentEntries: JSON.parse(JSON.stringify(state.currentEntries)),
    lastScorerId: state.lastScorerId,
  };
}
function recordScorecardChange(){
  scorecardUndoStack.push(scorecardSnapshot());
  if(scorecardUndoStack.length > 100) scorecardUndoStack.shift();
  scorecardRedoStack = [];
}
function restoreScorecardSnapshot(snapshot){
  state.picks = snapshot.picks;
  state.rounds = snapshot.rounds;
  state.currentEntries = snapshot.currentEntries;
  state.lastScorerId = snapshot.lastScorerId;
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
  const totalWithCurrentRound = id => totalFor(id) + (hasScoreSelected(id) ? roundScore(id) : 0);
  const high = Math.max(...state.players.map(pl=>totalWithCurrentRound(pl.id)));
  const activeTurnId = activeScorecardPlayerId();
  const sorted = state.players.slice().sort((a,b)=> totalWithCurrentRound(b.id)-totalWithCurrentRound(a.id)); // highest total first
  el.innerHTML = sorted.map((pl,i)=>{
    const playerIndex = state.players.findIndex(player=>player.id===pl.id);
    const tot = totalWithCurrentRound(pl.id);
    const room = Math.max(0, TARGET - tot);
    const isLead = tot === high;
    const isTurn = pl.id === activeTurnId;
    const isOut = tot >= TARGET;
    const pct = Math.min(100, tot/TARGET*100);
    const awayHtml = isOut ? '<b>OVER '+TARGET+'</b>'
                           : '<b>'+room+'</b><br>to '+TARGET;
    return `<div class="prow ${isOut?'out':''} ${isLead?'lead':''} ${(!isOut&&room<=20&&!isLead)?'danger':''}" data-player-id="${pl.id}">
      <div class="rank">${i+1}</div>
      <div style="flex:1 1 auto; min-width:0;">
        <div class="nm" onclick="renamePlayer('${pl.id}')" title="tap to rename">
          <span class="player-name-text">${escapeHtml(pl.name)}</span>
          ${isTurn ? `<span class="turn-indicator" style="--turn-color:${playerColor(playerIndex)}" role="img" aria-label="Current turn to score" title="Current turn to score"></span>` : ""}
        </div>
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
  const activePlayerId = activeScorecardPlayerId();
  const showAllCards = !state.hasScoredOnce;
  const visiblePlayers = showAllCards
    ? state.players
    : state.players.filter(pl=>pl.id===activePlayerId);
  const previousOrder = new Map([...el.querySelectorAll(".player-round")].map((card,index)=>[
    card.dataset.playerId,
    {top:card.getBoundingClientRect().top,index}
  ]));
  if(state.players.length === 0){
    el.innerHTML = '<div class="empty">Add players to begin scoring a round.</div>';
    return;
  }
  if(visiblePlayers.length === 0){
    el.innerHTML = '<div class="round-complete"><p>All players have entered their scores.</p></div>';
    return;
  }
  el.innerHTML = visiblePlayers.map(pl=>{
    const index = state.players.indexOf(pl);
    const headerColor = playerColor(index);
    const isActive = pl.id === activePlayerId;
    const scorePadBtns = [1,2,3,4,6,8].map(v=>
      `<button type="button" class="score-pad-btn" aria-pressed="false" ${isActive?'':'disabled'} onclick="selectScorePad('${pl.id}',${v})">${v}</button>`
    ).join("");
    return `<div class="player-round ${isActive?'is-active':'is-locked'}" data-player-id="${pl.id}" aria-disabled="${!isActive}">
      <div class="pr-head" style="--player-color:${headerColor};--player-text-color:${playerHeaderTextColor(headerColor)}">
        ${showAllCards ? `<button type="button" class="drag-handle" aria-label="Reorder ${escapeHtml(pl.name)}; use the up and down arrow keys" title="Drag to reorder players">⠿</button>` : ""}
        <div class="nm">${escapeHtml(pl.name)}</div>
        <span class="player-order">PLAYER ${String(index+1).padStart(2,"0")}</span>
      </div>
      <div class="pr-body">
        <div class="score-pad-section">
          <div class="score-pad-label">Score pads</div>
          <div class="score-pad"><button type="button" class="score-pad-btn score-pad-zero" aria-pressed="false" ${isActive?'':'disabled'} onclick="selectScorePad('${pl.id}',0)">0</button>${scorePadBtns}</div>
        </div>
      </div>
      <div class="pr-foot">
        <span class="hint">${isActive?'Select one score':'Waiting for previous player'}</span>
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
    state.players.map((pl,index)=>{
      const color = playerColor(index);
      return `<th style="background-color:${color};color:${playerHeaderTextColor(color)}">${escapeHtml(pl.name)}</th>`;
    }).join("") +
    '<th></th></tr></thead>';
  const historyRows = [];
  const playerCount = state.players.length;
  function addTurnRows(turns,roundIndex,kind,hasBonus=false){
    for(let start=0;start<turns.length;start+=playerCount){
      const end = Math.min(start+playerCount,turns.length);
      historyRows.push({
        roundIndex,
        kind,
        entries:turns.slice(start,end).map((entry,offset)=>({
          ...entry,
          entryIndex:start+offset
        })),
        hasBonus,
        isLastCycle:end===turns.length,
        isComplete:end-start===playerCount
      });
    }
  }
  state.rounds.forEach((round,roundIndex)=>{
    if(Array.isArray(round.turns) && round.turns.length){
      addTurnRows(round.turns,roundIndex,"cycle",(round.lowestDominoIds||[]).length>0);
    } else {
      const hasBonus = (round.lowestDominoIds||[]).length>0;
      historyRows.push({roundIndex,kind:"round",scores:hasBonus?(round.raw||round.scores):round.scores,hasBonus});
    }
    if((round.lowestDominoIds||[]).length){
      historyRows.push({roundIndex,kind:"lowest-domino",playerIds:round.lowestDominoIds});
    }
  });
  if(state.currentEntries.length){
    addTurnRows(state.currentEntries,state.rounds.length,"current-cycle");
  }
  let rows = historyRows.map(row=>{
    const cells = state.players.map(pl=>{
      if(row.kind === "cycle" || row.kind === "current-cycle"){
        const entry = row.entries.find(item=>item.playerId===pl.id);
        if(!entry) return "<td></td>";
        const onchange = row.kind === "current-cycle"
          ? `editCurrentScoreEntry(${entry.entryIndex},this.value)`
          : `editScoreEntry(${row.roundIndex},${entry.entryIndex},this.value)`;
        const title = entry.autoZero ? ' title="No score entered; recorded as 0"' : "";
        return `<td><div class="scorecell"><input type="number" inputmode="numeric" value="${Number(entry.score||0)}"${title} onchange="${onchange}"></div></td>`;
      }
      if(row.kind === "lowest-domino"){
        return row.playerIds.includes(pl.id)
          ? '<td><div class="lowest-domino-award"><b>+1</b><span title="Lowest domino">LD</span></div></td>'
          : '<td><div class="lowest-domino-zero">0</div></td>';
      }
      const value = Number(row.scores?.[pl.id]||0);
      return `<td><div class="scorecell"><input type="number" inputmode="numeric" value="${value}" onchange="editScore(${row.roundIndex},'${pl.id}',this.value)"></div></td>`;
    }).join("");
    const deleteRoundHtml = row.kind === "current-cycle" ||
      (row.kind === "cycle" && (!row.isLastCycle || row.hasBonus)) ||
      (row.kind === "round" && row.hasBonus)
      ? ""
      : `<span class="delr" onclick="deleteRound(${row.roundIndex})" title="delete round">✕</span>`;
    const rowClass = (row.kind === "current-cycle" || row.kind === "cycle") && !row.isComplete ? "score-row-incomplete" : "";
    return `<tr class="${rowClass}"><td class="rndlbl">${row.roundIndex+1}</td>${cells}<td>${deleteRoundHtml}</td></tr>`;
  }).join("");
  if(historyRows.length === 0){
    rows = `<tr><td class="rndlbl">—</td><td colspan="${state.players.length+1}" class="empty" style="padding:10px;">No scores entered yet.</td></tr>`;
  }
  let foot = '<tfoot><tr><td class="rndlbl">Σ</td>' +
    state.players.map(pl=>`<td>${totalFor(pl.id)+roundScore(pl.id)}</td>`).join("") +
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
  state.currentEntries = state.currentEntries.filter(entry=>entry.playerId!==id);
  if(state.lastScorerId===id) state.lastScorerId = null;
  state.rounds.forEach(r=>{
    delete r.scores[id];
    if(r.raw) delete r.raw[id];
    if(r.entries) delete r.entries[id];
    if(r.turns) r.turns = r.turns.filter(entry=>entry.playerId!==id);
    if(r.lowestDominoIds) r.lowestDominoIds = r.lowestDominoIds.filter(playerId=>playerId!==id);
  });
  render();
}
function renamePlayer(id){
  const pl = state.players.find(p=>p.id===id);
  if(!pl) return;
  const nn = prompt("Rename player:", pl.name);
  if(nn && nn.trim()){ pl.name = nn.trim().slice(0,18); render(); }
}
function selectScorePad(id,v){
  if(id !== activeScorecardPlayerId()) return;
  recordScorecardChange();
  state.hasScoredOnce = true;
  const playerEntryIndex = getPicks(id).cards.length;
  const score = Number(v);
  getPicks(id).cards.push(score);
  state.currentEntries.push({playerId:id,score,playerEntryIndex});
  state.lastScorerId = id;
  render();
}
function commitRound(lowestDominoIds=[]){
  if(state.players.length === 0){ alert("Add players first."); return; }

  const raw = {};
  state.players.forEach(pl=>{ raw[pl.id] = roundScore(pl.id); });

  recordScorecardChange();
  const turns = state.currentEntries.map(entry=>({...entry}));
  const playerCount = state.players.length;
  const remainder = turns.length % playerCount;
  const missingCount = remainder === 0 ? (turns.length === 0 ? playerCount : 0) : playerCount - remainder;
  const nextPlayerIndex = Math.max(0,state.players.findIndex(pl=>pl.id===activeScorecardPlayerId()));
  for(let offset=0;offset<missingCount;offset++){
    const player = state.players[(nextPlayerIndex+offset)%playerCount];
    turns.push({
      playerId:player.id,
      score:0,
      playerEntryIndex:getPicks(player.id).cards.length,
      autoZero:true
    });
  }
  const scores = {...raw};
  const validLowestDominoIds = [...new Set(lowestDominoIds)]
    .filter(id=>state.players.some(pl=>pl.id===id));
  validLowestDominoIds.forEach(id=>{ scores[id] = Number(scores[id]||0) + 1; });
  state.rounds.push({ scores, raw, turns, lowestDominoIds:validLowestDominoIds });
  rememberGroup();  // this roster is now a reusable player group
  state.picks = {};
  state.currentEntries = [];
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
  state.currentEntries = [];
  state.lastScorerId = null;
  state.hasScoredOnce = false;
  render();
  window.scrollTo({ top:0, behavior:"smooth" });
}
function deleteGroup(id){
  state.groups = state.groups.filter(g=>g.id!==id);
  render();
}

function editScore(roundIdx, id, val){
  const v = Math.round(Number(val)||0);
  clearScorecardHistory();
  const hasBonus = state.rounds[roundIdx].lowestDominoIds?.includes(id);
  state.rounds[roundIdx].scores[id] = v + (hasBonus?1:0);
  if(state.rounds[roundIdx].raw) state.rounds[roundIdx].raw[id] = v;
  if(state.rounds[roundIdx].entries) state.rounds[roundIdx].entries[id] = [v];
  render();
}
function editScoreEntry(roundIdx,entryIdx,val){
  const round = state.rounds[roundIdx];
  const entry = round?.turns?.[entryIdx];
  if(!entry) return;
  const score = Math.round(Number(val)||0);
  clearScorecardHistory();
  entry.score = score;
  const baseScore = round.turns
    .filter(turn=>turn.playerId===entry.playerId)
    .reduce((sum,turn)=>sum+Number(turn.score||0),0);
  round.raw[entry.playerId] = baseScore;
  round.scores[entry.playerId] = baseScore + (round.lowestDominoIds?.includes(entry.playerId)?1:0);
  render();
}
function editCurrentScoreEntry(entryIdx,val){
  const entry = state.currentEntries[entryIdx];
  if(!entry) return;
  const score = Math.round(Number(val)||0);
  clearScorecardHistory();
  entry.score = score;
  const playerPicks = getPicks(entry.playerId).cards;
  playerPicks[entry.playerEntryIndex] = score;
  render();
}
async function deleteRound(idx){
  if(!(await confirmModal("Delete round "+(idx+1)+"?", "Delete"))) return;
  clearScorecardHistory();
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
  state.currentEntries = [];
  state.lastScorerId = null;
  state.hasScoredOnce = false;
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

function openLowestDominoDialog(){
  if(state.players.length === 0) return;
  const back = document.getElementById("lowestDominoBack");
  const choices = document.getElementById("lowestDominoPlayers");
  choices.innerHTML = state.players.map(pl=>
    `<label class="lowest-domino-option"><input type="checkbox" value="${escapeHtml(pl.id)}"><span>${escapeHtml(pl.name)}</span></label>`
  ).join("");
  back.hidden = false;
  back.classList.add("show");
  choices.querySelector("input")?.focus();
}
function closeLowestDominoDialog(){
  const back = document.getElementById("lowestDominoBack");
  back.classList.remove("show");
  back.hidden = true;
  document.getElementById("endRoundBtn").focus();
}
function confirmLowestDominoRound(){
  const selectedIds = [...document.querySelectorAll("#lowestDominoPlayers input:checked")]
    .map(input=>input.value);
  closeLowestDominoDialog();
  commitRound(selectedIds);
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
document.getElementById("newGameBtn").onclick = newGame;
document.getElementById("returnToScoreboard").onclick = returnToScoreboard;
document.getElementById("scorecardUndo").onclick = undoScorecardAction;
document.getElementById("scorecardRedo").onclick = redoScorecardAction;
document.getElementById("endRoundBtn").onclick = openLowestDominoDialog;
document.getElementById("cancelLowestDomino").onclick = closeLowestDominoDialog;
document.getElementById("confirmLowestDomino").onclick = confirmLowestDominoRound;
document.getElementById("lowestDominoBack").addEventListener("click",event=>{
  if(event.target.id === "lowestDominoBack") closeLowestDominoDialog();
});
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
