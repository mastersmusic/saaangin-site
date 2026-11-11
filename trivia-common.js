/* SAAANGIN' trivia: helpers shared by /play, /trivia-screen and /trivia-host */
window.TV = (function () {
  'use strict';
  var offset = null; // server clock minus this device's clock

  function api(op, body) {
    var opts = body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    return fetch('/api/trivia/' + op, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
        if (j && typeof j.now === 'number') sync(j.now);
        return j;
      });
    });
  }
  // The state is cached for up to a second, so a reply can carry an old "now".
  // The freshest reply gives the largest difference, so keep the maximum.
  function sync(serverNow) { var d = serverNow - Date.now(); if (offset === null || d > offset) offset = d; }
  function now() { return Date.now() + (offset || 0); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return ('00' + n).slice(-3); }
  function phase(st) { // for a question: lead-in, open, or closed
    if (st.t !== 'q') return '';
    var t = now();
    return t < st.qStart ? 'lead' : t <= st.deadline ? 'open' : 'closed';
  }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  return { api: api, now: now, esc: esc, pad: pad, phase: phase, store: store, LETTERS: ['A', 'B', 'C', 'D'] };
})();
