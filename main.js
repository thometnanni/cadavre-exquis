import config from "./config.json" with { type: "json" };
import { setup, clear, undo } from "./sketch.js";
import { getToken, login, logout } from "./auth.js";

const { CLIENT_ID, CHANNEL } = config;

const index = 0;

setup();

document.querySelector("#clear").addEventListener("click", (e) => clear(index));
document.querySelector("#undo").addEventListener("click", undo);
document.querySelector("#submit").addEventListener("click", submit);

const mainBoard = await fetch(
  `https://api.are.na/v3/channels/${CHANNEL}/contents`,
).then((r) => r.json());

const { slug } = mainBoard.data.reduce((min, item) =>
  item.counts.blocks < min.counts.blocks ? item : min,
);

console.log(slug);
console.log(+slug.match(/\d$/));

clear(+slug.match(/\d$/));

let token = await getToken();
if (!token) login();

async function submit() {
  const blob = await new Promise((r) =>
    document.querySelector("canvas").toBlob(r, "image/png"),
  );

  token ??= await getToken();
  if (!token) return login();

  console.log(token);

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
    // revoked in are.na settings
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
      channels: [{ id: slugs[selectedBoard] }],
    }),
  });
  const data = await res.json();
  if (res.ok) {
    alert(`uploaded to board ${selectedBoard}`);
    await doAuto();
  } else {
    alert(`error ${res.status}: ${JSON.stringify(data)}`);
  }
}
