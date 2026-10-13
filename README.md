# x-embed-kit

Ship interactive experiences that **run inside an X post** — not a link out, but live code that people tap, drag and play with right in the timeline.

```bash
npm run dev                                   # build, watch, serve on :5173
open http://localhost:5173/__preview/gravity-garden
npm run new -- my-thing "My Thing"            # scaffold a new experience
npm run poster                                # screenshot real poster images (needs playwright)
BASE_URL=https://play.yourdomain.com npm run build
npm run check -- https://play.yourdomain.com/e/my-thing/
```

No dependencies. Node 18+. Output is a static `dist/` folder you can host anywhere with HTTPS.

---

## How it works — the hops

X has exactly one mechanism that runs third-party code inside a post: the **Player Card**. When a post contains a URL whose page declares `twitter:card="player"`, X renders an iframe pointing at a page you control. This kit builds everything on both sides of that iframe.

```
 Your post: "try this 👇 https://play.you.com/e/gravity-garden/"
      │
 ①  X's crawler (Twitterbot) fetches  /e/gravity-garden/            ← share page
      │   reads twitter:card=player, twitter:player, poster, size
      ▼
 ②  Post shows the card: poster.png + play button
      │   viewer taps
      ▼
 ③  X iframes  /e/gravity-garden/player.html  inside the post        ← player shell
      │   loader · tap-to-start · scale-to-fit · fallback · "open full" link
      ▼
 ④  Shell iframes  /e/gravity-garden/app/?mode=card                  ← your experience
      │   XEmbed SDK ⇄ shell over postMessage (ready, open-full, events)
      ▼
     Runs in the post. Anyone who opens the link directly gets the same
     experience full-screen on the share page (app/?mode=page).
```

## ⚠️ The gate: X must approve your domain

Player Cards only play inline for domains X has approved. Until yours is, the same post shows a normal image card (your poster) that links to the share page — which still runs the experience full-screen, so nothing is broken, it's just one tap further away.

Things to know before you rely on this:

- **There is no self-serve approval.** The old Card Validator (which had the "request approval" button) was retired in 2022 and X has also taken down the public Cards docs. Current routes are the X Developer Community (Cards category), X developer support, or an X ads/partner rep if you have one. `APPROVAL.md` has a ready-to-send request.
- **Approvals are reportedly rare** outside established media platforms.
- **X's Player Card rules prohibit some interaction types.** The published guidelines say not to build end-to-end interactive experiences such as purchasing, gaming, polling, messaging or data entry inside the player. Interactive visualizations, explorable explainers, demos, simulations and media-adjacent experiences are the most defensible fit. The included examples (a physics toy and a financial explorer) sit in that zone, but X makes the call.
- **Mobile apps vary.** X's iOS/Android apps have historically been less consistent at running player iframes inline than the web. Test on all three.

Because X's own validator is gone, use `npm run check` (below) and a test post from a secondary account. X caches cards per URL; add `?v=2` to the link to force a re-crawl.

---

## Making an experience

Each folder in `experiences/` is one experience:

```
experiences/my-thing/
  experience.json   ← metadata (below)
  index.html        ← your experience; any other files alongside are copied too
  poster.png        ← optional; created by `npm run poster`
```

`experience.json`:

| key | default | what it does |
|---|---|---|
| `title` | folder name | card title (X truncates around 70 chars) |
| `description` | `""` | card description (keep under 200 chars) |
| `width`, `height` | 480 × 480 | the player size declared to X, and the poster's aspect ratio |
| `fit` | `"scale"` | `"scale"`: your app is rendered at exactly width×height and scaled down to whatever size X shows the card. `"fill"`: your app gets the real size and must be responsive itself. |
| `tapToStart` | `false` | show a "Tap to start" button before loading (use it if you need a fresh user gesture for audio) |
| `fullLink` | `"top-right"` | corner for the "open full screen" icon, or `false` to hide it |
| `accent` | `#7c5cff` | colour for buttons and the placeholder poster |
| `imageAlt` | title | poster alt text |
| `posterDelayMs` | 1500 | how long `npm run poster` waits before the screenshot |
| `draft` | `false` | drafts show in `npm run dev` but are left out of production builds |

### Design for the real card size

X shrinks the card to the feed width: roughly 500px wide on desktop and **300–350px on phones**. With `fit: "scale"` a 480×480 experience is shown at ~0.65× on a phone, so use body text of 15px or more and touch targets of 30px or more at your declared size. 480×480 and 640×360 are the safest sizes; square takes more timeline height but gives the most room for interaction. Use the Phone/Small buttons in the local preview to check.

### The XEmbed SDK

Injected automatically into every experience as `window.XEmbed`:

```js
XEmbed.ready()              // call once you've rendered — hides the shell's loader
XEmbed.inCard               // true inside the post, false on the full page
XEmbed.mode                 // 'card' | 'page' | 'standalone' | 'poster'
XEmbed.storage.get(k, def)  // never throws; falls back to memory when the
XEmbed.storage.set(k, v)    //   webview blocks localStorage (common inside X)
XEmbed.openFull()           // open the full-page version in a new tab
XEmbed.onResize(fn)         // fn({ width, height })
XEmbed.track(name, data)    // posts an event to the shell (hook up your analytics there)
```

If you forget `ready()`, the SDK calls it 1.5s after load. If the app never loads, the shell shows an "Open ↗" fallback after 12s.

### Rules that keep it working inside X

- **Everything over HTTPS**, including fonts, images and APIs; mixed content is blocked.
- **No cookies or logins inside the card.** Third-party storage is usually blocked in X's iframe; use `XEmbed.storage`, and treat everything as anonymous.
- **Never send `X-Frame-Options`** on `/e/*`, and if you set a CSP `frame-ancestors`, it must allow X. `npm run check` catches both.
- **Keep the first load light** (aim for under ~1 MB). People are scrolling a timeline on mobile data.
- **No autoplaying sound.** Start audio from a tap (or set `tapToStart`).
- **Pause when hidden.** Listen for `visibilitychange`, as the gravity example does, so you don't burn batteries once someone scrolls past.

---

## Deploying

The build writes `dist/`. Set your real domain first — the card tags must contain absolute HTTPS URLs:

```bash
# either edit site.config.json → "baseUrl", or:
BASE_URL=https://play.yourdomain.com npm run build
```

On Netlify, Vercel and Cloudflare Pages the build falls back to the host's own URL if you haven't set one, but set `BASE_URL` (or `baseUrl`) explicitly once you have a custom domain — card URLs should never change after you post them. Also set `xHandle` in `site.config.json` to the account you'll post from.

- **Cloudflare Pages / Netlify** — build command `npm run build`, output `dist`. `dist/_headers` is picked up automatically; `netlify.toml` is included.
- **Vercel** — `vercel.json` is included (framework: other, output `dist`).
- **GitHub Pages** — `.github/workflows/pages.yml` is included; set a repository variable `BASE_URL`.
- **Anything else** — upload `dist/` to a static host with HTTPS that serves `index.html` for directory URLs and doesn't add `X-Frame-Options`.

Use a dedicated subdomain (e.g. `play.yourdomain.com`). Approval is per domain, and keeping the experiences isolated from your main site keeps their cookies and security policy separate.

Then:

```bash
npm run check -- https://play.yourdomain.com/e/gravity-garden/
```

The checker fetches as Twitterbot and verifies every hop: card meta, poster format/size/aspect, that the player and app pages are framable, HTTPS everywhere, SDK present, robots.txt.

## Files

```
experiences/        your experiences (two examples included)
sdk/xembed.js       the in-experience SDK
templates/blank/    what `npm run new` copies
scripts/build.js    experiences → dist/ (share page, player shell, poster, app)
scripts/serve.js    dev server + /__preview/<slug> timeline mock, rebuilds on save
scripts/check.js    card checker (stands in for X's retired validator)
scripts/poster.js   screenshots each experience at card size for poster.png
APPROVAL.md         template request for Player Card domain approval
```
