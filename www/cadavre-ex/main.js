import { setup, clear, undo } from "./sketch.js";

let index = 0;
setup();

document.querySelector("#clear").addEventListener("click", (e) => clear(index));
document.querySelector("#undo").addEventListener("click", undo);
document.querySelector("#submit").addEventListener("click", submit);

async function getActiveBoard() {
  const { next } = await fetch(`/api/next`).then((r) => r.json());

  // if (next > 0) {
  //   const left = await fetch(`/api/cadavres/${next - 1}`)
  //     .then((r) => r.json())
  //     .then((d) => d[Math.floor(Math.random() * d.length)]);

  //   document.querySelector(".palette").style.backgroundImage = `url("/drawings/${next - 1}/${left}")`;
  // }

  // if (next < 4) {
  //   const right = await fetch(`/api/cadavres/${next + 1}`)
  //     .then((r) => r.json())
  //     .then((d) => d[Math.floor(Math.random() * d.length)]);

  //   document.querySelector(".actions").style.backgroundImage = `url("/drawings/${next + 1}/${right}")`;
  // }

  index = next;
  clear(index);
}

await getActiveBoard();

async function submit() {
  document.querySelector("#submit").disabled = true;
  document.querySelector("#clear").disabled = true;
  document.querySelector("#undo").disabled = true;
  const blob = await new Promise((r) => document.querySelector("canvas").toBlob(r, "image/png"));

  const res = await fetch(`/api/upload/cadavre/${index}`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });

  const data = await res.json();
  if (res.ok) {
    console.log(`uploaded drawing`);
    await getActiveBoard();
  } else {
    alert(`error ${res.status}: ${JSON.stringify(data)}`);
  }
}
