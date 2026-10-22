/* Pure event ledger shared by reports and tests. No patient counts are inferred. */
(function (root) {
  function build(events) {
    const sessions = [],
      anomalies = [],
      groups = new Map();
    events.forEach((e) => {
      const k = JSON.stringify([e.type, e.no]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    });
    groups.forEach((rows) => {
      rows.sort((a, b) => a.ts - b.ts || a.id - b.id);
      let open = null;
      function finish(end, completed) {
        const segments = open.segments;
        segments[segments.length - 1].end = end;
        sessions.push({ ...open, end, completed });
        open = null;
      }
      rows.forEach((e) => {
        if (!Number.isFinite(+e.ts)) {
          anomalies.push({ kind: "invalid-time", event: e });
          return;
        }
        if (e.isBorrow) {
          const ambiguous = !!open;
          if (open) {
            anomalies.push({ kind: "borrow-before-return", event: e });
            open.incomplete = true;
            finish(e.ts, false);
          }
          open = {
            type: e.type,
            no: e.no,
            ward: e.ward,
            start: e.ts,
            end: null,
            borrowId: e.id,
            returnId: null,
            completed: false,
            incomplete: ambiguous,
            segments: [{ ward: e.ward, start: e.ts, end: null }],
          };
        } else if (e.isTransfer) {
          if (!open) {
            anomalies.push({ kind: "transfer-without-borrow", event: e });
            return;
          }
          open.segments[open.segments.length - 1].end = e.ts;
          open.segments.push({ ward: e.ward, start: e.ts, end: null });
        } else if (e.isReturn) {
          if (!open || e.ts < open.start) {
            anomalies.push({ kind: "return-without-borrow", event: e });
            return;
          }
          if (open.segments.at(-1).ward !== e.ward) {
            open.incomplete = true;
            anomalies.push({ kind: "legacy-cross-ward-return", event: e });
          }
          open.returnWard = e.ward;
          open.returnId = e.id;
          finish(e.ts, true);
        }
      });
      if (open) finish(null, false);
    });
    return { sessions: sessions.sort((a, b) => b.start - a.start), anomalies };
  }
  function clipped(session, start, end, now = new Date(), ward = "") {
    if (session.incomplete) return 0;
    return session.segments.reduce(
      (sum, s) =>
        sum +
        (!ward || s.ward === ward
          ? Math.max(
              0,
              Math.min(+(s.end || now), +end, +now) -
                Math.max(+s.start, +start),
            )
          : 0),
      0,
    );
  }
  function metrics(
    events,
    sessions,
    prepares,
    start,
    end,
    filters = {},
    now = new Date(),
  ) {
    const match = (x) =>
      (!filters.type || x.type === filters.type) &&
      (!filters.no || x.no === filters.no);
    const within = (t) => +t >= +start && +t < +end && +t <= +now;
    const ev = events.filter(
      (e) =>
        match(e) && (!filters.ward || e.ward === filters.ward) && within(e.ts),
    );
    const relevant = sessions.filter(match);
    const completed = relevant.filter(
      (s) =>
        s.completed &&
        !s.incomplete &&
        within(s.end) &&
        (!filters.ward || s.returnWard === filters.ward),
    );
    const cutoff = Math.min(+end, +now);
    const outstanding = relevant.filter(
      (s) =>
        !s.incomplete &&
        +s.start < cutoff &&
        (!s.end || +s.end >= cutoff) &&
        (!filters.ward ||
          s.segments.some(
            (g) =>
              g.ward === filters.ward &&
              +g.start < cutoff &&
              (!g.end || +g.end >= cutoff),
          )),
    );
    return {
      prepared: prepares.filter(
        (p) =>
          match(p) &&
          (!filters.ward || p.ward === filters.ward) &&
          within(p.ts),
      ).length,
      borrowed: ev.filter((e) => e.isBorrow).length,
      returned: ev.filter((e) => e.isReturn).length,
      completed: completed.length,
      outstanding: outstanding.length,
      usageMs: relevant.reduce(
        (sum, s) => sum + clipped(s, start, end, now, filters.ward),
        0,
      ),
      averageMs: completed.length
        ? completed.reduce((sum, s) => sum + (+s.end - +s.start), 0) /
          completed.length
        : null,
    };
  }
  const api = { build, clipped, metrics };
  if (typeof module !== "undefined") module.exports = api;
  else root.MemsLedger = api;
})(typeof window === "undefined" ? globalThis : window);
