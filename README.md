# saaangin.com

One-page site for **SAAANGIN'** — Toronto's premier invite-only karaoke night, every Tuesday at Rêve Lounge, 456 Richmond St W.

- `index.html` — the whole site (markup, styles and script in one file)
- `hero.mp4` / `hero-poster.jpg` — the hero loop and its poster frame

Deployed on Netlify (project `saaangin`). Pushing to `main` publishes to https://saaangin.com.

## Things worth knowing

- Launch night is set in the script: `FIRST_NIGHT = new Date(2026,9,27,21,0,0)`. The date, countdown and night number roll forward to the next Tuesday on their own, and the "launch night" heading becomes "this week" once the first night has passed.
- The scrolling queue in the top bar is demo content — edit the `QUEUE` array in the script.
- The email signup validates on the page only; there is no backend yet.

## Trivia game

- `/play` (play.html): guests scan the QR, join and answer on their phones.
- `/trivia-screen` (trivia-screen.html): the venue screen. Add it to OBS as a Browser source at 1920 x 1080.
- `/trivia-host` (trivia-host.html): the host remote. Needs the passcode.
- `netlify/functions/trivia.mjs`: the game server. Data lives in Netlify Blobs (store `trivia`), never in this repo.

Setup: set the environment variable `TRIVIA_HOST_PIN` in Netlify (Project configuration > Environment variables), then deploy. The site must be deployed from this repo or with the Netlify CLI; drag-and-drop deploys do not run the function.

Questions and answers are saved from the host page and stored privately. The set in the code is a public sample: do not play it for a prize.
