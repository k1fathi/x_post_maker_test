require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: true,
  })
);

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;
const SCOPES = ["tweet.write", "tweet.read", "users.read", "offline.access"].join(" ");

// ─── OAuth2 helpers ───────────────────────────────────────────────────────────

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function refreshAccessToken(refreshToken) {
  console.log("Attempting to refresh access token...");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  try {
    const { data } = await axios.post("https://api.twitter.com/2/oauth2/token", params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${creds}`,
      },
    });
    console.log("Token refresh successful");
    return data;
  } catch (err) {
    console.error("Token refresh failed:", err.response?.data || err.message);
    throw err;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// 1. Home — show login or post form
app.get("/", (req, res) => {
  if (!req.session.accessToken) return res.redirect("/login");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>X Poster</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #000; color: #e7e9ea; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #16181c; border: 1px solid #2f3336; border-radius: 16px; padding: 32px; width: 100%; max-width: 520px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; }
    .x-logo { width: 24px; height: 24px; fill: #fff; }
    label { display: block; font-size: 13px; color: #71767b; margin-bottom: 6px; margin-top: 16px; }
    textarea, input[type=text] {
      width: 100%; background: #000; border: 1px solid #2f3336; border-radius: 8px;
      color: #e7e9ea; font-size: 15px; padding: 12px; resize: vertical; outline: none;
      transition: border-color .2s;
    }
    textarea:focus, input[type=text]:focus { border-color: #1d9bf0; }
    textarea { min-height: 120px; }
    .char-count { font-size: 12px; color: #71767b; text-align: right; margin-top: 4px; }
    .char-count.warn { color: #ffd400; }
    .char-count.over { color: #f4212e; }
    button[type=submit] {
      margin-top: 20px; width: 100%; background: #1d9bf0; color: #fff;
      border: none; border-radius: 9999px; padding: 12px; font-size: 15px;
      font-weight: 700; cursor: pointer; transition: background .2s;
    }
    button[type=submit]:hover { background: #1a8cd8; }
    button[type=submit]:disabled { background: #0e4f7a; cursor: not-allowed; }
    .logout { display: block; text-align: center; margin-top: 16px; color: #71767b; font-size: 13px; text-decoration: none; }
    .logout:hover { color: #e7e9ea; }
    #result { margin-top: 20px; padding: 12px 16px; border-radius: 8px; font-size: 14px; display: none; }
    #result.success { background: #0a2e1a; border: 1px solid #00ba7c; color: #00ba7c; }
    #result.error   { background: #2e0a0a; border: 1px solid #f4212e; color: #f4212e; }
    .media-hint { font-size: 12px; color: #536471; margin-top: 4px; }
  </style>
</head>
<body>
<div class="card">
  <h1>
    <svg class="x-logo" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.912-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    Post to X
  </h1>

  <form id="postForm">
    <label for="text">Tweet text</label>
    <textarea id="text" name="text" maxlength="280" placeholder="What's happening?"></textarea>
    <div class="char-count" id="charCount">0 / 280</div>

    <label for="mediaUrl">Media URL <span style="color:#536471">(optional)</span></label>
    <input type="text" id="mediaUrl" name="mediaUrl" placeholder="https://example.com/image.jpg" />
    <p class="media-hint">Provide a public image/GIF/video URL — it will be downloaded and attached to your tweet.</p>

    <button type="submit" id="submitBtn">Post Tweet</button>
  </form>

  <div id="result"></div>
  <a href="/logout" class="logout">Log out</a>
</div>

<script>
  const textarea = document.getElementById('text');
  const counter  = document.getElementById('charCount');
  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    counter.textContent = len + ' / 280';
    counter.className = 'char-count' + (len > 260 ? (len > 280 ? ' over' : ' warn') : '');
  });

  document.getElementById('postForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    const result = document.getElementById('result');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    result.style.display = 'none';

    const body = {
      text: document.getElementById('text').value,
      mediaUrl: document.getElementById('mediaUrl').value.trim() || null
    };

    try {
      const res = await fetch('/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        result.className = 'success';
        result.innerHTML = '✓ Tweet posted! <a href="https://x.com/i/web/status/' + data.id + '" target="_blank" style="color:inherit">View it →</a>';
        document.getElementById('text').value = '';
        document.getElementById('mediaUrl').value = '';
        counter.textContent = '0 / 280';
      } else {
        result.className = 'error';
        result.textContent = '✗ ' + (data.error || 'Something went wrong');
      }
    } catch (err) {
      result.className = 'error';
      result.textContent = '✗ Network error';
    }
    result.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Post Tweet';
  });
</script>
</body>
</html>`);
});

// 2. Start OAuth2 flow
app.get("/login", (req, res) => {
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString("hex");

  req.session.pkceVerifier = verifier;
  req.session.oauthState = state;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
});

// 3. OAuth2 callback
app.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.send(`Auth error: ${error}`);
  if (state !== req.session.oauthState) return res.send("State mismatch — possible CSRF.");

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: req.session.pkceVerifier,
      client_id: CLIENT_ID,
    });

    const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    console.log("Exchanging code for tokens with redirect_uri:", REDIRECT_URI);
    const { data } = await axios.post("https://api.twitter.com/2/oauth2/token", params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${creds}`,
      },
    });

    console.log("OAuth token exchange successful");
    req.session.accessToken = data.access_token;
    req.session.refreshToken = data.refresh_token;
    console.log("OAuth tokens received - access_token present:", !!data.access_token, "refresh_token present:", !!data.refresh_token);
    delete req.session.pkceVerifier;
    delete req.session.oauthState;

    res.redirect("/");
  } catch (err) {
    console.error("Token exchange error:", err.response?.data || err.message);
    res.send("Failed to exchange token. Check your Client ID/Secret.");
  }
});

// 4. Post a tweet (with optional media)
app.post("/post", async (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const { text, mediaUrl } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "Tweet text is required" });

  try {
    let mediaId = null;

    // ── Upload media if URL provided ──────────────────────────────────────────
    if (mediaUrl) {
      // Download the media
      const mediaResp = await axios.get(mediaUrl, { responseType: "arraybuffer" });
      const mediaBuffer = Buffer.from(mediaResp.data);
      const contentType = mediaResp.headers["content-type"] || "image/jpeg";
      const totalBytes = mediaBuffer.length;

      // INIT
      const initParams = new URLSearchParams({
        command: "INIT",
        total_bytes: totalBytes,
        media_type: contentType,
      });
      const initResp = await axios.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        initParams,
        { headers: { Authorization: `Bearer ${req.session.accessToken}` } }
      );
      mediaId = initResp.data.media_id_string;

      // APPEND (chunked in 5MB pieces)
      const chunkSize = 5 * 1024 * 1024;
      let segmentIndex = 0;
      for (let offset = 0; offset < totalBytes; offset += chunkSize) {
        const chunk = mediaBuffer.slice(offset, offset + chunkSize);
        const formData = new URLSearchParams({
          command: "APPEND",
          media_id: mediaId,
          media_data: chunk.toString("base64"),
          segment_index: segmentIndex++,
        });
        await axios.post("https://upload.twitter.com/1.1/media/upload.json", formData, {
          headers: { Authorization: `Bearer ${req.session.accessToken}` },
        });
      }

      // FINALIZE
      const finalizeParams = new URLSearchParams({ command: "FINALIZE", media_id: mediaId });
      await axios.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        finalizeParams,
        { headers: { Authorization: `Bearer ${req.session.accessToken}` } }
      );
    }

    // ── Create the tweet ──────────────────────────────────────────────────────
    const tweetBody = { text };
    if (mediaId) tweetBody.media = { media_ids: [mediaId] };

    const tweetResp = await axios.post(
      "https://api.twitter.com/2/tweets",
      tweetBody,
      {
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Tweet posted successfully:", tweetResp.data);
    res.json({ id: tweetResp.data.data.id, text: tweetResp.data.data.text });
  } catch (err) {
    const apiErr = err.response?.data;
    const status = err.response?.status;
    console.error("Post error:", { status, data: apiErr, message: err.message });
    console.error("Full error:", err);

    // Auto-refresh token on 401
    if (err.response?.status === 401 && req.session.refreshToken) {
      try {
        const tokens = await refreshAccessToken(req.session.refreshToken);
        req.session.accessToken = tokens.access_token;
        if (tokens.refresh_token) req.session.refreshToken = tokens.refresh_token;
        return res.status(401).json({ error: "Token refreshed — please try again." });
      } catch (refreshErr) {
        req.session.destroy();
        return res.status(401).json({ error: "Session expired. Please log in again." });
      }
    }

    res.status(500).json({ error: apiErr?.detail || apiErr?.title || err.message });
  }
});

// 5. Logout
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐦 X Poster running → http://localhost:${PORT}`);
  console.log(`   Redirect URI to register in X Developer Portal:`);
  console.log(`   ${REDIRECT_URI}\n`);
});
