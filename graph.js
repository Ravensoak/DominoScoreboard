"use strict";

const STORE_KEY = "skyjo-state-v1";
const THEME_KEY = "skyjo-theme-v1";
const PLAYER_COLORS = ["#1677e8", "#f28c28", "#ffff00", "#000000", "#d83b3b", "#249447"];
const EXTRA_COLORS = ["#8c52d8", "#168f9a", "#a25e32", "#d450a5"];
const SVG_NS = "http://www.w3.org/2000/svg";

document.body.dataset.theme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
document.querySelector('meta[name="theme-color"]').content = document.body.dataset.theme === "dark" ? "#191b1f" : "#ffffff";

let gameState = null;
try {
  gameState = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
} catch (error) {
  gameState = null;
}

let players = Array.isArray(gameState?.players) ? gameState.players : [];
let rounds = Array.isArray(gameState?.rounds) ? gameState.rounds : [];
let currentEntries = Array.isArray(gameState?.currentEntries) ? gameState.currentEntries : [];
const legend = document.getElementById("graphLegend");
const svg = document.getElementById("scoreGraph");
const empty = document.getElementById("graphEmpty");
const scroll = document.getElementById("graphScroll");
const summary = document.getElementById("graphSummary");

function colorFor(index) {
  return PLAYER_COLORS[index] || EXTRA_COLORS[(index - PLAYER_COLORS.length) % EXTRA_COLORS.length];
}

function svgElement(name, attrs = {}, content = "") {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (content) node.textContent = content;
  return node;
}

function niceStep(span) {
  const rough = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
  const fraction = rough / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function drawGraph() {
  if (!players.length || (!rounds.length && !currentEntries.length)) {
    legend.replaceChildren();
    scroll.hidden = true;
    empty.hidden = false;
    summary.textContent = players.length ? "Enter a score to see how totals change over the game." : "Add players and enter scores to see their totals over time.";
    return;
  }

  const graphPlayers = gameState?.gameType === "team"
    ? [[0,2],[1,3]].map((indexes,teamIndex)=>{
        const members = indexes.map(index=>players[index]).filter(Boolean);
        return {id:`team-${teamIndex+1}`,name:members.length ? members.map(player=>player.name).join(" & ") : `Team ${teamIndex+1}`,members,index:indexes[0]};
      })
    : players.map((player,index)=>({id:player.id,name:player.name,members:[player],index}));
  const series = graphPlayers.map(({name,members,index}) => ({
    name,
    index,
    color: colorFor(index),
    memberIds: new Set(members.map(player=>player.id)),
    total: 0,
    values: [{ round: 0, roundNumber: 0, total: 0 }]
  }));
  let turnAxisCount = 0;
  const roundMarkerPositions = [];
  const roundLabelRanges = [];
  const addTurnPoint = (round, roundNumber, entries, lowestDominoIds=null) => {
    series.forEach(item=>{
      const matchingEntries = entries.filter(entry=>item.memberIds.has(entry.playerId));
      const appliesToSeries = lowestDominoIds
        ? true
        : matchingEntries.length > 0;
      if(!appliesToSeries) return;
      const scoreDelta = lowestDominoIds
        ? lowestDominoIds.filter(id=>item.memberIds.has(id)).length
        : matchingEntries.reduce((sum,entry)=>sum+Number(entry.score ?? 0),0);
      item.total += scoreDelta;
      item.values.push({
        round,
        roundNumber,
        total: item.total,
        scoreDelta,
        eventName: lowestDominoIds ? "Lowest domino" : matchingEntries.map(entry=>entry.name).join(" & "),
        eventScore: scoreDelta,
        autoZero: matchingEntries.length > 0 && matchingEntries.every(entry=>entry.autoZero === true),
        turn: !lowestDominoIds,
        lowestDomino: Boolean(lowestDominoIds)
      });
    });
  };
  rounds.forEach((round, roundIndex)=>{
    const hasTurns = Array.isArray(round.turns) && round.turns.length > 0;
    const turnRows = [];
    if(hasTurns){
      const turnsPerRow = Math.max(players.length,1);
      for(let start=0;start<round.turns.length;start+=turnsPerRow){
        turnRows.push(round.turns.slice(start,start+turnsPerRow).map(turn=>({
          playerId:turn.playerId,
          score:Number(turn.score ?? 0),
          name:players.find(player=>player.id===turn.playerId)?.name || "Player",
          autoZero:turn.autoZero === true
        })));
      }
    } else {
      const rowScores = round.lowestDominoIds?.length ? (round.raw || round.scores) : round.scores;
      turnRows.push(players.map(player=>({playerId:player.id,score:Number(rowScores?.[player.id] ?? 0),name:player.name})));
    }
    const hasBonusRow = Boolean(round.lowestDominoIds?.length);
    const roundStart = turnAxisCount;
    turnRows.forEach(entries=>{
      const position = ++turnAxisCount;
      addTurnPoint(position,roundIndex + 1,entries);
    });
    if(hasBonusRow){
      const position = ++turnAxisCount;
      addTurnPoint(position,roundIndex + 1,[],round.lowestDominoIds);
    }
    roundMarkerPositions.push(turnAxisCount);
    roundLabelRanges.push({start:roundStart,end:turnAxisCount,roundNumber:roundIndex + 1});
  });
  if(currentEntries.length){
    const turnsPerRow = Math.max(players.length,1);
    const currentRows = [];
    for(let start=0;start<currentEntries.length;start+=turnsPerRow){
      currentRows.push(currentEntries.slice(start,start+turnsPerRow).map(entry=>({
        playerId:entry.playerId,
        score:Number(entry.score ?? 0),
        name:players.find(player=>player.id===entry.playerId)?.name || "Player"
      })));
    }
    const currentRoundStart = turnAxisCount;
    currentRows.forEach(entries=>{
      const position = ++turnAxisCount;
      addTurnPoint(position,rounds.length + 1,entries);
    });
    roundLabelRanges.push({start:currentRoundStart,end:turnAxisCount,roundNumber:rounds.length + 1});
  }
  series.forEach(item=>delete item.memberIds);

  summary.textContent = currentEntries.length
    ? `${rounds.length} completed round${rounds.length === 1 ? "" : "s"}; markers show each turn, including current entries in round ${rounds.length + 1}.`
    : `${rounds.length} completed round${rounds.length === 1 ? "" : "s"}; markers show every turn and cumulative ${gameState?.gameType === "team" ? "team" : "player"} totals.`;
  legend.replaceChildren(...series.map(({ name:seriesName, index, color }) => {
    const item = document.createElement("span");
    item.className = "graph-legend-item";
    const swatch = document.createElement("span");
    swatch.className = "graph-swatch";
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = gameState?.gameType === "team" ? seriesName : `Player ${index + 1}: ${seriesName}`;
    item.append(swatch, name);
    return item;
  }));

  const width = Math.max(200, Math.floor(scroll.clientWidth || 800));
  const compact = width < 560;
  const height = compact ? 380 : 460;
  const margin = compact
    ? { top: 20, right: 12, bottom: 52, left: 48 }
    : { top: 24, right: 24, bottom: 58, left: 66 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allValues = series.flatMap(item => item.values.map(point => point.total));
  let minValue = Math.min(0, ...allValues);
  let maxValue = Math.max(0, ...allValues);
  if (minValue === maxValue) maxValue = minValue + 1;
  const step = niceStep(maxValue - minValue);
  const yMin = Math.floor(minValue / step) * step;
  const yMax = Math.ceil(maxValue / step) * step || step;
  const xMax = Math.max(turnAxisCount, 1);
  const x = round => margin.left + (round / xMax) * plotWidth;
  const y = value => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.append(svgElement("title", {}, "Player total points by round"));

  for (let tick = yMin; tick <= yMax + step / 100; tick += step) {
    const yy = y(tick);
    svg.append(svgElement("line", { x1: margin.left, y1: yy, x2: width - margin.right, y2: yy, class: "graph-gridline" }));
    svg.append(svgElement("text", { x: margin.left - 10, y: yy + 4, "text-anchor": "end" }, formatValue(tick)));
  }

  for (let turn = 0; turn <= turnAxisCount; turn++) {
    const xx = x(turn);
    const roundEnd = roundMarkerPositions.includes(turn);
    svg.append(svgElement("line", {
      x1: xx,
      y1: margin.top,
      x2: xx,
      y2: margin.top + plotHeight,
      class: roundEnd ? "graph-round-boundary" : "graph-gridline"
    }));
    if (turn === 0) {
      svg.append(svgElement("text", { x: xx, y: margin.top + plotHeight + 21, "text-anchor": "middle" }, "Start"));
    }
  }
  roundLabelRanges.forEach(({start,end,roundNumber})=>{
    const labelX = x((start + end) / 2);
    svg.append(svgElement("text", { x: labelX, y: margin.top + plotHeight + 21, "text-anchor": "middle" }, `Round ${roundNumber}`));
  });

  svg.append(svgElement("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + plotHeight, class: "graph-axis" }));
  svg.append(svgElement("line", { x1: margin.left, y1: margin.top + plotHeight, x2: width - margin.right, y2: margin.top + plotHeight, class: "graph-axis" }));
  svg.append(svgElement("text", { x: margin.left + plotWidth / 2, y: height - 8, "text-anchor": "middle", class: "graph-axis-title" }, "Rounds"));
  svg.append(svgElement("text", { x: 17, y: margin.top + plotHeight / 2, transform: `rotate(-90 17 ${margin.top + plotHeight / 2})`, "text-anchor": "middle", class: "graph-axis-title" }, "Total points"));

  series.forEach(({ name:seriesName, index, color, values }) => {
    const points = values.map(point => `${x(point.round)},${y(point.total)}`).join(" ");
    svg.append(svgElement("polyline", { points, stroke: color, class: "graph-line" }));
    values.slice(1).forEach(point => {
      const marker = svgElement("circle", {
        cx:x(point.round),
        cy:y(point.total),
        r:3,
        fill:color,
        class:"graph-point"
      });
      const change = point.turn
        ? point.autoZero
          ? `${point.eventName} recorded 0; ${seriesName} total ${formatValue(point.total)}`
          : `turn row ${point.eventName} ${point.eventScore >= 0 ? "+" : ""}${formatValue(point.eventScore)}; ${seriesName} total ${formatValue(point.total)}`
        : point.lowestDomino
          ? `${point.scoreDelta ? "lowest domino bonus +1" : "no lowest domino bonus +0"}; ${seriesName} total ${formatValue(point.total)}`
          : `score ${point.scoreDelta >= 0 ? "+" : ""}${formatValue(point.scoreDelta)}; ${seriesName} total ${formatValue(point.total)}`;
      const label = gameState?.gameType === "team" ? seriesName : `Player ${index + 1} (${seriesName})`;
      marker.append(svgElement("title", {}, `${label}, round ${point.roundNumber}: ${change}; total ${formatValue(point.total)}`));
      svg.append(marker);
    });
  });
}

drawGraph();
window.addEventListener("resize", drawGraph);
window.addEventListener("keydown", event=>{
  if(event.key !== "Backspace" || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  event.preventDefault();
  window.location.href = "index.html";
});
window.addEventListener("storage", event=>{
  if(event.key !== STORE_KEY) return;
  try {
    gameState = JSON.parse(event.newValue || "null");
  } catch (error) {
    gameState = null;
  }
  players = Array.isArray(gameState?.players) ? gameState.players : [];
  rounds = Array.isArray(gameState?.rounds) ? gameState.rounds : [];
  currentEntries = Array.isArray(gameState?.currentEntries) ? gameState.currentEntries : [];
  drawGraph();
});
