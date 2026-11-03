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

  const series = players.map((player, index) => {
    let total = 0;
    const values = [{ round: 0, roundNumber: 0, total: 0 }];
    rounds.forEach((round, roundIndex) => {
      const startTotal = total;
      if (Array.isArray(round.turns) && round.turns.length) {
        round.turns.forEach((turn, turnIndex) => {
          if (turn.playerId !== player.id) return;
          const scoreDelta = Number(turn.score || 0);
          total += scoreDelta;
          values.push({
            round: roundIndex + (turnIndex + 1) / round.turns.length,
            roundNumber: roundIndex + 1,
            total,
            scoreDelta,
            autoZero: turn.autoZero === true
          });
        });
        if (round.lowestDominoIds?.includes(player.id)) {
          total += 1;
          values.push({
            round: roundIndex + 1,
            roundNumber: roundIndex + 1,
            total,
            scoreDelta: 1,
            lowestDomino: true
          });
        }
      } else {
        const scoreDelta = Number(round.scores?.[player.id] || 0);
        total += scoreDelta;
        values.push({ round: roundIndex + 1, roundNumber: roundIndex + 1, total, scoreDelta });
      }
      const expectedTotal = startTotal + Number(round.scores?.[player.id] || 0);
      if (Math.abs(total - expectedTotal) > 0.0001) {
        const scoreDelta = expectedTotal - total;
        total = expectedTotal;
        values.push({ round: roundIndex + 1, roundNumber: roundIndex + 1, total, scoreDelta });
      }
    });
    currentEntries.forEach((entry, entryIndex) => {
      if (entry.playerId !== player.id) return;
      const scoreDelta = Number(entry.score || 0);
      total += scoreDelta;
      values.push({
        round: rounds.length + (entryIndex + 1) / currentEntries.length,
        roundNumber: rounds.length + 1,
        total,
        scoreDelta
      });
    });
    return { player, index, color: colorFor(index), values };
  });

  summary.textContent = currentEntries.length
    ? `${rounds.length} completed round${rounds.length === 1 ? "" : "s"}; ${currentEntries.length} score entr${currentEntries.length === 1 ? "y" : "ies"} in round ${rounds.length + 1}.`
    : `${rounds.length} completed round${rounds.length === 1 ? "" : "s"}; markers show individual scores.`;
  legend.replaceChildren(...series.map(({ player, index, color }) => {
    const item = document.createElement("span");
    item.className = "graph-legend-item";
    const swatch = document.createElement("span");
    swatch.className = "graph-swatch";
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = `Player ${index + 1}: ${player.name}`;
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
  const axisRoundCount = rounds.length + (currentEntries.length ? 1 : 0);
  const xMax = Math.max(axisRoundCount, 1);
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

  const labelEvery = Math.max(1, Math.ceil(axisRoundCount / 8));
  for (let round = 0; round <= axisRoundCount; round++) {
    if (round !== 0 && round !== axisRoundCount && round % labelEvery !== 0) continue;
    const xx = x(round);
    svg.append(svgElement("line", { x1: xx, y1: margin.top, x2: xx, y2: margin.top + plotHeight, class: "graph-gridline" }));
    svg.append(svgElement("text", { x: xx, y: margin.top + plotHeight + 21, "text-anchor": "middle" }, String(round)));
  }

  svg.append(svgElement("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + plotHeight, class: "graph-axis" }));
  svg.append(svgElement("line", { x1: margin.left, y1: margin.top + plotHeight, x2: width - margin.right, y2: margin.top + plotHeight, class: "graph-axis" }));
  svg.append(svgElement("text", { x: margin.left + plotWidth / 2, y: height - 8, "text-anchor": "middle", class: "graph-axis-title" }, "Round number"));
  svg.append(svgElement("text", { x: 17, y: margin.top + plotHeight / 2, transform: `rotate(-90 17 ${margin.top + plotHeight / 2})`, "text-anchor": "middle", class: "graph-axis-title" }, "Total points"));

  series.forEach(({ player, index, color, values }) => {
    const points = values.map(point => `${x(point.round)},${y(point.total)}`).join(" ");
    svg.append(svgElement("polyline", { points, stroke: color, class: "graph-line" }));
    values.slice(1).forEach(point => {
      const marker = point.autoZero
        ? svgElement("circle", { cx:x(point.round), cy:y(point.total), r:6, fill:color, stroke:"#fff", "stroke-width":2, class:"graph-point graph-point-auto-zero" })
        : point.lowestDomino
        ? svgElement("rect", { x:x(point.round)-4, y:y(point.total)-4, width:8, height:8, transform:`rotate(45 ${x(point.round)} ${y(point.total)})`, fill:color, class:"graph-point" })
        : point.scoreDelta === 0
          ? svgElement("circle", { cx:x(point.round), cy:y(point.total), r:5, fill:"var(--panel)", stroke:color, "stroke-width":2, class:"graph-point graph-point-zero" })
          : svgElement("circle", { cx:x(point.round), cy:y(point.total), r:4, fill:color, class:"graph-point" });
      if(point.scoreDelta === 0 && !point.autoZero){
        marker.style.stroke = color;
        marker.style.strokeWidth = "2px";
      }
      const change = point.lowestDomino
        ? "lowest domino bonus +1"
        : point.autoZero
          ? "no score entered; recorded as 0"
          : `score ${point.scoreDelta >= 0 ? "+" : ""}${formatValue(point.scoreDelta)}`;
      marker.append(svgElement("title", {}, `Player ${index + 1} (${player.name}), round ${point.roundNumber}: ${change}; total ${formatValue(point.total)}`));
      svg.append(marker);
      if(point.autoZero){
        const label = svgElement("text", {
          x:x(point.round),
          y:y(point.total)-9,
          "text-anchor":"middle",
          class:"graph-zero-label"
        }, "0");
        label.style.fill = color;
        label.style.stroke = "#fff";
        label.style.strokeWidth = "3px";
        label.style.paintOrder = "stroke";
        label.style.fontWeight = "800";
        svg.append(label);
      }
    });
  });
}

drawGraph();
window.addEventListener("resize", drawGraph);
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
