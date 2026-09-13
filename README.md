# Last One Left — family edition v2

A private 3×3 elimination quiz game: eliminate eight choices and leave the one correct answer standing.

## What changed in v2

- **68 curated starter puzzles** across Music, Movies & TV, Sports, Geography, Space, Animals, Science, History, Human Body, Nature, and Math.
- **Real photos**: curated choices automatically request representative thumbnails from English Wikipedia/Wikimedia when available. If an image is unavailable (or the choice is abstract, like a number), the tile uses a clean text fallback instead of an emoji.
- **Animated feedback**: safe eliminations flash/pop/fade; wrong taps shake and flash red; the final answer gets a reveal animation; wins trigger confetti.
- **Sound effects**: generated in-browser with Web Audio, so there are no audio files to manage. Tap the speaker button to mute/unmute.
- **Haptic feedback** where the device/browser supports vibration.
- **AI puzzle generator**: type a topic, difficulty and audience; the app calls the optional secure Worker in `ai-worker/`, saves the generated puzzle locally, loads photos, and starts the round without showing you the answer first.
- Existing daily, random, category, pass-and-play, clue, undo, custom puzzle, import/export, stats, and PWA features remain.

---

# Put the app on GitHub Pages

The easiest method requires no Terminal commands.

### 1. Create a repository

1. Sign in at https://github.com/.
2. Click **New repository**.
3. Name it `last-one-left` (or any name you like).
4. If you use GitHub Free, make it **Public** so GitHub Pages is available.
5. Click **Create repository**.

### 2. Upload this app

1. Unzip the downloaded app on your Mac.
2. Open the `last-one-left` folder.
3. In the empty GitHub repository, choose **Add file → Upload files**.
4. Drag the **contents inside** the `last-one-left` folder into GitHub — `index.html` must end up at the repository root, not inside a second nested folder.
5. Commit the upload to `main`.

Your repository root should look roughly like this:

```
index.html
app.js
styles.css
starter-puzzles.js
manifest.webmanifest
sw.js
.nojekyll
assets/
ai-worker/
README.md
```

### 3. Turn on GitHub Pages

1. In the repository, open **Settings**.
2. In the left sidebar choose **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**.
5. Click **Save**.

GitHub will show the final site URL in this same **Settings → Pages** screen. Deployment can take a few minutes.

### 4. The URL to open on your phone

For a normal project repository, the pattern is:

```
https://YOUR-GITHUB-USERNAME.github.io/REPOSITORY-NAME/
```

Example, if the username is `tzachpach` and the repo is `last-one-left`:

```
https://tzachpach.github.io/last-one-left/
```

Open that URL in **Safari** on the iPhone, then choose **Share → Add to Home Screen**. It will launch like a standalone app.

> GitHub Pages sites are internet-accessible. Do not put passwords or API keys anywhere in this repository.

---

# Enable the AI puzzle generator

GitHub Pages is static, so it **cannot securely hold an OpenAI API key**. Do not paste an API key into `app.js`, the browser, or the GitHub repository. The included `ai-worker/worker.js` is a tiny Cloudflare Worker that keeps the key server-side and forwards only the puzzle-generation request.

The Worker uses the OpenAI Responses API, defaults to `gpt-5.6-luna`, asks the model to web-search when freshness matters, and requires a strict 9-choice JSON puzzle format.

## One-time Worker setup

You need a Cloudflare account and Node.js on your Mac.

1. In Terminal, go into the included worker folder:

```bash
cd /path/to/last-one-left/ai-worker
```

2. Copy the example configuration:

```bash
cp wrangler.toml.example wrangler.toml
```

3. Open `wrangler.toml` and replace the sample `ALLOWED_ORIGIN` with your GitHub Pages **origin**. For a project URL such as `https://tzachpach.github.io/last-one-left/`, the origin is just:

```toml
ALLOWED_ORIGIN = "https://tzachpach.github.io"
```

4. Log into Cloudflare and deploy:

```bash
npx wrangler login
npx wrangler deploy
```

5. Create an OpenAI API key in your OpenAI Platform account. Then store it as a Cloudflare secret (never in the code):

```bash
npx wrangler secret put OPENAI_API_KEY
```

Paste the key when Wrangler prompts you. The secret is stored server-side.

6. Wrangler will give you a Worker URL similar to:

```
https://last-one-left-ai.YOUR-SUBDOMAIN.workers.dev
```

7. Open your Last One Left app → **AI puzzle generator**, paste that Worker URL into **AI endpoint**, enter a topic, and tap **Generate & play**. The endpoint is remembered on that device.

## Cost/security note

The AI generator uses your OpenAI API account, so API usage is billed separately from ChatGPT. For a personal family app, use a dedicated OpenAI Project/key and set a modest project budget/usage limit. The Worker deliberately rejects browser calls from origins other than the configured GitHub Pages origin.

---

# Run locally

No Node/npm is needed for the game itself.

Mac: double-click `START_MAC.command`.

Or run:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

Remote Wikipedia images require an internet connection. The app shell itself is cached by its service worker after installation.

# Custom puzzles

The built-in editor still supports your own nine choices and uploaded photos. Custom and AI-generated puzzles are stored in the browser on that device. **Export** creates a JSON backup you can import on another device.
