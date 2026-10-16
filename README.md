# saaangin.com

One-page site for **SAAANGIN'** — Toronto's premier invite-only karaoke night, every Tuesday at Rêve Lounge, 456 Richmond St W.

- `index.html` — the whole site (markup, styles and script in one file)
- `hero.mp4` / `hero-poster.jpg` — the hero loop and its poster frame

Deployed on Netlify (project `saaangin`). Pushing to `main` publishes to https://saaangin.com.

## Things worth knowing

- Launch night is set in the script: `FIRST_NIGHT = new Date(2026,9,27,21,0,0)`. The date, countdown and night number roll forward to the next Tuesday on their own, and the "launch night" heading becomes "this week" once the first night has passed.
- The scrolling queue in the top bar is demo content — edit the `QUEUE` array in the script.
- The email signup validates on the page only; there is no backend yet.
