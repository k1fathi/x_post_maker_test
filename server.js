require("dotenv").config();
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");

const app = express();
// behind nginx / Docker, trust proxy so redirects & protocol are correct
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: true,
  })
);

const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const PORT = process.env.PORT || 3000;
// For production the callback is https://vibte.co/callback. You can override with REDIRECT_URI if needed.
const REDIRECT_URI = process.env.REDIRECT_URI || "https://vibte.co/callback";

// ─── OAuth 1.0a helper ────────────────────────────────────────────────────────

const oauth = OAuth({
  consumer: { key: CONSUMER_KEY, secret: CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(baseString, key) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// 1. Home — show login or post form
app.get("/", (req, res) => {
  if (!req.session.oauthAccessToken || !req.session.oauthAccessTokenSecret) {
    return res.redirect("/login");
  }

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

// 2. Start OAuth 1.0a flow (request token → redirect to X)
app.get("/login", async (req, res) => {
  try {
    const requestData = {
      url: "https://api.twitter.com/oauth/request_token",
      method: "POST",
      data: { oauth_callback: REDIRECT_URI },
    };

    const authHeader = oauth.toHeader(oauth.authorize(requestData));

    const { data } = await axios.post(requestData.url, null, {
      headers: {
        Authorization: authHeader.Authorization,
      },
    });

    const params = new URLSearchParams(data);
    const oauthToken = params.get("oauth_token");
    const oauthTokenSecret = params.get("oauth_token_secret");

    if (!oauthToken || !oauthTokenSecret) {
      console.error("Failed to obtain request token:", data);
      return res.send("Failed to obtain request token. Check your consumer key/secret and app settings.");
    }

    req.session.oauthRequestToken = oauthToken;
    req.session.oauthRequestTokenSecret = oauthTokenSecret;

    res.redirect(`https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`);
  } catch (err) {
    console.error("Request token error:", err.response?.data || err.message);
    res.send("Failed to start OAuth 1.0a flow. Check your credentials.");
  }
});

// 3. OAuth 1.0a callback (exchange request token + verifier for access token)
app.get("/callback", async (req, res) => {
  const { oauth_token, oauth_verifier, denied } = req.query;

  if (denied) return res.send("You denied the app.");
  if (!oauth_token || !oauth_verifier) return res.send("Missing OAuth callback parameters.");
  if (oauth_token !== req.session.oauthRequestToken) return res.send("Token mismatch — possible CSRF.");

  try {
    const requestData = {
      url: "https://api.twitter.com/oauth/access_token",
      method: "POST",
      data: { oauth_verifier },
    };

    const token = {
      key: req.session.oauthRequestToken,
      secret: req.session.oauthRequestTokenSecret,
    };

    const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

    const { data } = await axios.post(requestData.url, null, {
      headers: {
        Authorization: authHeader.Authorization,
      },
      params: { oauth_verifier },
    });

    const params = new URLSearchParams(data);
    const accessToken = params.get("oauth_token");
    const accessTokenSecret = params.get("oauth_token_secret");

    if (!accessToken || !accessTokenSecret) {
      console.error("Failed to obtain access token:", data);
      return res.send("Failed to obtain access token.");
    }

    req.session.oauthAccessToken = accessToken;
    req.session.oauthAccessTokenSecret = accessTokenSecret;
    delete req.session.oauthRequestToken;
    delete req.session.oauthRequestTokenSecret;

    res.redirect("/");
  } catch (err) {
    console.error("Access token error:", err.response?.data || err.message);
    res.send("Failed to complete OAuth 1.0a callback. Check your app configuration.");
  }
});

// 4. Post a tweet (with optional media) using OAuth 1.0a
app.post("/post", async (req, res) => {
  if (!req.session.oauthAccessToken || !req.session.oauthAccessTokenSecret) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const userToken = {
    key: req.session.oauthAccessToken,
    secret: req.session.oauthAccessTokenSecret,
  };

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
      const initParams = {
        command: "INIT",
        total_bytes: totalBytes,
        media_type: contentType,
      };
      const initRequestData = {
        url: "https://upload.twitter.com/1.1/media/upload.json",
        method: "POST",
        data: initParams,
      };
      const initAuthHeader = oauth.toHeader(oauth.authorize(initRequestData, userToken));
      const initResp = await axios.post(
        initRequestData.url,
        new URLSearchParams(initParams),
        {
          headers: {
            ...initAuthHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
      mediaId = initResp.data.media_id_string;

      // APPEND (chunked in 5MB pieces)
      const chunkSize = 5 * 1024 * 1024;
      let segmentIndex = 0;
      for (let offset = 0; offset < totalBytes; offset += chunkSize) {
        const chunk = mediaBuffer.slice(offset, offset + chunkSize);
        const appendParams = {
          command: "APPEND",
          media_id: mediaId,
          media_data: chunk.toString("base64"),
          segment_index: segmentIndex++,
        };
        const appendRequestData = {
          url: "https://upload.twitter.com/1.1/media/upload.json",
          method: "POST",
          data: appendParams,
        };
        const appendAuthHeader = oauth.toHeader(oauth.authorize(appendRequestData, userToken));
        await axios.post(
          appendRequestData.url,
          new URLSearchParams(appendParams),
          {
            headers: {
              ...appendAuthHeader,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        );
      }

      // FINALIZE
      const finalizeParams = {
        command: "FINALIZE",
        media_id: mediaId,
      };
      const finalizeRequestData = {
        url: "https://upload.twitter.com/1.1/media/upload.json",
        method: "POST",
        data: finalizeParams,
      };
      const finalizeAuthHeader = oauth.toHeader(oauth.authorize(finalizeRequestData, userToken));
      await axios.post(
        finalizeRequestData.url,
        new URLSearchParams(finalizeParams),
        {
          headers: {
            ...finalizeAuthHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );
    }

    // ── Create the tweet via v1.1 statuses/update ─────────────────────────────
    const tweetParams = { status: text };
    if (mediaId) tweetParams.media_ids = mediaId;

    const tweetRequestData = {
      url: "https://api.twitter.com/1.1/statuses/update.json",
      method: "POST",
      data: tweetParams,
    };
    const tweetAuthHeader = oauth.toHeader(oauth.authorize(tweetRequestData, userToken));

    const tweetResp = await axios.post(
      tweetRequestData.url,
      new URLSearchParams(tweetParams),
      {
        headers: {
          ...tweetAuthHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("Tweet posted successfully:", tweetResp.data);
    res.json({ id: tweetResp.data.id_str, text: tweetResp.data.text });
  } catch (err) {
    const apiErr = err.response?.data;
    const status = err.response?.status;
    console.error("Post error:", { status, data: apiErr, message: err.message });
    console.error("Full error:", err);

    res
      .status(status || 500)
      .json({ error: apiErr?.errors?.[0]?.message || apiErr?.detail || apiErr?.title || err.message });
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
