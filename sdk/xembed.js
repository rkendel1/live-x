/*!
 * XEmbed SDK — tiny runtime for experiences that run inside an X Player Card.
 * Injected automatically by the build into every experience's index.html.
 *
 *   XEmbed.mode        'card' (inside the post) | 'page' (full page) | 'standalone'
 *   XEmbed.inCard      true when running inside the post
 *   XEmbed.ready()     tell the player shell you've loaded (hides the loader)
 *   XEmbed.openFull()  open the full-page version in a new tab
 *   XEmbed.storage     get/set/remove that never throws (falls back to memory)
 *   XEmbed.size()      { width, height } of the visible area
 *   XEmbed.onResize(fn)
 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var framed = false;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  var mode = params.get('mode') || (framed ? 'card' : 'standalone');

  // Full-page URL: the app lives at /e/<slug>/app/, the share page at /e/<slug>/
  var fullUrl = new URL('../', location.href).href;

  function post(msg) {
    try { window.parent.postMessage(Object.assign({ source: 'xembed' }, msg), '*'); } catch (e) {}
  }

  // Storage that survives sandboxed / cookieless iframes (X's webviews often block it).
  var mem = {};
  var ls = null;
  try { ls = window.localStorage; ls.setItem('__xe', '1'); ls.removeItem('__xe'); } catch (e) { ls = null; }
  var storage = {
    get: function (k, d) {
      try { if (ls) { var v = ls.getItem(k); return v === null ? d : JSON.parse(v); } } catch (e) {}
      return k in mem ? mem[k] : d;
    },
    set: function (k, v) { mem[k] = v; try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch (e) {} },
    remove: function (k) { delete mem[k]; try { if (ls) ls.removeItem(k); } catch (e) {} },
    persistent: !!ls
  };

  var resizeFns = [];
  function size() { return { width: window.innerWidth, height: window.innerHeight }; }
  window.addEventListener('resize', function () {
    var s = size(); resizeFns.forEach(function (fn) { try { fn(s); } catch (e) {} });
  });

  var readySent = false;
  var api = {
    mode: mode,
    inCard: mode === 'card',
    fullUrl: fullUrl,
    storage: storage,
    size: size,
    onResize: function (fn) { resizeFns.push(fn); },
    ready: function () { if (!readySent) { readySent = true; post({ type: 'ready' }); } },
    openFull: function () {
      var w = null;
      try { w = window.open(fullUrl, '_blank', 'noopener'); } catch (e) {}
      if (!w) post({ type: 'open-full', url: fullUrl }); // shell will show a tappable link
    },
    track: function (name, data) { post({ type: 'event', name: name, data: data || null }); }
  };

  document.documentElement.setAttribute('data-xembed-mode', mode);
  // Stop the X timeline from scrolling while someone drags inside the experience.
  document.documentElement.style.overscrollBehavior = 'contain';

  // Safety net: if the experience forgets to call ready(), announce once loaded.
  window.addEventListener('load', function () { setTimeout(api.ready, 1500); });

  window.XEmbed = api;
})();
