/* ============================================================================
 * flowgraph.js  —  a tiny, dependency-free node-graph overlay for the MissionForge
 * web tool.  Think "Unreal Blueprints, heavily simplified".
 *
 * It is now a self-sufficient authoring RUNG for the trigger/effect layer, not just a
 * wiring lens: you can CREATE trigger / support / order nodes, DELETE them, set each
 * effect's self-arm timing (immediate / once / recurring / proximity / on-destroyed)
 * with its key parameter inline, WIRE triggers to effects by dragging, and double-click
 * any node to jump to its full form card for the finer knobs (positions, templates…).
 *
 * DECOUPLED from index.html: it never reaches for page globals. The host calls
 *   FlowGraph.init({ state, onChange, create, locate })  once, passing closures:
 *     state()            -> the live mission-state object S (.triggers/.support/.waypoints)
 *     onChange()         -> re-render the host's form sections + regenerate the Lua
 *     create.{trigger|support|order}()  -> add a node the same way the form's + buttons do
 *     locate(kind, id)   -> close the graph & scroll the host to that node's form card
 * then FlowGraph.open() / .close() to show/hide the canvas.
 *
 * DATA MODEL it edits (identical fields to the forms, so everything stays in sync):
 *   - self-arm mode  ->  N.trigMode = "immediate"|"once"|"recurring"|"proximity"|"onDestroy"
 *     with N.delay / N.interval+N.limit / N.proxRadius / N.onDestroy
 *   - a wire Trigger T -> node N  ->  N.trigMode="ref", N.ref=T.id (canonical/dormant),
 *     or T.fires[] for a 2nd+ trigger feeding the same node.
 *
 * REUSING THIS FOR OTHER FLOWS: everything is driven by graphModel() (nodes) +
 * graphEdges() (wires) + link()/unlink()/setMode()/deleteNode().  Add node kinds &
 * rules there for a different relationship (objective ordering, faction relations, …);
 * the canvas/drag/render code below is generic.
 * ========================================================================== */
(function () {
  'use strict';

  var hooks = { state: function () { return null; }, onChange: function () {}, create: null, locate: null };
  var pos = {};                 // node id -> {x,y}, persisted across opens this session
  var overlay = null, canvas = null, svg = null, els = {}, drag = null;

  var COLOR = { trigger: '#c878ff', support: '#ff8c3a', order: '#b4e63c' };
  var NODE_W = 178, ROW = 100;
  var ARM_MODES = [['immediate', 'immediate'], ['once', 'once (delay)'], ['recurring', 'recurring'], ['proximity', 'player near'], ['onDestroy', 'on destroyed']];

  function S() { return hooks.state(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---- model: derive the graph from the live mission state ---- */
  function graphModel() {
    var s = S() || {}, out = [];
    (s.triggers || []).forEach(function (t) {
      var gate = (t.kind === 'all' || t.kind === 'count');
      var sub = t.kind || 'trigger';
      if (t.kind === 'proximity' || t.kind === 'onDestroy' || t.kind === 'cleared') sub += ' · r' + (t.radius || '?');
      else if (t.kind === 'recurring') sub += ' · ' + (t.interval || '?') + 's';
      else if (t.kind === 'once') sub += ' · ' + (t.delay || '?') + 's';
      else if (t.kind === 'health') sub += ' · <' + (t.pct || 50) + '%';
      else if (t.kind === 'objective') sub += ' · after #' + (t.index || 1);
      else if (t.kind === 'count') sub += ' · need ' + (t.need || 1);
      // a gate accepts wires from other triggers (hasIn) AND fires effects (hasOut)
      out.push({ id: t.id, kind: 'trigger', gate: gate, title: t.id, sub: sub, hasIn: gate, hasOut: true, obj: t });
    });
    (s.support || []).forEach(function (v) {
      out.push({ id: v.id, kind: 'support', title: v.id, sub: v.effect || 'support', hasIn: true, hasOut: false, obj: v }); });
    (s.waypoints || []).forEach(function (w) {
      out.push({ id: w.id, kind: 'order', title: w.id, sub: (w.behavior || 'move') + ' · grp ' + (w.group || '?'), hasIn: true, hasOut: false, obj: w }); });
    return out;
  }
  function findObj(id) {
    var s = S() || {}, n;
    if ((n = (s.support || []).find(function (v) { return v.id === id; }))) return { obj: n, kind: 'support' };
    if ((n = (s.waypoints || []).find(function (w) { return w.id === id; }))) return { obj: n, kind: 'order' };
    if ((n = (s.triggers || []).find(function (t) { return t.id === id; }))) return { obj: n, kind: 'trigger' };
    return null;
  }
  function graphEdges() {
    var s = S() || {}, out = [], seen = {};
    function push(from, to) { var k = from + '' + to; if (from && to && !seen[k]) { seen[k] = 1; out.push({ from: from, to: to }); } }
    (s.support || []).concat(s.waypoints || []).forEach(function (n) { if (n.trigMode === 'ref' && n.ref) push(n.ref, n.id); });
    (s.triggers || []).forEach(function (t) { (t.fires || []).forEach(function (id) { push(t.id, id); }); });
    (s.triggers || []).forEach(function (t) { if (t.kind === 'all' || t.kind === 'count') (t.inputs || []).forEach(function (id) { push(id, t.id); }); });   // input trigger -> gate
    return out;
  }
  function incomingTriggers(nodeId) {
    var s = S() || {}, res = [], nf = findObj(nodeId);
    if (nf && nf.obj.trigMode === 'ref' && nf.obj.ref) res.push(nf.obj.ref);
    (s.triggers || []).forEach(function (t) { if ((t.fires || []).indexOf(nodeId) >= 0 && res.indexOf(t.id) < 0) res.push(t.id); });
    return res;
  }
  function isWired(nodeId) { return incomingTriggers(nodeId).length > 0; }

  /* ---- mutators (write back into the same fields the form UI uses) ---- */
  function link(trigId, nodeId) {
    if (trigId === nodeId) return;
    var t = findObj(trigId), nf = findObj(nodeId);
    if (!t || t.kind !== 'trigger' || !nf) return;   // source must be a trigger (or gate)
    if (nf.kind === 'trigger') {                      // target is a GATE (only gates expose an input port)
      if (nf.obj.kind === 'all' || nf.obj.kind === 'count') { nf.obj.inputs = nf.obj.inputs || [];
        if (nf.obj.inputs.indexOf(trigId) < 0) nf.obj.inputs.push(trigId); changed(); }
      return;
    }
    if (incomingTriggers(nodeId).indexOf(trigId) >= 0) return;                // already wired
    var n = nf.obj;
    if (!(n.trigMode === 'ref' && n.ref)) { n.trigMode = 'ref'; n.ref = trigId; }   // first incoming = canonical ref
    else { t.obj.fires = t.obj.fires || []; if (t.obj.fires.indexOf(nodeId) < 0) t.obj.fires.push(nodeId); }
    changed();
  }
  function unlink(trigId, nodeId) {
    var nf = findObj(nodeId), n = nf ? nf.obj : null, s = S() || {};
    if (nf && nf.kind === 'trigger') {                     // wire into a GATE: just drop it from the gate's inputs
      if (n.inputs) n.inputs = n.inputs.filter(function (x) { return x !== trigId; }); changed(); return;
    }
    if (n && n.trigMode === 'ref' && n.ref === trigId) {   // cut the canonical wire: promote a remaining fires-trigger so it stays gated
      n.ref = ''; var promoted = null;
      (s.triggers || []).forEach(function (t) { if (!promoted && (t.fires || []).indexOf(nodeId) >= 0) promoted = t; });
      if (promoted) { promoted.fires = promoted.fires.filter(function (x) { return x !== nodeId; }); n.ref = promoted.id; }
      else { n.trigMode = 'immediate'; }
    } else { var t = findObj(trigId); if (t && t.obj.fires) t.obj.fires = t.obj.fires.filter(function (x) { return x !== nodeId; }); }
    changed();
  }
  function setMode(nodeId, mode) {   // choose a self-arm timing = DETACH from any triggers and fire on its own
    var nf = findObj(nodeId); if (!nf || nf.kind === 'trigger') return;
    var n = nf.obj; n.trigMode = mode; n.ref = '';
    (S().triggers || []).forEach(function (t) { if (t.fires) t.fires = t.fires.filter(function (x) { return x !== nodeId; }); });
    if (mode === 'once' && !n.delay) n.delay = 3;
    if (mode === 'recurring' && !n.interval) n.interval = 10;
    if (mode === 'proximity' && !n.proxRadius) n.proxRadius = 20;
    if (mode === 'onDestroy' && !n.onDestroy) n.onDestroy = 'nearest';
    changed();
  }
  function deleteNode(id) {
    var s = S() || {};
    ['triggers', 'support', 'waypoints'].forEach(function (k) { if (s[k]) for (var i = s[k].length - 1; i >= 0; i--) if (s[k][i].id === id) s[k].splice(i, 1); });
    (s.support || []).concat(s.waypoints || []).forEach(function (n) { if (n.ref === id) { n.trigMode = 'immediate'; n.ref = ''; } });   // clean dangling refs
    (s.triggers || []).forEach(function (t) { if (t.fires) t.fires = t.fires.filter(function (x) { return x !== id; }); });               // and dangling fires
    delete pos[id]; changed();
  }
  function changed() { try { hooks.onChange(); } catch (e) {} render(); }
  function changedSoft() { try { hooks.onChange(); } catch (e) {} }   // param tweak: sync host+Lua but DON'T rebuild the graph (keeps input focus)

  /* ---- layout: triggers left column, effects right; new nodes stack below existing ---- */
  function ensurePositions(ns) {
    var used = { L: [], R: [] };
    ns.forEach(function (n) { if (pos[n.id]) (n.kind === 'trigger' ? used.L : used.R).push(pos[n.id].y); });
    function nextY(col) { var a = used[col], y = a.length ? Math.max.apply(null, a) + ROW : 26; a.push(y); return y; }
    ns.forEach(function (n) { if (pos[n.id]) return; var left = n.kind === 'trigger'; pos[n.id] = { x: left ? 34 : 384, y: nextY(left ? 'L' : 'R') }; });
  }

  /* ---- styles (injected once; reuses the page's CSS variables for theming) ---- */
  function injectStyle() {
    if (document.getElementById('fg-style')) return;
    var css = [
      '.fg-overlay{position:fixed;inset:0;z-index:9999;background:rgba(8,9,6,.9);display:flex;flex-direction:column;font:13px/1.4 system-ui,sans-serif}',
      '.fg-bar{flex:none;display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line,#333);background:var(--panel,#17170f);flex-wrap:wrap}',
      '.fg-bar .fg-title{font-weight:600;font-size:15px;color:var(--ink,#eee)}',
      '.fg-bar .hint{color:var(--muted,#999);font-size:12px}',
      '.fg-leg{display:flex;gap:12px;align-items:center;margin-left:auto;color:var(--muted,#999);font-size:12px;flex-wrap:wrap}',
      '.fg-btn{background:var(--panel2,#22221a);color:var(--ink,#eee);border:1px solid var(--line,#333);border-radius:6px;padding:6px 11px;font:inherit;font-size:12px;cursor:pointer}',
      '.fg-btn:hover{border-color:var(--accent,#d8b24a)}',
      '.fg-btn.primary{background:var(--accent,#d8b24a);color:#161611;border-color:var(--accent,#d8b24a);font-weight:600}',
      '.fg-scroll{flex:1;overflow:auto;position:relative}',
      '.fg-canvas{position:relative;min-width:100%;min-height:100%;background-color:#0e0f0b;' +
        'background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:26px 26px}',
      '.fg-svg{position:absolute;top:0;left:0;z-index:1}',
      '.fg-node{position:absolute;z-index:2;width:' + NODE_W + 'px;background:var(--panel,#17170f);border:1px solid var(--line,#333);' +
        'border-left-width:3px;border-radius:8px;padding:7px 10px;box-shadow:0 3px 10px rgba(0,0,0,.4);user-select:none}',
      '.fg-node .fg-nt{font:600 12px/1.2 ui-monospace,Menlo,Consolas,monospace;color:var(--ink,#eee);cursor:grab}',
      '.fg-node .fg-ns{font-size:11px;color:var(--muted,#999);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.fg-arm{display:flex;gap:4px;margin-top:6px}',
      '.fg-arm select,.fg-arm input{font:inherit;font-size:11px;padding:2px 4px;background:var(--panel2,#22221a);color:var(--ink,#eee);border:1px solid var(--line,#333);border-radius:4px;min-width:0}',
      '.fg-arm select{flex:1}.fg-arm input{width:56px}',
      '.fg-hintline{font-size:10px;color:var(--muted,#999);margin-top:6px}',
      '.fg-port{position:absolute;width:13px;height:13px;border-radius:50%;top:16px;border:2px solid #0e0f0b;box-sizing:content-box}',
      '.fg-in{left:-8px;background:#6b6b60;cursor:crosshair}.fg-out{right:-8px;cursor:crosshair}',
      '.fg-node.fg-drop .fg-in{background:var(--good,#7ac943);box-shadow:0 0 0 3px rgba(122,201,67,.35)}',
      '.fg-del{position:absolute;top:-9px;right:-9px;width:18px;height:18px;line-height:16px;text-align:center;border-radius:50%;' +
        'background:var(--bad,#e5534b);color:#fff;font-size:11px;cursor:pointer;display:none}',
      '.fg-node:hover .fg-del{display:block}',
      '.fg-empty{position:absolute;top:38%;left:0;right:0;text-align:center;color:var(--muted,#999);font-size:14px;padding:0 20px}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'fg-style'; st.textContent = css; document.head.appendChild(st);
  }

  /* ---- overlay shell + toolbar ---- */
  function build() {
    injectStyle();
    overlay = document.createElement('div'); overlay.className = 'fg-overlay';
    var bar = document.createElement('div'); bar.className = 'fg-bar';
    var title = document.createElement('span'); title.className = 'fg-title'; title.textContent = 'Flow graph';
    var hint = document.createElement('span'); hint.className = 'hint';
    hint.innerHTML = 'Drag a trigger&rsquo;s <b>&#9679;</b> to an effect&rsquo;s <b>&#9711;</b> to fire it &middot; click a wire to cut &middot; double-click a node to edit it fully';
    bar.appendChild(title); bar.appendChild(hint);
    if (hooks.create) [['trigger', '+ trigger'], ['gate', '+ gate'], ['support', '+ support'], ['order', '+ order']].forEach(function (c) {
      if (typeof hooks.create[c[0]] !== 'function') return;
      var b = document.createElement('button'); b.className = 'fg-btn'; b.textContent = c[1];
      b.onclick = function () { try { hooks.create[c[0]](); } catch (e) {} render(); }; bar.appendChild(b);
    });
    var leg = document.createElement('span'); leg.className = 'fg-leg';
    leg.innerHTML = '<span style="color:' + COLOR.trigger + '">&#9679; trigger</span><span style="color:#7ac0ff">&#9679; gate</span><span style="color:' + COLOR.support +
      '">&#9679; support</span><span style="color:' + COLOR.order + '">&#9679; AI order</span>';
    bar.appendChild(leg);
    var reflow = document.createElement('button'); reflow.className = 'fg-btn'; reflow.textContent = 'Auto-layout';
    reflow.onclick = function () { pos = {}; render(); };
    var done = document.createElement('button'); done.className = 'fg-btn primary'; done.textContent = 'Done'; done.onclick = FlowGraph.close;
    bar.appendChild(reflow); bar.appendChild(done);

    var scroll = document.createElement('div'); scroll.className = 'fg-scroll';
    canvas = document.createElement('div'); canvas.className = 'fg-canvas';
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'fg-svg');
    canvas.appendChild(svg); scroll.appendChild(canvas); overlay.appendChild(bar); overlay.appendChild(scroll);
    document.body.appendChild(overlay);
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); document.addEventListener('keydown', onKey);
  }

  /* ---- render ---- */
  function render() {
    if (!overlay) return;
    var ns = graphModel(); ensurePositions(ns);
    Object.keys(els).forEach(function (id) { if (els[id] && els[id].parentNode) els[id].parentNode.removeChild(els[id]); });
    els = {};
    var empty = canvas.querySelector('.fg-empty'); if (empty) empty.remove();
    if (!ns.length) {
      var e = document.createElement('div'); e.className = 'fg-empty';
      e.innerHTML = 'Empty. Use <b>+ trigger</b> / <b>+ support</b> / <b>+ order</b> above to add nodes, then drag between them to wire.';
      canvas.appendChild(e);
    }
    ns.forEach(function (n) { var el = nodeEl(n); els[n.id] = el; canvas.appendChild(el); });
    drawWires(ns);
  }

  function stop(ev) { ev.stopPropagation(); }
  function nodeEl(n) {
    var d = document.createElement('div'); d.className = 'fg-node'; d.dataset.id = n.id;
    d.style.left = pos[n.id].x + 'px'; d.style.top = pos[n.id].y + 'px'; d.style.borderLeftColor = n.gate ? '#7ac0ff' : COLOR[n.kind];
    var t = document.createElement('div'); t.className = 'fg-nt'; t.textContent = n.title; d.appendChild(t);
    var sub = document.createElement('div'); sub.className = 'fg-ns'; sub.textContent = n.sub; d.appendChild(sub);

    if (n.hasIn && n.kind !== 'trigger') {   // support / order: either "fired by a trigger" (wired) OR a self-arm timing you pick here
      if (isWired(n.id)) { var h = document.createElement('div'); h.className = 'fg-hintline'; h.textContent = '⟵ fired by trigger'; d.appendChild(h); }
      else d.appendChild(armRow(n.obj));
    }

    if (n.hasIn) { var pi = document.createElement('div'); pi.className = 'fg-port fg-in'; d.appendChild(pi); }
    if (n.hasOut) { var po = document.createElement('div'); po.className = 'fg-port fg-out'; po.style.background = COLOR[n.kind];
      po.addEventListener('mousedown', function (ev) { startConnect(n, ev); }); d.appendChild(po); }

    var del = document.createElement('div'); del.className = 'fg-del'; del.textContent = '×'; del.title = 'delete this ' + n.kind;
    del.addEventListener('mousedown', stop); del.addEventListener('click', function (ev) { ev.stopPropagation(); deleteNode(n.id); }); d.appendChild(del);

    t.addEventListener('mousedown', function (ev) { startNodeDrag(n, ev); });
    t.addEventListener('dblclick', function (ev) { ev.stopPropagation(); if (hooks.locate) hooks.locate(n.kind, n.id); });
    return d;
  }
  function armRow(o) {   // self-arm timing selector + its one key inline param
    var row = document.createElement('div'); row.className = 'fg-arm';
    var sel = document.createElement('select'); sel.addEventListener('mousedown', stop);
    ARM_MODES.forEach(function (m) { var op = document.createElement('option'); op.value = m[0]; op.textContent = m[1]; sel.appendChild(op); });
    sel.value = (o.trigMode && o.trigMode !== 'ref') ? o.trigMode : 'immediate';
    sel.addEventListener('change', function () { setMode(o.id, sel.value); });
    row.appendChild(sel);
    var field = { once: ['delay', 'sec'], recurring: ['interval', 'sec'], proximity: ['proxRadius', 'units'], onDestroy: ['onDestroy', 'name'] }[sel.value];
    if (field) row.appendChild(paramInput(o, field[0], field[1]));
    return row;
  }
  function paramInput(o, field, ph) {
    var i = document.createElement('input'); i.type = field === 'onDestroy' ? 'text' : 'number';
    i.value = o[field] != null ? o[field] : ''; i.placeholder = ph || '';
    i.addEventListener('mousedown', stop);
    i.addEventListener('input', function () { o[field] = field === 'onDestroy' ? i.value : (parseFloat(i.value) || 0); changedSoft(); });
    return i;
  }

  function portXY(id, which) { var el = els[id]; if (!el) return { x: 0, y: 0 };
    return { x: el.offsetLeft + (which === 'out' ? el.offsetWidth + 2 : -2), y: el.offsetTop + 22 }; }
  function pathD(a, b) { var dx = Math.max(45, Math.abs(b.x - a.x) * 0.5);
    return 'M ' + a.x + ' ' + a.y + ' C ' + (a.x + dx) + ' ' + a.y + ' ' + (b.x - dx) + ' ' + b.y + ' ' + b.x + ' ' + b.y; }
  function drawWires(ns) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var maxX = 580, maxY = 360;
    ns.forEach(function (n) { var e = els[n.id]; if (e) { maxX = Math.max(maxX, e.offsetLeft + e.offsetWidth + 90); maxY = Math.max(maxY, e.offsetTop + e.offsetHeight + 70); } });
    canvas.style.width = maxX + 'px'; canvas.style.height = maxY + 'px'; svg.setAttribute('width', maxX); svg.setAttribute('height', maxY);
    graphEdges().forEach(function (ed) {
      if (!els[ed.from] || !els[ed.to]) return;
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', pathD(portXY(ed.from, 'out'), portXY(ed.to, 'in')));
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', COLOR.trigger); p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linecap', 'round'); p.style.pointerEvents = 'stroke'; p.style.cursor = 'pointer';
      p.addEventListener('mouseenter', function () { p.setAttribute('stroke-width', '4'); p.setAttribute('stroke', 'var(--bad,#e5534b)'); });
      p.addEventListener('mouseleave', function () { p.setAttribute('stroke-width', '2'); p.setAttribute('stroke', COLOR.trigger); });
      p.addEventListener('click', function () { unlink(ed.from, ed.to); });
      var ttl = document.createElementNS('http://www.w3.org/2000/svg', 'title'); ttl.textContent = 'click to disconnect'; p.appendChild(ttl);
      svg.appendChild(p);
    });
  }

  /* ---- drag ---- */
  function startNodeDrag(n, ev) { ev.preventDefault(); drag = { type: 'move', id: n.id, ox: ev.clientX - pos[n.id].x, oy: ev.clientY - pos[n.id].y }; }
  function startConnect(n, ev) {
    ev.preventDefault(); ev.stopPropagation(); drag = { type: 'wire', from: n.id };
    drag.temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    drag.temp.setAttribute('fill', 'none'); drag.temp.setAttribute('stroke', COLOR.trigger); drag.temp.setAttribute('stroke-width', '2');
    drag.temp.setAttribute('stroke-dasharray', '5 4'); drag.temp.style.pointerEvents = 'none'; svg.appendChild(drag.temp);
    canvas.querySelectorAll('.fg-node').forEach(function (el) { if (el.querySelector('.fg-in')) el.classList.add('fg-drop'); });
  }
  function canvasXY(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function onMove(ev) {
    if (!drag) return;
    if (drag.type === 'move') { pos[drag.id] = { x: Math.max(0, ev.clientX - drag.ox), y: Math.max(0, ev.clientY - drag.oy) };
      var el = els[drag.id]; if (el) { el.style.left = pos[drag.id].x + 'px'; el.style.top = pos[drag.id].y + 'px'; } drawWires(graphModel()); }
    else if (drag.type === 'wire') drag.temp.setAttribute('d', pathD(portXY(drag.from, 'out'), canvasXY(ev)));
  }
  function onUp(ev) {
    if (!drag) return;
    if (drag.type === 'wire') {
      canvas.querySelectorAll('.fg-node').forEach(function (el) { el.classList.remove('fg-drop'); });
      if (drag.temp && drag.temp.parentNode) drag.temp.parentNode.removeChild(drag.temp);
      var tgt = ev.target.closest ? ev.target.closest('.fg-node') : null;
      if (tgt && tgt.querySelector('.fg-in')) link(drag.from, tgt.dataset.id);
    }
    drag = null;
  }
  function onKey(ev) { if (ev.key === 'Escape' && overlay) FlowGraph.close(); }

  /* ---- public API ---- */
  var FlowGraph = {
    init: function (opts) { opts = opts || {};
      if (typeof opts.state === 'function') hooks.state = opts.state;
      if (typeof opts.onChange === 'function') hooks.onChange = opts.onChange;
      if (opts.create && typeof opts.create === 'object') hooks.create = opts.create;
      if (typeof opts.locate === 'function') hooks.locate = opts.locate;
    },
    open: function () { if (!overlay) build(); overlay.style.display = 'flex'; render(); },
    close: function () {
      if (!overlay) return;
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('keydown', onKey);
      overlay.remove(); overlay = null; canvas = null; svg = null; els = {}; drag = null;
    },
    render: render
  };
  window.FlowGraph = FlowGraph;
})();
