import config from "./config.json" with { type: "json" };
import { setup, clear, undo } from "./sketch.js";
import { getToken, login, logout } from "./auth.js";

const { CLIENT_ID, CHANNEL } = config;

let index = 0;
let slug = null;

setup();

document.querySelector("#clear").addEventListener("click", (e) => clear(index));
document.querySelector("#undo").addEventListener("click", undo);
document.querySelector("#submit").addEventListener("click", submit);

let token = await getToken();

if (!token && window.confirm("Authenticate?")) {
  login();
}

async function getActiveBoard() {
  const mainBoard = await fetch(
    `https://api.are.na/v3/channels/${CHANNEL}/contents?${Date.now()}`,
  ).then((r) => r.json());

  slug = mainBoard.data.reduce((min, item) =>
    item.counts.blocks < min.counts.blocks ? item : min,
  ).slug;

  index = +slug.match(/\d$/);
  clear(index);
}

await getActiveBoard();

async function submit() {
  document.querySelector("#submit").disabled = true;
  console.log(document.querySelector("#submit").disabled);
  const blob = await new Promise((r) =>
    document.querySelector("canvas").toBlob(r, "image/png"),
  );

  token ??= await getToken();
  if (!token) return login();

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const presignRes = await fetch("https://api.are.na/v3/uploads/presign", {
    method: "POST",
    headers,
    body: JSON.stringify({
      files: [{ filename: "drawing.png", content_type: "image/png" }],
    }),
  });

  if (presignRes.status === 401) {
    logout();
    token = null;
    return login();
  }

  const presignData = await presignRes.json();
  if (!presignRes.ok) {
    alert(`presign error: ${JSON.stringify(presignData)}`);
    return;
  }
  const { upload_url, key } = presignData.files[0];

  await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });

  const imageUrl = `https://s3.amazonaws.com/arena_images-temp/${key}`;
  const res = await fetch("https://api.are.na/v3/blocks", {
    method: "POST",
    headers,
    body: JSON.stringify({
      value: imageUrl,
      channels: [{ id: slug }],
    }),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`uploaded to board slug`);
    await getActiveBoard();
  } else {
    alert(`error ${res.status}: ${JSON.stringify(data)}`);
  }
}
