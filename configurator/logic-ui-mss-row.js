// MSS Logic's module picture for a row of standard nodes (docs/mss-patterns-
// spec.md, The page; work item MP 2). One drawing of the module, left to
// right as the row runs: the main line along the bottom, a siding above it,
// the IR sensor at each Cascade and at each siding's points, and each signal
// beside the track it faces, on the train's right. Every part carries its
// name, so a step can light the ones it is about (`lit`) and a click can say
// which part was picked.
//
// layout(row) is pure and checked by test/mss-page-frame.test.js; draw()
// only turns it into SVG.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const R = () => global.EsphomeMrMssRow;

  const TEXT = Object.freeze({
    label: "Picture of the module",
    end: (name) => `End ${name}`,
    endTrack: (name, track) => `End ${name} ${track}`,
    node: (n, title, turned) => `${n}. ${title}${turned ? " (flipped)" : ""}`,
    noSensor: "(no sensor)",
  });

  const W = 6; // a node's width, in grid units
  const D = 1; // how far the siding's points lead run, along the track
  const OFF = 0.75; // a signal stands this far from its IR sensor or points, on its trains' side
  const Y = Object.freeze({ main: 1, siding: 0 });

  /**
   * Where everything goes, for a row with no problems (else null):
   * { width, rows (1 or 2), nodes: [{ index, x, title, turned }],
   *   blocks: [{ name, road, path: [[x, y], ...] }],
   *   irs: [{ name, node, at }], points: [{ name, node, at }],
   *   signals: [{ name, node, key, at, facing: "left" | "right", heads, side: "above" | "below" }],
   *   ends: [{ name, at: [x, y], roads }] }.
   */
  function layout(row) {
    const nodes = list(row);
    if (!R() || R().problems(nodes).length) return null;
    const w = R().walk(nodes);
    // Each line at its own height: the bottom line lowest, a diverging line
    // just above the line it left.
    const levels = w.order.length;
    const rank = new Map(w.order.map((lane, k) => [lane, k]));
    const yOf = (lane) => (levels === 1 ? 1 : levels - 1 - rank.get(lane));
    const out = { width: nodes.length * W, rows: levels, nodes: [], blocks: [], irs: [], points: [], signals: [], crossovers: [], ends: [] };
    const open = new Map(); // lane -> { path, name }
    w.left.forEach((lane) => open.set(lane, { path: [[0, yOf(lane)]], name: "" }));
    const close = (lane, more) => {
      const o = open.get(lane);
      out.blocks.push({ name: o.name || "", road: w.lanes.get(lane)?.road || "main", path: [...o.path, ...more] });
      open.delete(lane);
    };
    // A signal stands on the right of the trains it faces: below a line for
    // trains heading right, above for trains heading left.
    const signal = (node, key, name, at, facing, heads) => {
      if (name) out.signals.push({ name, node, key, at, facing, heads, side: facing === "right" ? "below" : "above" });
    };
    for (const step of w.steps) {
      const i = step.index;
      const node = step.node;
      const x = i * W;
      const mid = x + W / 2;
      const n = isObject(node.names) ? node.names : {};
      out.nodes.push({ index: i, x, title: R().TEXT.nodes[node.node].title, turned: node.turned === true, line: step.line });
      // A line's first block takes the name the first board on it gives it.
      step.inputs.forEach((input, k) => {
        if (input.fresh) open.get(input.lane).name = node.node === "crossover" ? n.block : list(n.left)[k];
      });
      const lane = step.inputs[0].lane;
      const y = yOf(lane);
      if (node.node === "crossover") {
        if (n.block) out.crossovers.push({ name: n.block, node: i, at: [mid, y] });
        continue;
      }
      if (node.node === "cascade") {
        close(lane, [[mid, y]]);
        out.irs.push({ name: n.ir, node: i, at: [mid, y] });
        signal(i, "toB", n.signals?.toB, [mid - OFF, y], "right", 1);
        signal(i, "toA", n.signals?.toA, [mid + OFF, y], "left", 1);
        open.set(lane, { path: [[mid, y]], name: list(n.right)[0] });
        continue;
      }
      out.irs.push({ name: n.ir, node: i, at: [mid, y] });
      out.points.push({ name: n.points, node: i, at: [mid, y] });
      if (R().isJoin(node)) {
        // The main and diverging lines come in from the left; one line goes on.
        const branch = step.inputs[1].lane;
        const yb = yOf(branch);
        close(lane, [[mid, y]]);
        close(branch, [[mid - D, yb], [mid, y]]);
        signal(i, "single", n.signals?.single, [mid + OFF, y], "left", 2);
        signal(i, "main", n.signals?.main, [mid - D - OFF, y], "right", 1);
        signal(i, "siding", n.signals?.siding, [mid - D - OFF, yb], "right", 1);
        open.set(lane, { path: [[mid, y]], name: list(n.right)[0] });
      } else {
        const branch = step.out[1];
        const yb = yOf(branch);
        close(lane, [[mid, y]]);
        signal(i, "single", n.signals?.single, [mid - OFF, y], "right", 2);
        signal(i, "main", n.signals?.main, [mid + D + OFF, y], "left", 1);
        signal(i, "siding", n.signals?.siding, [mid + D + OFF, yb], "left", 1);
        open.set(lane, { path: [[mid, y]], name: list(n.right)[0] });
        open.set(branch, { path: [[mid, y], [mid + D, yb]], name: list(n.right)[1] });
      }
    }
    const end = out.width;
    for (const lane of w.right) close(lane, [[end, yOf(lane)]]);
    // End A's tracks from the bottom line, end B's from the top (looking out of each).
    out.ends.push(
      { name: "A", tracks: w.left.map((lane, k) => ({ track: k + 1, at: [0, yOf(lane)] })) },
      { name: "B", tracks: w.right.map((lane, k) => ({ track: w.right.length - k, at: [end, yOf(lane)] })) },
    );
    for (const e of out.ends) e.at = e.tracks[0].at;
    return out;
  }

  // ===== Drawing ============================================================

  const CELL = 56;
  const SVG = "http://www.w3.org/2000/svg";
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const px = (v) => Math.round(v * CELL * 10) / 10;

  /**
   * The picture as an <svg>, or null for a row with problems. `lit`: names
   * to light (a Set). `marks`: { [name]: "done" | "error" | "warning" } for a
   * tick or a dot. `badges`: { [name]: number }.
   */
  function draw(row, { lit = new Set(), marks = {}, badges = {}, bare = false } = {}) {
    const shape = layout(row);
    if (!shape) return null;
    // Bands, from the top: node titles; the siding's signals and its block's
    // name; the main line's signals facing left; the main line; its blocks'
    // names, its IR sensors, and its signals facing right.
    const top = shape.rows > 1 ? -1.35 : -0.45;
    const height = (shape.rows > 1 ? shape.rows - 1 : 1) + 1.1 - top;
    const left = -1.4;
    const width = shape.width + 2.8;
    // Drawn at its own size, never larger: smaller where the page is narrow.
    const root = svg("svg", { class: "mss-row-picture", viewBox: `${px(left)} ${px(top)} ${px(width)} ${px(height)}`, width: px(width), height: px(height), role: "img", "aria-label": TEXT.label });
    const part = (g, name) => {
      g.dataset.part = name;
      if (lit.has(name)) g.classList.add("is-lit");
      if (marks[name]) g.classList.add(`is-${marks[name]}`);
      return g;
    };
    // A part's badge: its number, a tick when done, red with a problem;
    // `off` moves it from the point it belongs to, in pixels.
    const badge = (g, name, at, off = [14, -14]) => {
      if (badges[name] === undefined) return;
      const look = marks[name] ? ` is-${marks[name]}` : "";
      const [x, y] = [px(at[0]) + off[0], px(at[1]) + off[1]];
      g.append(svg("circle", { class: `mss-row-badge${look}`, cx: x, cy: y, r: 9 }),
        svg("text", { class: "mss-row-badge-text", x, y: y + 4, "text-anchor": "middle" }, String(badges[name])));
    };
    // Which way the siding leaves each node's points: badges and names go the other way.
    const away = new Map(shape.nodes.map((node) => [node.index, node.turned ? 1 : -1]));
    // Node outlines and titles, under everything.
    for (const node of shape.nodes) {
      root.append(svg("rect", { class: "mss-row-node", x: px(node.x) + 3, y: px(top) + 3, width: px(W) - 6, height: px(height) - 6, rx: 8 }));
      root.append(svg("text", { class: "mss-row-node-title", x: px(node.x + W / 2), y: px(top) + 16, "text-anchor": "middle" }, TEXT.node(node.index + 1, node.title, node.turned)));
    }
    for (const block of shape.blocks) {
      const g = part(svg("g", { class: "mss-row-block" }), block.name);
      const points = block.path.map(([x, y]) => `${px(x)},${px(y)}`).join(" ");
      g.append(svg("polyline", { class: "mss-row-track", points }));
      // The name sits on the block's longest level stretch.
      let a = block.path[0];
      let b = block.path[1];
      for (let k = 1; k < block.path.length; k += 1) {
        const [p, q] = [block.path[k - 1], block.path[k]];
        if (p[1] === q[1] && Math.abs(q[0] - p[0]) > (a[1] === b[1] ? Math.abs(b[0] - a[0]) : 0)) [a, b] = [p, q];
      }
      const mx = (a[0] + b[0]) / 2;
      g.append(svg("text", { class: "mss-row-label", x: px(mx), y: px(b[1]) + (block.road === "siding" ? -8 : 17), "text-anchor": "middle" }, block.name || TEXT.noSensor));
      // Its badge in the middle of that stretch: above the main line, below the siding.
      badge(g, block.name, [mx, b[1]], block.road === "siding" ? [0, 16] : [0, -14]);
      root.append(g);
    }
    // A Crossover: its detector on the line, in the block it stands in.
    for (const c of shape.crossovers) {
      const g = part(svg("g", { class: "mss-row-crossover" }), c.name);
      g.append(svg("rect", { x: px(c.at[0]) - 6, y: px(c.at[1]) - 6, width: 12, height: 12, rx: 2 }));
      g.append(svg("text", { class: "mss-row-label is-small", x: px(c.at[0]), y: px(c.at[1]) - 10, "text-anchor": "middle" }, c.name));
      badge(g, c.name, c.at, [0, 16]);
      root.append(g);
    }
    for (const p of shape.points) {
      const g = part(svg("g", { class: "mss-row-points" }), p.name);
      g.append(svg("circle", { cx: px(p.at[0]), cy: px(p.at[1]), r: 5 }));
      badge(g, p.name, p.at, [-away.get(p.node) * 16, 14]);
      root.append(g);
    }
    for (const ir of shape.irs) {
      const g = part(svg("g", { class: "mss-row-ir" }), ir.name);
      g.append(svg("line", { x1: px(ir.at[0]), y1: px(ir.at[1]) - 10, x2: px(ir.at[0]), y2: px(ir.at[1]) + 10 }));
      const side = away.get(ir.node);
      g.append(svg("text", { class: "mss-row-label is-small", x: px(ir.at[0]) + side * 4, y: px(ir.at[1]) + 21, "text-anchor": side < 0 ? "end" : "start" }, ir.name));
      badge(g, ir.name, ir.at, [side * 14, -12]);
      root.append(g);
    }
    for (const s of shape.signals) {
      const g = part(svg("g", { class: "mss-row-signal" }), s.name);
      const dy = s.side === "below" ? 0.5 : -0.5;
      const x = px(s.at[0]);
      const y = px(s.at[1] + dy);
      const away = s.facing === "right" ? -1 : 1; // the mast's foot, away from the way it faces
      g.append(svg("line", { class: "mss-row-mast", x1: x + away * 12, y1: y, x2: x, y2: y }));
      for (let h = 0; h < s.heads; h += 1) g.append(svg("circle", { class: "mss-row-head", cx: x - away * (7 + h * 13), cy: y, r: 6 }));
      g.append(svg("text", { class: "mss-row-label is-small", x, y: y + (s.side === "below" ? 19 : -11), "text-anchor": "middle" }, s.name));
      // Its badge beyond the foot of the mast, clear of its name.
      badge(g, s.name, [s.at[0], s.at[1] + dy], [away * 26, 0]);
      root.append(g);
    }
    // Each end, with its Pair button and LED (`end:A:pair`, `end:A:led`) badged beside it.
    for (const e of shape.ends) {
      const anchor = e.name === "A" ? "end" : "start";
      const x = px(e.at[0]) + (e.name === "A" ? -8 : 8);
      const g = part(svg("g", { class: "mss-row-end-part" }), `end:${e.name}`);
      for (const which of ["pair", "led"]) {
        const key = `end:${e.name}:${which}`;
        if (lit.has(key)) g.classList.add("is-lit");
      }
      for (const t of e.tracks) g.append(svg("text", { class: "mss-row-end", x, y: px(t.at[1]) + 4, "text-anchor": anchor }, e.tracks.length > 1 ? TEXT.endTrack(e.name, t.track) : TEXT.end(e.name)));
      ["pair", "led"].forEach((which, k) => {
        const key = `end:${e.name}:${which}`;
        if (badges[key] === undefined) return;
        const bx = e.name === "A" ? e.at[0] - 0.95 + k * 0.4 : e.at[0] + 0.55 + k * 0.4;
        const bg = part(svg("g", { class: "mss-row-end-pin" }), key);
        badge(bg, key, [bx - 0.25, e.at[1] + 0.75]);
        g.append(bg);
      });
      root.append(g);
    }
    // A card's small picture: the track and its parts, without words.
    if (bare) {
      root.querySelectorAll("text").forEach((t) => t.remove());
      root.classList.add("is-bare");
    }
    return root;
  }

  global.EsphomeMrLogicUiMssRow = { TEXT, W, D, OFF, layout, draw };
})(typeof globalThis !== "undefined" ? globalThis : window);
