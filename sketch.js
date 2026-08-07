import config from "./config.json" with { type: "json" };
const { RATIO, CONNECTIONS } = config;

let canvas = null;
let ctx = null;

let width = 0;
let height = 0;
let top = 0;
let left = 0;
let index = 0;

const history = [];
const MAX_HISTORY = 50;

const active = new Map();

export function setup() {
  canvas = document.querySelector("canvas");
  ctx = canvas.getContext("2d", { willReadFrequently: true });
  resize();
  addEventListener("resize", resize);

  canvas.addEventListener("pointerdown", drawStart);
  canvas.addEventListener("pointermove", draw);
  canvas.addEventListener("pointerup", drawEnd);
  canvas.addEventListener("pointercancel", drawEnd);
}

function drawStart(e) {
  if (!(e.buttons & 1)) return;
  console.log(active.size);
  if (active.size === 0) snapshot();
  canvas.setPointerCapture(e.pointerId);
  const p = pos(e);
  line(p, { x: p.x, y: p.y + 0.01 });
  active.set(e.pointerId, p);
}

function draw(e) {
  const s = active.get(e.pointerId);
  if (!s) return;
  const p = pos(e);
  line(s, p);
  s.x = p.x;
  s.y = p.y;
}

function line(a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawEnd(e) {
  active.delete(e.pointerId);
  ctx.save();
}

function resize() {
  width = Math.round(innerHeight / RATIO);
  height = innerHeight;
  left = (innerWidth - width) / 2;

  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = `${left}px`;

  ctx.lineWidth = 15 * devicePixelRatio;
  ctx.lineCap = "round";

  clear();
}

function pos(e) {
  return {
    x: (e.clientX - left) * devicePixelRatio,
    y: (e.clientY - top) * devicePixelRatio,
  };
}

function snapshot() {
  history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (history.length > MAX_HISTORY) history.shift();
}

function drawConnections() {
  for (let c of CONNECTIONS[index - 1] ?? []) {
    line({ x: 0, y: canvas.height * c }, { x: 20, y: canvas.height * c });
  }

  for (let c of CONNECTIONS[index] ?? []) {
    line(
      { x: canvas.width, y: canvas.height * c },
      { x: canvas.width - 20, y: canvas.height * c },
    );
  }
}

export function clear(i) {
  index = i ?? index;
  history.length = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawConnections();
}

export function undo() {
  if (active.size > 0) return;
  const img = history.pop();
  if (!img) return;
  ctx.putImageData(img, 0, 0);
}
