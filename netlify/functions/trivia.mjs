// SAAANGIN' trivia: one function behind /api/trivia/*
// Storage is Netlify Blobs (store "trivia"). Nothing personal lives in this repo.
//
//   GET  /api/trivia/state    public game state (cached at the CDN for 1 second)
//   POST /api/trivia/join     {name, phone, email, ig, optin}
//   POST /api/trivia/answer   {pid, game, choice}
//   POST /api/trivia/host     {pin, action, ...}   needs the TRIVIA_HOST_PIN environment variable
//
// Keys:
//   game                      the live game (only the host endpoint writes it)
//   set                       tonight's questions and answers (host-edited; never in the repo)
//   n/<game>/<no>             player-number claims (written only if new)
//   r/<game>/<no>.<name>      roster: number and first name, readable from a key listing
//   p/<game>/<pid>            a player's private record for this game
//   c/<phone digits>          the contact list across nights, with the consent record
//   a/<game>/<q>/<no>.<choice>.<ms>   answers; the earliest one per player counts

import { getStore } from "@netlify/blobs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

const Q_MS = 12000;      // answer window per question
const LEAD_MS = 3000;    // "get ready" lead-in so every phone starts the clock together
const F_MS = 6000;       // countdown shown on each final round
const GRACE_MS = 600;
const MAX_PLAYERS = 400;
const CONSENT_TEXT = "v1: Text and email me my SAAANGIN' invite each week. Unsubscribe any time.";

// Sample set, used until the host saves a real one. These are public, so never play them for a prize.
const DEFAULT_SET = {
  questions: [
    { cat: "Music", q: 'Which group had the 1999 hit "No Scrubs"?', a: ["Destiny's Child", "TLC", "SWV", "En Vogue"], c: 1 },
    { cat: "Pop culture", q: 'On "The Fresh Prince of Bel-Air", which city was Will sent away from?', a: ["Brooklyn", "Chicago", "Philadelphia", "Compton"], c: 2 },
    { cat: "Music", q: 'Usher\'s "Yeah!" features Lil Jon and which rapper?', a: ["Nelly", "Ja Rule", "Ludacris", "T.I."], c: 2 },
    { cat: "Pop culture", q: "Which 2004 movie gave us the Burn Book?", a: ["Mean Girls", "Clueless", "Bring It On", "Legally Blonde"], c: 0 },
    { cat: "Music", q: "Who headlined the Super Bowl halftime show in 2023?", a: ["Beyoncé", "Usher", "The Weeknd", "Rihanna"], c: 3 },
  ],
  final: [
    { a: ['"Waterfalls" · TLC', '"No Diggity" · Blackstreet'], c: 0, why: "1995, a year earlier" },
    { a: ['"Friends"', '"The Fresh Prince of Bel-Air"'], c: 1, why: "1990, four years earlier" },
    { a: ["Instagram", "Twitter"], c: 1, why: "2006, four years earlier" },
  ],
  sample: true,
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const fail = (status, error) => json({ error }, status);
const open = () => getStore({ name: "trivia", consistency: "strong" });
const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64url");
const unb64 = (s) => Buffer.from(String(s), "base64url").toString("utf8");
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k] ?? "";

function steps(set) {
  const out = [{ t: "lobby" }, { t: "rules" }];
  set.questions.forEach((_, i) => out.push({ t: "q", i }, { t: "r", i }));
  out.push({ t: "board" }, { t: "final" });
  set.final.forEach((_, i) => out.push({ t: "f", i }, { t: "fr", i }));
  out.push({ t: "pick" }, { t: "winner" });
  return out;
}
function newGame(prize) {
  return { id: "g" + Date.now().toString(36) + randomBytes(3).toString("hex"), i: 0, prize: prize || "$100 cash", scores: {}, last: null, tally: null, qStart: 0, deadline: 0, winner: null };
}
async function loadGame(s) {
  let g = await s.get("game", { type: "json" });
  if (!g) { g = newGame(); await s.setJSON("game", g); }
  return g;
}
async function loadSet(s) {
  return (await s.get("set", { type: "json" })) || DEFAULT_SET;
}
async function roster(s, g) {
  const { blobs } = await s.list({ prefix: `r/${g.id}/` });
  return blobs
    .map((b) => { const [no, name] = b.key.split("/").pop().split("."); return { no: Number(no), name: unb64(name) }; })
    .sort((a, b) => a.no - b.no);
}
async function answersFor(s, g, qi) {
  const { blobs } = await s.list({ prefix: `a/${g.id}/${qi}/` });
  const best = {};
  for (const b of blobs) {
    const [no, choice, ms] = b.key.split("/").pop().split(".").map(Number);
    if (!(no in best) || ms < best[no].ms) best[no] = { choice, ms };
  }
  return best;
}

async function publicState(s) {
  const [g, set] = await Promise.all([loadGame(s), loadSet(s)]);
  const all = steps(set);
  const st = all[Math.min(g.i, all.length - 1)];
  const ros = await roster(s, g);
  const out = { now: 0, id: g.id, t: st.t, i: st.i ?? 0, nq: set.questions.length, nf: set.final.length, prize: g.prize, count: ros.length, names: ros.slice(-24), qms: Q_MS };
  if (st.t === "q" || st.t === "r") {
    const Q = set.questions[st.i];
    out.q = { cat: Q.cat, q: Q.q, a: Q.a };
    if (st.t === "q") {
      out.qStart = g.qStart; out.deadline = g.deadline;
      out.answered = Object.keys(await answersFor(s, g, st.i)).length;
    } else {
      out.c = Q.c; out.tally = g.tally || [0, 0, 0, 0]; out.results = g.last || {};
    }
  }
  if (st.t === "board") {
    out.scores = g.scores;
    out.top = ros.map((p) => ({ ...p, score: g.scores[p.no] || 0 })).sort((a, b) => b.score - a.score || a.no - b.no).slice(0, 5);
  }
  if (st.t === "f" || st.t === "fr") {
    const F = set.final[st.i];
    out.f = { a: F.a }; out.deadline = g.deadline; out.fms = F_MS;
    if (st.t === "fr") { out.f.c = F.c; out.f.why = F.why; }
  }
  if (st.t === "winner") out.winner = g.winner;
  out.now = Date.now();
  return { out, g, set, all, st, ros };
}

/* ---------------- join ---------------- */
async function join(s, body) {
  if (body.website) return json({ ok: true }); // honeypot field: quietly drop bots
  const name = clean(body.name, 20);
  const phone = clean(body.phone, 24);
  const digits = phone.replace(/\D/g, "");
  const email = clean(body.email, 120).toLowerCase();
  let ig = clean(body.ig, 31).replace(/\s/g, "");
  if (!name) return fail(400, "Add your first name so we can put you on the screen.");
  if (digits.length < 10 || digits.length > 11) return fail(400, "Enter a 10-digit mobile number, like 416 555 0123.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, "Enter a full email address, like you@email.com.");
  if (ig && ig[0] !== "@") ig = "@" + ig;
  const optin = body.optin === true;
  const phoneKey = digits.slice(-10);

  const g = await loadGame(s);
  const when = new Date().toISOString();

  // Same phone joining the same game again gets the same ticket back.
  const dupKey = `d/${g.id}/${phoneKey}`;
  const existing = await s.get(dupKey, { type: "json" });
  if (existing) return json({ pid: existing.pid, no: existing.no, name: existing.name, game: g.id });

  const ros = await roster(s, g);
  if (ros.length >= MAX_PLAYERS) return fail(429, "The game is full. Watch the screen and play along.");
  let no = 0;
  for (let n = ros.length + 1; n <= ros.length + 60; n++) {
    const r = await s.set(`n/${g.id}/${n}`, "1", { onlyIfNew: true });
    if (r && r.modified) { no = n; break; }
  }
  if (!no) return fail(503, "Busy. Tap Join again.");

  const pid = randomBytes(16).toString("hex");
  const first = await s.setJSON(dupKey, { pid, no, name }, { onlyIfNew: true });
  if (first && first.modified === false) { // lost a double-tap race: hand back the first ticket
    const e = await s.get(dupKey, { type: "json" });
    return json({ pid: e.pid, no: e.no, name: e.name, game: g.id });
  }
  await s.setJSON(`p/${g.id}/${pid}`, { pid, game: g.id, no, name, phone, email, ig, optin, joinedAt: when });
  await s.set(`r/${g.id}/${no}.${b64(name)}`, "1");

  const prev = (await s.get(`c/${phoneKey}`, { type: "json" })) || { firstSeen: when, games: 0, optin: false, optAt: null };
  const contact = {
    ...prev, name, phone, email, ig: ig || prev.ig || "",
    lastSeen: when, games: (prev.games || 0) + 1, lastGame: g.id, lastNo: no,
  };
  if (optin && !prev.optin) { contact.optin = true; contact.optAt = when; contact.optText = CONSENT_TEXT; contact.optVia = "trivia join form"; }
  await s.setJSON(`c/${phoneKey}`, contact);

  return json({ pid, no, name, game: g.id });
}

/* ---------------- answer ---------------- */
async function answer(s, body) {
  const choice = Number(body.choice);
  if (![0, 1, 2, 3].includes(choice)) return fail(400, "Pick one of the four answers.");
  const [g, set] = await Promise.all([loadGame(s), loadSet(s)]);
  const st = steps(set)[g.i];
  const now = Date.now();
  if (!st || st.t !== "q" || body.game !== g.id) return fail(409, "That question has closed.");
  if (now < g.qStart - GRACE_MS) return fail(409, "Not open yet.");
  if (now > g.deadline + GRACE_MS) return fail(409, "Time's up on that one.");
  const pid = clean(body.pid, 40).replace(/[^a-f0-9]/g, "");
  const p = pid ? await s.get(`p/${g.id}/${pid}`, { type: "json" }) : null;
  if (!p) return fail(403, "Join the game first.");
  const { blobs } = await s.list({ prefix: `a/${g.id}/${st.i}/${p.no}.` });
  if (blobs.length) return json({ ok: true, already: true });
  const ms = Math.max(0, Math.min(Q_MS, now - g.qStart));
  await s.set(`a/${g.id}/${st.i}/${p.no}.${choice}.${ms}`, "1");
  return json({ ok: true });
}

/* ---------------- host ---------------- */
function pinOk(given) {
  const want = env("TRIVIA_HOST_PIN");
  if (!want) return null;
  const a = createHash("sha256").update(String(given ?? "")).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}
function checkSet(raw) {
  const str = (v, max) => clean(v, max);
  if (!raw || !Array.isArray(raw.questions) || !Array.isArray(raw.final)) return "Send questions and final rounds.";
  if (raw.questions.length < 1 || raw.questions.length > 10) return "Use between 1 and 10 questions.";
  if (raw.final.length < 1 || raw.final.length > 6) return "Use between 1 and 6 final rounds.";
  const set = { questions: [], final: [] };
  for (const [k, q] of raw.questions.entries()) {
    const a = Array.isArray(q.a) ? q.a.map((x) => str(x, 60)) : [];
    const c = Number(q.c);
    if (!str(q.q, 160)) return `Question ${k + 1} has no question text.`;
    if (a.length !== 4 || a.some((x) => !x)) return `Question ${k + 1} needs four answers.`;
    if (![0, 1, 2, 3].includes(c)) return `Mark the right answer for question ${k + 1}.`;
    set.questions.push({ cat: str(q.cat, 24) || "Trivia", q: str(q.q, 160), a, c });
  }
  for (const [k, f] of raw.final.entries()) {
    const a = Array.isArray(f.a) ? f.a.map((x) => str(x, 70)) : [];
    const c = Number(f.c);
    if (a.length !== 2 || a.some((x) => !x)) return `Final round ${k + 1} needs both sides filled in.`;
    if (![0, 1].includes(c)) return `Mark the right side for final round ${k + 1}.`;
    set.final.push({ a, c, why: str(f.why, 80) });
  }
  return set;
}
async function hostView(s) {
  const { out, g, set, st, ros } = await publicState(s);
  let ans = null;
  if (st.t === "q" || st.t === "r") { const Q = set.questions[st.i]; ans = "ABCD"[Q.c] + " · " + Q.a[Q.c]; }
  if (st.t === "f" || st.t === "fr") { const F = set.final[st.i]; ans = "AB"[F.c] + " · " + F.a[F.c]; }
  const top = ros.map((p) => ({ ...p, score: g.scores[p.no] || 0 })).sort((a, b) => b.score - a.score || a.no - b.no)[0] || null;
  return { ...out, step: g.i, answer: ans, top, sample: !!set.sample, set: { questions: set.questions, final: set.final } };
}
async function host(s, body) {
  const ok = pinOk(body.pin);
  if (ok === null) return fail(503, "The host passcode isn't set up yet. Add TRIVIA_HOST_PIN in Netlify.");
  if (!ok) { await new Promise((r) => setTimeout(r, 400)); return fail(401, "That passcode didn't match."); }
  const action = body.action || "state";

  if (action === "next") {
    const [g, set] = await Promise.all([loadGame(s), loadSet(s)]);
    const all = steps(set);
    if (Number(body.from) !== g.i) return json(await hostView(s)); // stale double-tap: change nothing
    const cur = all[g.i];
    const now = Date.now();
    if (cur.t === "winner") return fail(409, "This game is finished. Start a new game.");
    if (cur.t === "pick") {
      const ros = await roster(s, g);
      const w = ros.find((p) => p.no === parseInt(body.no, 10));
      if (!w) return fail(400, "No player has that number. Check the ticket on their phone.");
      g.winner = w;
    }
    if (cur.t === "q") {
      const Q = set.questions[cur.i];
      const best = await answersFor(s, g, cur.i);
      const tally = [0, 0, 0, 0], last = {};
      for (const [no, a] of Object.entries(best)) {
        if (!(a.choice >= 0 && a.choice <= 3)) continue;
        tally[a.choice]++;
        const pts = a.choice === Q.c ? 500 + Math.round(500 * Math.max(0, 1 - a.ms / Q_MS)) : 0;
        g.scores[no] = (g.scores[no] || 0) + pts;
        last[no] = [pts, g.scores[no]];
      }
      g.tally = tally; g.last = last;
    }
    g.i++;
    const nx = all[g.i];
    if (nx.t === "q") { g.qStart = now + LEAD_MS; g.deadline = g.qStart + Q_MS; }
    if (nx.t === "f") g.deadline = now + F_MS;
    await s.setJSON("game", g);
  } else if (action === "reset") {
    const g = await loadGame(s);
    await s.setJSON("game", newGame(g.prize));
  } else if (action === "prize") {
    const g = await loadGame(s);
    g.prize = clean(body.prize, 40) || g.prize;
    await s.setJSON("game", g);
  } else if (action === "remove") {
    const g = await loadGame(s);
    const no = parseInt(body.no, 10);
    const { blobs } = await s.list({ prefix: `r/${g.id}/${no}.` });
    if (!blobs.length) return fail(400, "No player has that number.");
    for (const b of blobs) await s.delete(b.key);
    delete g.scores[no];
    await s.setJSON("game", g);
  } else if (action === "saveSet") {
    const g = await loadGame(s);
    if (g.i !== 0) return fail(409, "Start a new game before changing the questions.");
    const set = checkSet(body.set);
    if (typeof set === "string") return fail(400, set);
    await s.setJSON("set", set);
  } else if (action === "export") {
    const g = await loadGame(s);
    const { blobs } = await s.list({ prefix: "c/" });
    const rows = [];
    for (let k = 0; k < blobs.length; k += 20) {
      rows.push(...(await Promise.all(blobs.slice(k, k + 20).map((b) => s.get(b.key, { type: "json" })))));
    }
    const cell = (v) => {
      let t = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // stop spreadsheet formulas
      return '"' + t.replace(/"/g, '""') + '"';
    };
    const head = ["First name", "Mobile", "Email", "Instagram", "Invites opt-in", "Opted in at", "Consent wording", "First seen", "Last seen", "Games played", "In tonight's game", "Tonight's player no.", "Tonight's score"];
    const lines = [head.map(cell).join(",")];
    for (const c of rows.filter(Boolean).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))) {
      const here = c.lastGame === g.id;
      lines.push([c.name, c.phone, c.email, c.ig, c.optin ? "yes" : "no", c.optAt || "", c.optin ? c.optText || "" : "", c.firstSeen, c.lastSeen, c.games, here ? "yes" : "no", here ? c.lastNo : "", here ? g.scores[c.lastNo] || 0 : ""].map(cell).join(","));
    }
    return json({ csv: lines.join("\r\n"), count: lines.length - 1 });
  } else if (action !== "state") {
    return fail(400, "Unknown host action.");
  }
  return json(await hostView(s));
}

export default async (req, context) => {
  const op = context?.params?.op || new URL(req.url).pathname.split("/").pop();
  try {
    const s = open();
    if (req.method === "GET" && op === "state") {
      const { out } = await publicState(s);
      return json(out, 200, {
        "cache-control": "public, max-age=0, must-revalidate",
        "netlify-cdn-cache-control": "public, max-age=1, must-revalidate",
      });
    }
    if (req.method !== "POST") return fail(405, "Use POST.");
    let body = {};
    try { body = await req.json(); } catch { return fail(400, "Send JSON."); }
    if (op === "join") return await join(s, body);
    if (op === "answer") return await answer(s, body);
    if (op === "host") return await host(s, body);
    return fail(404, "Not found.");
  } catch (err) {
    console.error("trivia error", err);
    return fail(500, "Something went wrong on our side. Try again.");
  }
};

export const config = { path: "/api/trivia/:op" };
