// auth.js
const CLIENT_ID = "Pwp7jVE76wgjkQwZOH0vbdwmAjEI5kXC5Ffwz0Br2V8";
const REDIRECT_URI = "https://thometnanni.github.io/cadavre-exquis/";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const state = crypto.randomUUID();

  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("oauth_state", state);

  const url = new URL("https://www.are.na/oauth/authorize");
  for (const [k, v] of Object.entries({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "write",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }))
    url.searchParams.set(k, v);

  location.assign(url);
}

export function logout() {
  localStorage.removeItem("arena_token");
}

export async function getToken() {
  const cached = localStorage.getItem("arena_token");
  if (cached) return cached;

  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return null;

  const verifier = sessionStorage.getItem("pkce_verifier");
  const expected = sessionStorage.getItem("oauth_state");
  sessionStorage.removeItem("pkce_verifier");
  sessionStorage.removeItem("oauth_state");
  history.replaceState(null, "", location.pathname);

  if (!verifier || params.get("state") !== expected) return null;

  const res = await fetch("https://dev.are.na/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) return null;
  const { access_token } = await res.json();
  if (access_token) localStorage.setItem("arena_token", access_token);
  return access_token ?? null;
}
