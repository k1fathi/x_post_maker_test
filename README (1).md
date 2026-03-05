# X Poster — OAuth2 tweet app with media support

Post to X (Twitter) via OAuth 2.0 PKCE. Supports text-only and media-URL tweets.

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure `.env`
```
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here
PORT=3000
CALLBACK_URL=http://localhost:3000/callback
```

### 3. X Developer Portal settings
In your app at https://developer.twitter.com:
- **App type**: Web App (or Native App)
- **Callback URL**: `http://localhost:3000/callback`
- **Required scopes**: `tweet.read`, `tweet.write`, `users.read`, `offline.access`
- OAuth 2.0 must be **enabled**

---

## Run

```bash
node index.js
```

The browser opens automatically at `http://localhost:3000/ui`.

---

## Usage

### Web UI
Visit `http://localhost:3000/ui` — type your tweet, optionally paste a media URL, hit Post.

### REST API

**Post text-only tweet**
```bash
curl -X POST http://localhost:3000/tweet \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from X Poster!"}'
```

**Post tweet with media URL**
```bash
curl -X POST http://localhost:3000/tweet \
  -H "Content-Type: application/json" \
  -d '{"text": "Check this out!", "mediaUrl": "https://example.com/image.jpg"}'
```

**Check auth status**
```bash
curl http://localhost:3000/status
```

---

## Flow

```
/auth  →  X OAuth consent screen  →  /callback  →  tokens saved in memory
                                                         ↓
                              /tweet  (text + optional mediaUrl)
                                                         ↓
                              media downloaded → uploaded to Twitter → tweet posted
```

---

## Notes
- Tokens are stored **in memory** — restart = re-auth. Persist `tokenStore` to a file or DB for production.
- Media upload uses the v1.1 chunked upload API (required for media), while tweeting uses v2.
- Supported media: JPEG, PNG, GIF, WebP (same limits as X's native upload).
