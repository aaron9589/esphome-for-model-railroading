// A station drawn on the track plan (TP 5): a single line at each end, three
// roads and two crossovers; 18 blocks, 10 signals and 8 turnouts. The checker
// must check it completely (test/checker.test.js, test/bench/checker-limits.mjs).
export function station() {
  const H = (y, a, b) => [[a, y], [b, y]];
  const track = [
    H(2, 0, 3), H(2, 3, 6), H(2, 6, 8), H(2, 8, 9), H(2, 9, 10), H(2, 10, 14), H(2, 14, 17), H(2, 17, 20), H(2, 20, 22), H(2, 22, 24), H(2, 24, 30), H(2, 30, 34), H(2, 34, 35), H(2, 35, 36), H(2, 36, 38), H(2, 38, 41), H(2, 41, 44),
    [[8, 2], [9, 1]], [[9, 1], [10, 0]], H(0, 10, 13), H(0, 13, 16), H(0, 16, 18), H(0, 18, 23), H(0, 23, 29), H(0, 29, 34), [[34, 0], [35, 1]], [[35, 1], [36, 2]],
    [[10, 2], [11, 3]], [[11, 3], [12, 4]], H(4, 12, 15), H(4, 15, 20), H(4, 20, 26), H(4, 26, 29), H(4, 29, 32), [[32, 4], [33, 3]], [[33, 3], [34, 2]],
    [[18, 0], [19, 1]], [[19, 1], [20, 2]],
    [[24, 2], [25, 3]], [[25, 3], [26, 4]],
  ];
  const points = [[8, 2, "W1"], [10, 2, "W2"], [36, 2, "E1"], [34, 2, "E2"], [18, 0, "X1"], [20, 2, "X2"], [24, 2, "Y1"], [26, 4, "Y2"]].map(([x, y, turnout]) => ({ at: [x, y], turnout }));
  const sig = (x, y, mast, fx, fy, extra = {}) => ({ at: [x, y], sensors: [], signals: mast ? [{ mast, facing: [fx, fy], ...extra }] : [] });
  const breaks = [
    sig(3, 2, "West Advance", 4, 2), sig(6, 2, "West Home", 7, 2, { button: "GPIO5" }), sig(9, 2), sig(13, 0, "Road 1 West", 12, 0), sig(14, 2, "Road 2 West", 13, 2), sig(15, 4, "Road 3 West", 14, 4),
    sig(16, 0), sig(17, 2), sig(19, 1), sig(25, 3), sig(23, 0), sig(22, 2), sig(20, 4), sig(35, 1), sig(33, 3),
    sig(29, 0, "Road 1 East", 30, 0), sig(30, 2, "Road 2 East", 31, 2), sig(29, 4, "Road 3 East", 30, 4), sig(35, 2), sig(38, 2, "East Home", 37, 2, { button: "GPIO15" }), sig(41, 2, "East Advance", 40, 2),
  ];
  const blocks = [
    ["West far", [[0, 2], [3, 2]]], ["West approach", [[3, 2], [6, 2]]], ["West throat 1", [[6, 2], [8, 2]]], ["West throat 2", [[10, 2], [14, 2]]],
    ["Road 1 west", [[13, 0], [16, 0]]], ["Road 1 middle", [[16, 0], [18, 0]]], ["Road 1 east", [[23, 0], [29, 0]]], ["Road 2 west", [[14, 2], [17, 2]]], ["Road 2 east", [[22, 2], [24, 2]]],
    ["Road 3 west", [[15, 4], [20, 4]]], ["Road 3 east", [[20, 4], [26, 4]]],
    ["East throat 2", [[30, 2], [34, 2]]], ["East throat 1", [[35, 2], [36, 2]]], ["East approach", [[38, 2], [41, 2]]], ["East far", [[41, 2], [44, 2]]],
    ["Road 1 lead", [[29, 0], [34, 0]]], ["Road 3 lead", [[29, 4], [32, 4]]], ["Road 2 middle", [[17, 2], [20, 2]]],
  ].map(([name, at]) => ({ name, at, sensors: [`${name} current`] }));
  const masts = breaks.flatMap((b) => b.signals.map((s) => s.mast));
  return {
    sensors: blocks.map((b) => b.sensors[0]), turnouts: points.map((p) => p.turnout), masts,
    plan: { track, points, breaks, blocks, ends: [{ at: [0, 2], beyond: "plain" }, { at: [44, 2], beyond: "plain" }] },
  };
}
