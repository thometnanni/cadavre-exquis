import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import path, { join } from "node:path";
import { spawn } from "child_process";
import { MAX7219Matrix } from "./matrix.js";
import patterns from "./patterns.json" with { type: "json" };

const DRAWINGS_DIR = "../drawings";
const TMP_DIR = await mkdtemp("/dev/shm/print-");

const CADAVRE = 1;
const ROLL = 2;
const AUTO_PRINT_DELAY = 1000 * 60;

let mode = CADAVRE;

const order = [3, 2, 4, 1, 0];
const matrix = new MAX7219Matrix(4);
await matrix.init();

const app = new Hono();

app.get("/api/next", async (c) => {
  const categories = await Promise.all(
    Object.keys(order).map((category) => readdir(path.join(DRAWINGS_DIR, category))),
  );

  const lengths = categories.map((c) => c.length);
  const next = lengths.findIndex((length) => length === Math.min(...lengths));

  return c.json(
    {
      next,
    },
    202,
  );
});

app.get("/api/cadavres/:category", async (c) => {
  const category = c.req.param("category");
  const drawings = await readdir(path.join(DRAWINGS_DIR, category));

  return c.json(drawings, 200);
});

app.delete("/api/cadavres/:category/:img", async (c) => {
  const category = c.req.param("category");
  const img = c.req.param("img");
  await rm(path.join(DRAWINGS_DIR, category, img));

  return c.json({ deleted: img }, 200);
});

app.get("/api/cadavres/:category/:img", async (c) => {
  const category = c.req.param("category");
  const img = c.req.param("img");

  queueImage(path.join(DRAWINGS_DIR, category, img), category);

  return c.json({ printed: img }, 200);
});

app.get("/api/mode", async (c) => {
  return c.json({ mode }, 200);
});

app.get("/api/mode/cadavre", async (c) => {
  mode = CADAVRE;
  await matrix.setPixels(patterns.cadavre);
  return c.json({ mode }, 200);
});

app.get("/api/mode/roll", async (c) => {
  mode = ROLL;
  await matrix.setPixels(patterns.roll);
  return c.json({ mode }, 200);
});

app.get("/api/cut/:category?", async (c) => {
  const category = c.req.param("category");

  if (printing) {
    return c.json({ error: "printing in progress", queued: queue.length }, 409);
  }
  await cut(category);

  return c.json({}, 202);
});

app.get("/api/pixels", async (c) => {
  return c.json(matrix.getPixels(), 200);
});

app.post("/api/pixels", async (c) => {
  const data = await c.req.json();
  await await matrix.setPixels(data);
  return c.json(matrix.getPixels(), 200);
});

app.get("/api/pixel/:x/:y/:state?", async (c) => {
  const x = +c.req.param("x");
  const y = +c.req.param("y");
  const state = c.req.param("state");

  if (isNaN(x) || x < 0 || x >= 32 || isNaN(y) || y < 0 || y >= 8) {
    return c.json({ status: "out of range" }, 202);
  }

  await matrix.clear();

  await matrix.setPixel(x, y, state === "0" ? false : true);

  return c.json(
    {
      state: matrix.getPixels(),
    },
    202,
  );
});

app.put("/api/upload/cadavre/:category?", async (c) => {
  if (mode !== CADAVRE) {
    return c.json({ error: "wrong mode, get req: /api/mode/cadavre ", queued: queue.length }, 409);
  }
  const buffer = Buffer.from(await c.req.arrayBuffer());
  const category = c.req.param("category");

  const dir = path.join(DRAWINGS_DIR, category);

  const file = `${new Date().getTime()}.png`;
  const filepath = path.join(dir, file);

  await writeFile(filepath, buffer);

  queueImage(filepath, category);

  return c.json(
    {
      file,
      category,
      url: `/drawings/${category}/${file}`,
    },
    202,
  );
});

app.put("/api/upload/roll/:category?", async (c) => {
  if (mode !== ROLL) {
    return c.json({ error: "wrong mode, get req: /api/mode/roll ", queued: queue.length }, 409);
  }
  const buffer = Buffer.from(await c.req.arrayBuffer());
  const category = c.req.param("category");

  const file = `${new Date().getTime()}.png`;
  const filepath = path.join(TMP_DIR, file);

  await writeFile(filepath, buffer);

  queueImage(filepath, category);

  return c.json(
    {
      file,
      category,
      url: `/drawings/${category}/${file}`,
    },
    202,
  );
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

app.use(
  "/drawings/*",
  serveStatic({
    root: DRAWINGS_DIR,
    rewriteRequestPath: (path) => path.replace(/^\/drawings/, "/"),
  }),
);

app.use(
  "/*",
  serveStatic({
    root: `../www`,
    onFound: (_p, c) => c.header("Cache-Control", "no-cache"),
  }),
);

await Promise.all(
  Object.keys(order).map((category) =>
    mkdir(path.join(DRAWINGS_DIR, category), {
      recursive: true,
    }),
  ),
);

serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: 8787,
});

await matrix.setPixels(patterns.ready);
setTimeout(async () => await matrix.setPixels(patterns.cadavre), 2000);

const queue = [];

function queueImage(image, category) {
  timeout = clearTimeout(timeout);
  queue.push({ image, category });
  console.log(queue);
  printImage();
}

async function queueRandomImage() {
  console.log("rando");
  const category = `${Math.floor(Math.random() * order.length)}`;
  const images = (await readdir(path.join(DRAWINGS_DIR, category))).filter((file) => file.split(".").pop() === "png");
  const image = images[Math.floor(Math.random() * images.length)];
  if (!image) return console.log("no image found");
  queueImage(join(DRAWINGS_DIR, category, image), category);
}

let printing = false;
let timeout = null;

const PYTHON = "../image-printer/.venv/bin/python";
const SCRIPT = "../image-printer/print.py";
async function printImage() {
  if (queue.length === 0 && mode === CADAVRE && !timeout)
    return (timeout = setTimeout(queueRandomImage, AUTO_PRINT_DELAY));
  if (printing || queue.length === 0) return;
  printing = true;

  const { image, category } = queue.shift();

  const printer = order[category];

  return new Promise((resolve) => {
    const args = printer != null ? [SCRIPT, "print", image, "-p", printer] : [SCRIPT, "print", image];
    const proc = spawn(PYTHON, args);
    proc.on("close", () => {
      printing = false;
      printImage();
      resolve();
    });
  });
}

async function cut(category) {
  if (printing || queue.length !== 0) return;
  const printer = order[category];
  return new Promise((resolve) => {
    const args = printer != null ? [SCRIPT, "cut", "-p", printer] : [SCRIPT, "cut"];
    const proc = spawn(PYTHON, args);
    proc.on("close", resolve);
  });
}
