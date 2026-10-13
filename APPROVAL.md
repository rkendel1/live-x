# Requesting Player Card approval

X has no self-serve form for this anymore. Send the request below through whichever channel you have:

- **X Developer Community** → the *Cards* category (public thread; X staff have historically answered approvals there)
- **X developer support** (via the developer portal's help/contact page)
- **Your X ads or partner manager**, if you have one — usually the fastest route

Have these ready first: the domain deployed, `npm run check` passing on at least one live URL, and the posting account's handle in `site.config.json` (`twitter:site`).

---

**Subject:** Player Card whitelisting request — play.YOURDOMAIN.com

Hi X Developer team,

I'd like to request Player Card approval for **play.YOURDOMAIN.com**, attributed to **@YOURHANDLE**.

**What it hosts:** short interactive visual pieces — explorable charts, simulations and animated explainers — that accompany posts from @YOURHANDLE. They are media-style content that viewers watch and adjust, rather than games, polls, purchases, logins or data collection.

**Example URLs (live now):**
- https://play.YOURDOMAIN.com/e/EXAMPLE-1/
- https://play.YOURDOMAIN.com/e/EXAMPLE-2/

**Technical details:**
- `twitter:player` points to a lightweight HTTPS player page at the declared size (e.g. 480×480), with a matching `twitter:image` poster for platforms that don't support inline players.
- All resources are served over HTTPS with no mixed content; no cookies, sign-in or third-party trackers inside the player.
- Pages are framable by X, pause their animation when not visible, never autoplay audio, and include a link to open the full version in a new tab.
- robots.txt allows Twitterbot.

Happy to adjust anything to fit the Player Card guidelines.

Thanks,
YOUR NAME
YOUR EMAIL
