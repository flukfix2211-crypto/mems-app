let EQUIPMENT_TYPES = [];
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const statsState = {
  view: "daily",
  raw: [],
  assets: [],
  current: [],
  sessions: [],
  anomalies: [],
  selectedMachine: null,
  exportData: null,
};
let statsPdfUrl = "";
let statsPdfName = "";

const byId = (id) => document.getElementById(id);

function statsEsc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function normalizeEquipmentType(value) {
  const def = MEMS_READY_EQUIPMENT_TYPES.find(
    (d) => memsTypeKey(d.registryType) === memsTypeKey(value),
  );
  return def
    ? def.key === "brid_green"
      ? "Bird"
      : def.registryType
    : memsTypeKey(value);
}

function isBorrowAction(value) {
  return String(value || "").includes("ยืม");
}
function isReturnAction(value) {
  return String(value || "").includes("คืน");
}

function bangkokParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

function dateKey(date) {
  const p = bangkokParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function monthKey(date) {
  const p = bangkokParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function dateBounds(value) {
  const [year, month, day] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) - BANGKOK_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86400000) };
}

function monthBounds(value) {
  const [year, month] = value.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - BANGKOK_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - BANGKOK_OFFSET_MS),
  };
}

function fiscalYearFor(date) {
  const p = bangkokParts(date);
  return (p.month >= 10 ? p.year + 1 : p.year) + 543;
}

function fiscalBounds(fiscalYear) {
  const endYear = Number(fiscalYear) - 543;
  return {
    start: new Date(Date.UTC(endYear - 1, 9, 1) - BANGKOK_OFFSET_MS),
    end: new Date(Date.UTC(endYear, 9, 1) - BANGKOK_OFFSET_MS),
  };
}

function fiscalMonths(fiscalYear) {
  const { start } = fiscalBounds(fiscalYear);
  return Array.from({ length: 12 }, (_, index) => {
    const shifted = new Date(start.getTime() + BANGKOK_OFFSET_MS);
    return `${shifted.getUTCFullYear() + Math.floor((shifted.getUTCMonth() + index) / 12)}-${String(((shifted.getUTCMonth() + index) % 12) + 1).padStart(2, "0")}`;
  });
}

function thaiDate(value) {
  const date = typeof value === "string" ? dateBounds(value).start : value;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function thaiDateTime(date) {
  return (
    new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date) + " น."
  );
}

function thaiMonth(value) {
  const { start } = monthBounds(value);
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    month: "long",
    year: "numeric",
  }).format(start);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ชม.";
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(days + " วัน");
  if (hours) parts.push(hours + " ชม.");
  if (!days && minutes) parts.push(minutes + " นาที");
  return parts.join(" ") || "< 1 นาที";
}

function formatHours(ms) {
  return (ms / 3600000).toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

function overlapMs(session, start, end) {
  return MemsLedger.clipped(
    session,
    start,
    end,
    new Date(),
    byId("wardSelect").value,
  );
}
function sessionize(events) {
  return MemsLedger.build(events);
}

function machineKey(type, no) {
  return `${type}::${normalizeMachineNo(no)}`;
}

function aggregateWards(start, end) {
  const wardMap = new Map();
  const wards = [...new Set(statsState.raw.map((e) => e.ward))].filter(
    (w) => !byId("wardSelect").value || w === byId("wardSelect").value,
  );
  wards.forEach((ward) => {
    const metrics = Object.fromEntries(
      EQUIPMENT_TYPES.map((type) => {
        const m = MemsLedger.metrics(
          statsState.raw,
          statsState.sessions,
          statsState.prepares || [],
          start,
          end,
          { type, ward, no: normalizeMachineNo(byId("machineInput").value) },
        );
        return [type, m];
      }),
    );
    if (
      Object.values(metrics).some((m) => m.borrowed || m.returned || m.usageMs)
    )
      wardMap.set(ward, metrics);
  });
  return [...wardMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "th"));
}

function setLoading(loading) {
  byId("refreshBtn").disabled = loading;
  byId("refreshBtn").textContent = loading ? "กำลังอัปเดต…" : "อัปเดตข้อมูล";
}

async function loadStatistics() {
  setLoading(true);
  try {
    const [records, assets, current, prepares] = await Promise.all([
      fetchAllPages(() =>
        supabase
          .from("borrow_records")
          .select(
            "id, action, equipment_name, equipment_number, ward, recorded_at, note",
          )
          .order("recorded_at")
          .order("id"),
      ),
      fetchAllPages(() =>
        supabase
          .from("assets")
          .select("no, type, status")
          .order("type")
          .order("no")
          .order("id"),
      ),
      fetchAllPages(() =>
        supabase
          .from("equipment_status")
          .select(
            "equipment_name, equipment_number, ward, recorded_at, is_borrowed",
          )
          .order("equipment_name")
          .order("equipment_number"),
      ),
      fetchAllPages(() =>
        supabase.from("prepare_records").select("*").order("id"),
      ),
    ]);

    const previousType = byId("typeSelect").value;
    EQUIPMENT_TYPES = [
      ...new Set(
        assets.map((a) => normalizeEquipmentType(a.type)).filter(Boolean),
      ),
    ];
    byId("typeSelect").innerHTML =
      '<option value="">ทุกประเภท</option>' +
      EQUIPMENT_TYPES.map(
        (t) => `<option value="${statsEsc(t)}">${statsEsc(t)}</option>`,
      ).join("");
    byId("typeSelect").value = EQUIPMENT_TYPES.includes(previousType)
      ? previousType
      : "";
    statsState.prepares = prepares.map((p) => ({
      type: normalizeEquipmentType(p.equipment_type),
      no: normalizeMachineNo(p.equipment_number),
      ward: p.ward,
      ts: new Date(p.recorded_at),
      status: p.status,
    }));
    statsState.raw = records
      .map((row) => ({
        id: Number(row.id),
        type: normalizeEquipmentType(row.equipment_name),
        no: normalizeMachineNo(row.equipment_number),
        ward: row.ward || "ไม่ระบุหน่วยงาน",
        ts: new Date(row.recorded_at),
        isBorrow: isBorrowAction(row.action),
        isReturn: isReturnAction(row.action),
        isTransfer: String(row.action).includes("ย้าย"),
      }))
      .filter(
        (row) =>
          row.type &&
          row.no &&
          (row.isBorrow || row.isReturn || row.isTransfer),
      );
    statsState.assets = assets
      .filter((row) => !isAssetHiddenFromDashboard(row.status))
      .map((row) => ({
        type: normalizeEquipmentType(row.type),
        no: normalizeMachineNo(row.no),
        status: row.status || "ใช้งานได้",
      }))
      .filter((row) => EQUIPMENT_TYPES.includes(row.type) && row.no);
    statsState.current = current
      .map((row) => ({
        type: normalizeEquipmentType(row.equipment_name),
        no: normalizeMachineNo(row.equipment_number),
        ward: row.ward || "",
        recordedAt: new Date(row.recorded_at),
        isBorrowed: Boolean(row.is_borrowed),
      }))
      .filter((row) => EQUIPMENT_TYPES.includes(row.type) && row.no);
    const built = sessionize(statsState.raw);
    statsState.sessions = built.sessions;
    statsState.anomalies = built.anomalies;
    records
      .filter(
        (r) =>
          String(r.note || "").includes("เตรียมพร้อมส่ง") &&
          isBorrowAction(r.action) &&
          !prepares.some((p) => String(p.borrow_record_id) === String(r.id)),
      )
      .forEach((r) => {
        const event = statsState.raw.find((e) => e.id === Number(r.id));
        if (event)
          statsState.anomalies.push({
            kind: "legacy-delivery-without-preparation-link",
            event,
          });
      });

    buildFilters();
    renderEquipmentStatus();
    renderView();
    byId("lastUpdated").textContent =
      "อัปเดตล่าสุด " + thaiDateTime(new Date());
  } catch (error) {
    console.error(error);
    byId("viewOutput").innerHTML =
      `<div class="state-panel state-error">โหลดข้อมูลไม่สำเร็จ: ${statsEsc(error.message)}</div>`;
    showToast("โหลดข้อมูลสถิติไม่สำเร็จ");
  } finally {
    setLoading(false);
  }
}

function buildFilters() {
  const years = new Set([fiscalYearFor(new Date())]);
  statsState.raw
    .filter((row) => Number.isFinite(+row.ts))
    .forEach((row) => years.add(fiscalYearFor(row.ts)));
  const fiscalSelect = byId("fiscalSelect");
  const previousFiscal = fiscalSelect.value;
  fiscalSelect.innerHTML = [...years]
    .sort((a, b) => b - a)
    .map((year) => `<option value="${year}">ปีงบประมาณ ${year}</option>`)
    .join("");
  fiscalSelect.value =
    previousFiscal && years.has(Number(previousFiscal))
      ? previousFiscal
      : String(fiscalYearFor(new Date()));

  const wards = [...new Set(statsState.raw.map((event) => event.ward))].sort(
    (a, b) => a.localeCompare(b, "th"),
  );
  const previousWard = byId("wardSelect").value;
  byId("wardSelect").innerHTML =
    '<option value="">ทุกหน่วยงาน</option>' +
    wards
      .map(
        (ward) =>
          `<option value="${statsEsc(ward)}">${statsEsc(ward)}</option>`,
      )
      .join("");
  byId("wardSelect").value = wards.includes(previousWard) ? previousWard : "";

  rebuildMonthOptions();
  if (!byId("dayInput").value) byId("dayInput").value = dateKey(new Date());
}

function rebuildMonthOptions() {
  const fiscal = Number(
    byId("fiscalSelect").value || fiscalYearFor(new Date()),
  );
  const current = byId("monthSelect").value;
  const months = fiscalMonths(fiscal);
  byId("monthSelect").innerHTML = months
    .map((month) => `<option value="${month}">${thaiMonth(month)}</option>`)
    .join("");
  const preferred = months.includes(current)
    ? current
    : months.includes(monthKey(new Date()))
      ? monthKey(new Date())
      : months[0];
  byId("monthSelect").value = preferred;
}

function renderEquipmentStatus() {
  const borrowed = new Map(
    statsState.current
      .filter((row) => row.isBorrowed)
      .map((row) => [machineKey(row.type, row.no), row]),
  );
  const filters = reportFilters();
  byId("equipmentStatusGrid").innerHTML = EQUIPMENT_TYPES.filter(
    (type) => !filters.type || filters.type === type,
  )
    .map((type) => {
      const items = statsState.assets.filter(
        (asset) =>
          asset.type === type &&
          (!filters.no || asset.no === filters.no) &&
          (!filters.ward ||
            borrowed.get(machineKey(type, asset.no))?.ward === filters.ward ||
            statsState.prepares.some(
              (p) =>
                p.status === "เตรียม" &&
                p.type === type &&
                p.no === asset.no &&
                p.ward === filters.ward,
            )),
      );
      const usable = items.filter(
        (asset) => asset.status === "ใช้งานได้",
      ).length;
      const repair = items.filter(
        (asset) => asset.status === "ส่งซ่อม" || asset.status === "ชำรุด",
      ).length;
      const active = items.filter(
        (asset) =>
          asset.status === "ใช้งานได้" &&
          borrowed.has(machineKey(type, asset.no)),
      ).length;
      const prep = items.filter(
        (a) =>
          a.status === "ใช้งานได้" &&
          !borrowed.has(machineKey(type, a.no)) &&
          statsState.prepares.some(
            (p) => p.status === "เตรียม" && p.type === type && p.no === a.no,
          ),
      ).length;
      const ready = items.filter(
        (a) =>
          a.status === "ใช้งานได้" &&
          !borrowed.has(machineKey(type, a.no)) &&
          !statsState.prepares.some(
            (p) => p.status === "เตรียม" && p.type === type && p.no === a.no,
          ),
      ).length;
      return `<article class="equipment-card equipment-${type.replace(/\s/g, "-").toLowerCase()}">
      <div class="equipment-card-head"><span>${statsEsc(type)}</span><strong>${items.length}</strong></div>
      <div class="equipment-card-grid"><div><b>${active}</b><span>ใช้งานอยู่</span></div><div><b>${ready}</b><span>พร้อมใช้</span></div><div><b>${prep}</b><span>เตรียมแล้ว</span></div><div><b>${repair}</b><span>ซ่อม/ชำรุด</span></div></div>
    </article>`;
    })
    .join("");
  const activeSessions = statsState.sessions.filter(
    (session) => !session.completed,
  ).length;
  const bar = byId("qualityBar");
  bar.hidden = false;
  bar.innerHTML = `<strong>สถานะปัจจุบันไม่ขึ้นกับช่วงวันที่:</strong> นับครั้งยืมและรอบใช้งานตามธุรกรรมจริง <span>•</span> รอบกำลังใช้งาน ${activeSessions.toLocaleString("th-TH")} รอบ <span>•</span> ข้อมูลไม่ครบ/รายการผิดลำดับ ${statsState.anomalies.length.toLocaleString("th-TH")} รายการ`;
}

function selectedTypes() {
  const selected = byId("typeSelect").value;
  return selected ? [selected] : EQUIPMENT_TYPES;
}

function renderMetricCards(items) {
  byId("summaryGrid").innerHTML = items
    .map(
      (item) =>
        `<article><span>${statsEsc(item.label)}</span><strong>${statsEsc(item.value)}</strong><small>${statsEsc(item.unit || "")}</small></article>`,
    )
    .join("");
}

function reportFilters() {
  return {
    type: byId("typeSelect").value,
    ward: byId("wardSelect").value,
    no: normalizeMachineNo(byId("machineInput").value),
  };
}
function renderGroupedWardTable(start, end, mode) {
  const rows = aggregateWards(start, end),
    types = selectedTypes();
  const head = [
    "หน่วยงาน",
    "ประเภท",
    "ครั้งยืม",
    "ครั้งคืน",
    "รอบปิดสมบูรณ์",
    "ชั่วโมงใช้งาน",
    "เฉลี่ยรอบที่คืน ณ ตึกนี้ (ชม.)",
  ];
  const body = rows.flatMap(([ward, metrics]) =>
    types.map((type) => {
      const m = metrics[type];
      return [
        ward,
        type,
        m.borrowed,
        m.returned,
        m.completed,
        formatHours(m.usageMs),
        m.averageMs === null ? "—" : formatHours(m.averageMs),
      ];
    }),
  );
  const total = MemsLedger.metrics(
    statsState.raw,
    statsState.sessions,
    statsState.prepares,
    start,
    end,
    reportFilters(),
  );
  renderMetricCards([
    { label: "จำนวนเตรียม", value: total.prepared },
    { label: "ครั้งยืม", value: total.borrowed },
    { label: "ครั้งคืน", value: total.returned },
    { label: "รอบปิดสมบูรณ์", value: total.completed },
    { label: "ค้าง ณ สิ้นช่วง (ถึงเวลาปัจจุบัน)", value: total.outstanding, unit: "เฉพาะรอบที่ข้อมูลครบ" },
    { label: "ชั่วโมงใช้งานในช่วง", value: formatHours(total.usageMs) },
    {
      label: "เฉลี่ยเฉพาะรอบคืนในช่วง",
      value: total.averageMs === null ? "—" : formatHours(total.averageMs),
      unit: "ชั่วโมงต่อรอบ",
    },
  ]);
  byId("viewOutput").innerHTML = body.length
    ? `<table class="stats-data-table"><thead><tr>${head.map((h) => `<th>${statsEsc(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${statsEsc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : '<div class="state-panel">ไม่พบข้อมูลในช่วงที่เลือก</div>';
  statsState.exportData = {
    title: "สถิติยืม–คืน",
    head,
    body: [
      ...body,
      [
        "รวมตามตัวกรอง",
        "",
        total.borrowed,
        total.returned,
        total.completed,
        formatHours(total.usageMs),
        total.averageMs === null ? "—" : formatHours(total.averageMs),
      ],
      ["จำนวนเตรียม", total.prepared],
      ["ค้าง ณ สิ้นช่วง", total.outstanding],
    ],
  };
}

function renderDaily() {
  const value = byId("dayInput").value || dateKey(new Date());
  const { start, end } = dateBounds(value);
  byId("viewTitle").textContent = "สถิติรายวัน";
  byId("viewCaption").textContent =
    thaiDate(value) + " · ธุรกรรมและชั่วโมงตามตึกที่ถือเครื่อง";
  renderGroupedWardTable(start, end, "daily");
  statsState.exportData.subtitle = thaiDate(value);
}
function renderMonthly() {
  const value = byId("monthSelect").value,
    { start, end } = monthBounds(value);
  byId("viewTitle").textContent = "สถิติรายเดือน";
  byId("viewCaption").textContent =
    thaiMonth(value) + " · ชั่วโมงเฉพาะส่วนที่อยู่ในช่วงรายงาน";
  renderGroupedWardTable(start, end, "monthly");
  statsState.exportData.subtitle = thaiMonth(value);
  renderDailyTrend(start, end);
}

function renderDailyTrend(start, end) {
  const rows = [];
  for (let d = new Date(start); d < end; d = new Date(+d + 86400000)) {
    const next = new Date(+d + 86400000),
      m = MemsLedger.metrics(
        statsState.raw,
        statsState.sessions,
        statsState.prepares,
        d,
        next,
        reportFilters(),
      );
    rows.push([dateKey(d), m.borrowed, m.returned, formatHours(m.usageMs)]);
  }
  const head = ["วันที่", "ครั้งยืม", "ครั้งคืน", "ชั่วโมง"];
  byId("viewOutput").insertAdjacentHTML(
    "afterend",
    `<div id="dailyTrend" class="fiscal-trend table-scroll"><h3>แนวโน้มรายวัน</h3><table class="stats-data-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${statsEsc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
  );
  statsState.exportData.body.push([], head, ...rows);
}

function renderFiscal() {
  const fiscal = Number(byId("fiscalSelect").value),
    { start, end } = fiscalBounds(fiscal);
  byId("viewTitle").textContent = "ปีงบประมาณ " + fiscal;
  byId("viewCaption").textContent =
    `1 ตุลาคม ${fiscal - 1} – 30 กันยายน ${fiscal}`;
  renderGroupedWardTable(start, end, "fiscal");
  statsState.exportData.title = "สถิติปีงบประมาณ " + fiscal;
  statsState.exportData.subtitle = byId("viewCaption").textContent;
  const head = [
    "เดือน",
    "จำนวนเตรียม",
    "ครั้งยืม",
    "ครั้งคืน",
    "ค้างปลายเดือน",
    "ชั่วโมง",
  ];
  const rows = fiscalMonths(fiscal).map((month) => {
    const b = monthBounds(month),
      m = MemsLedger.metrics(
        statsState.raw,
        statsState.sessions,
        statsState.prepares,
        b.start,
        b.end,
        reportFilters(),
      );
    return [
      thaiMonth(month),
      m.prepared,
      m.borrowed,
      m.returned,
      m.outstanding,
      formatHours(m.usageMs),
    ];
  });
  byId("viewOutput").insertAdjacentHTML(
    "afterend",
    `<div id="fiscalTrend" class="fiscal-trend table-scroll"><h3>แนวโน้ม 12 เดือนตามตัวกรอง</h3><table class="stats-data-table"><thead><tr>${head.map((h) => `<th>${statsEsc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${statsEsc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
  );
  statsState.exportData.body.push([], head, ...rows);
}

function currentStatusMap() {
  return new Map(
    statsState.current.map((row) => [machineKey(row.type, row.no), row]),
  );
}

function renderMachine() {
  const fiscal = Number(byId("fiscalSelect").value),
    month = byId("monthSelect").value;
  const range = monthBounds(month),
    fiscalRange = fiscalBounds(fiscal),
    filters = reportFilters();
  const current = currentStatusMap();
  const keys = new Map(
    statsState.assets.map((a) => [machineKey(a.type, a.no), a]),
  );
  statsState.sessions.forEach((s) => {
    if (!keys.has(machineKey(s.type, s.no)))
      keys.set(machineKey(s.type, s.no), {
        type: s.type,
        no: s.no,
        status: "ไม่มีทะเบียน — ข้อมูลไม่ครบ",
      });
  });
  const rows = [...keys.values()]
    .filter(
      (a) =>
        (!filters.type || a.type === filters.type) &&
        (!filters.no || a.no === filters.no),
    )
    .map((a) => {
      const state = current.get(machineKey(a.type, a.no));
      const prepared = statsState.prepares.some(
        (p) => p.status === "เตรียม" && p.type === a.type && p.no === a.no,
      );
      const status =
        a.status !== "ใช้งานได้"
          ? a.status
          : state?.isBorrowed
            ? "กำลังยืม"
            : prepared
              ? "เตรียมแล้ว"
              : "พร้อมใช้";
      const m = MemsLedger.metrics(
        statsState.raw,
        statsState.sessions,
        statsState.prepares,
        range.start,
        range.end,
        { ...filters, type: a.type, no: a.no },
      );
      const f = MemsLedger.metrics(
        statsState.raw,
        statsState.sessions,
        statsState.prepares,
        fiscalRange.start,
        fiscalRange.end,
        { ...filters, type: a.type, no: a.no },
      );
      return { a, state, status, m, f };
    })
    .filter(
      (r) =>
        !filters.ward ||
        r.m.borrowed ||
        r.m.returned ||
        r.f.usageMs ||
        r.state?.ward === filters.ward,
    );
  const head = [
    "ประเภท",
    "หมายเลข",
    "สถานะปัจจุบัน",
    "ตึกที่ถือปัจจุบัน",
    "ครั้งยืมเดือน",
    "ชั่วโมงเดือน",
    "ครั้งยืมปีงบ",
    "ชั่วโมงปีงบ",
  ];
  const values = (r) => [
    r.a.type,
    r.a.no,
    r.status,
    r.state?.isBorrowed ? r.state.ward : "—",
    r.m.borrowed,
    formatHours(r.m.usageMs),
    r.f.borrowed,
    formatHours(r.f.usageMs),
  ];
  renderMetricCards([
    { label: "เครื่องตามตัวกรอง", value: rows.length },
    {
      label: "กำลังยืมปัจจุบัน",
      value: rows.filter((r) => r.state?.isBorrowed).length,
    },
    {
      label: "ครั้งยืมเดือน",
      value: rows.reduce((n, r) => n + r.m.borrowed, 0),
    },
    {
      label: "ชั่วโมงปีงบ",
      value: formatHours(rows.reduce((n, r) => n + r.f.usageMs, 0)),
    },
  ]);
  byId("viewTitle").textContent = "สถิติรายเครื่อง";
  byId("viewCaption").textContent =
    thaiMonth(month) + " · ปีงบประมาณ " + fiscal;
  byId("viewOutput").innerHTML =
    `<table class="stats-data-table"><thead><tr>${head.map((h) => `<th>${statsEsc(h)}</th>`).join("")}<th>ประวัติ</th></tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr>${values(r)
            .map((v) => `<td>${statsEsc(v)}</td>`)
            .join(
              "",
            )}<td><button class="detail-btn" data-machine-type="${statsEsc(r.a.type)}" data-machine-no="${statsEsc(r.a.no)}">ดูประวัติ</button></td></tr>`,
      )
      .join("")}</tbody></table>`;
  statsState.exportData = {
    title: "สถิติรายเครื่อง",
    subtitle: byId("viewCaption").textContent,
    head,
    body: rows.map(values),
  };
  if (statsState.selectedMachine)
    showMachineDetail(
      statsState.selectedMachine.type,
      statsState.selectedMachine.no,
    );
}

function showMachineDetail(type, no) {
  statsState.selectedMachine = { type, no };
  const fiscal = Number(byId("fiscalSelect").value);
  const { start, end } = fiscalBounds(fiscal);
  const sessions = statsState.sessions.filter(
    (session) =>
      session.type === type &&
      session.no === no &&
      session.start < end &&
      (session.end || new Date()) > start,
  );
  const detail = byId("machineDetail");
  detail.hidden = false;
  detail.innerHTML = `<div class="machine-detail-head"><div><span>${statsEsc(type)}</span><h3>No.${statsEsc(no)} — รอบใช้งานปีงบประมาณ ${fiscal}</h3></div><button type="button" id="closeMachineDetail" aria-label="ปิดรายละเอียด">×</button></div>
    <div class="table-scroll"><table class="stats-data-table"><thead><tr><th>ครั้ง</th><th>หน่วยงาน</th><th>เริ่มยืม</th><th>คืน</th><th>ระยะเวลา</th><th>สถานะ</th></tr></thead><tbody>${sessions.length ? sessions.map((session, index) => `<tr><td>${index + 1}</td><td class="ward-cell">${statsEsc(session.segments.map((s) => s.ward).join(" → "))}</td><td>${thaiDateTime(session.start)}</td><td>${session.end ? thaiDateTime(session.end) : "—"}</td><td class="number-cell">${formatDuration(overlapMs(session, session.start, session.end || new Date()))}</td><td><span class="status-badge ${session.completed ? "is-complete" : "is-active"}">${session.incomplete ? "ข้อมูลไม่ครบ" : session.completed ? "คืนแล้ว 1 รอบ" : "กำลังใช้งาน"}</span></td></tr>`).join("") : '<tr><td colspan="6">ไม่พบประวัติในปีงบประมาณนี้</td></tr>'}</tbody></table></div>`;
  const incomplete = statsState.anomalies.filter(
    (a) => a.event.type === type && a.event.no === no,
  );
  if (incomplete.length)
    detail.insertAdjacentHTML(
      "beforeend",
      `<p class="state-panel">ข้อมูลไม่ครบ ${incomplete.length} รายการ — ไม่นำมาสร้างชั่วโมงใช้งาน</p>`,
    );
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
  byId("closeMachineDetail").addEventListener("click", () => {
    detail.hidden = true;
    statsState.selectedMachine = null;
  });
}

function renderView() {
  byId("fiscalTrend")?.remove();
  byId("dailyTrend")?.remove();
  renderEquipmentStatus();
  byId("machineDetail").hidden = statsState.view !== "machine";
  document.querySelectorAll(".view-filter").forEach((field) => {
    field.hidden = !field.dataset.views.split(" ").includes(statsState.view);
  });
  document.querySelectorAll(".stats-tab").forEach((tab) => {
    const active = tab.dataset.view === statsState.view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (!statsState.sessions.length && !statsState.assets.length) return;
  if (statsState.view === "daily") renderDaily();
  else if (statsState.view === "monthly") renderMonthly();
  else if (statsState.view === "fiscal") renderFiscal();
  else renderMachine();
  if (byId("rangeStart").value && byId("rangeEnd").value) {
    const start = dateBounds(byId("rangeStart").value).start,
      end = dateBounds(byId("rangeEnd").value).end;
    if (start >= end) {
      showToast("ช่วงวันที่ไม่ถูกต้อง");
      return;
    }
    byId("fiscalTrend")?.remove();
    byId("dailyTrend")?.remove();
    renderGroupedWardTable(start, end, "range");
    byId("viewTitle").textContent = "สถิติตามช่วงวันที่";
    byId("viewCaption").textContent =
      thaiDate(start) + " – " + thaiDate(new Date(+end - 1));
    statsState.exportData.subtitle = byId("viewCaption").textContent;
  }
  const enabled = Boolean(statsState.exportData?.body?.length);
  byId("pdfBtn").disabled = !enabled;
  byId("csvBtn").disabled = !enabled;
}

function exportCsv() {
  const data = statsState.exportData;
  if (!data?.body?.length) return;
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [
    [data.title],
    [data.subtitle || ""],
    [],
    data.head,
    ...data.body,
  ];
  const blob = new Blob(
    ["\ufeff" + rows.map((row) => row.map(quote).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `MEMs_Statistics_${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportPdf() {
  const data = statsState.exportData;
  if (!data?.body?.length) return;
  const button = byId("pdfBtn");
  button.disabled = true;
  button.textContent = "กำลังสร้าง PDF…";
  try {
    const doc = await newThaiPdf({ orientation: "landscape" });
    const generatedAt = thaiDateTime(new Date());
    const y = rptPdfHeader(
      doc,
      data.title,
      data.subtitle || "สถิติการใช้เครื่องช่วยหายใจ",
      generatedAt,
    );
    thaiTable(doc, {
      startY: y,
      head: [data.head],
      body: data.body,
      styles: { fontSize: data.head.length > 9 ? 8.5 : 10 },
      margin: { top: 55 },
      didDrawPage: (tableData) => {
        if (tableData.pageNumber > 1) rptPdfContinuationHeader(doc, data.title);
      },
    });
    rptPdfFooter(doc);
    await rptDeliverPdf(doc, `MEMs_Equipment_Statistics_${Date.now()}.pdf`, {
      preview: true,
    });
  } catch (error) {
    console.error(error);
    showToast("สร้าง PDF ไม่สำเร็จ: " + error.message);
  } finally {
    button.disabled = false;
    button.textContent = "พรีวิว PDF";
  }
}

window.memsOpenPdfPreview = function (blob, filename) {
  if (statsPdfUrl) URL.revokeObjectURL(statsPdfUrl);
  statsPdfUrl = URL.createObjectURL(blob);
  statsPdfName = filename || "MEMs_Statistics.pdf";
  byId("pdfPreviewFilename").textContent = statsPdfName;
  byId("pdfPreviewFrame").src = statsPdfUrl;
  byId("pdfPreviewModal").hidden = false;
  document.body.classList.add("pdf-preview-open");
  document.querySelector(".pdf-preview-close").focus();
};

function closePdfPreview() {
  byId("pdfPreviewModal").hidden = true;
  document.body.classList.remove("pdf-preview-open");
  byId("pdfPreviewFrame").src = "about:blank";
  if (statsPdfUrl) URL.revokeObjectURL(statsPdfUrl);
  statsPdfUrl = "";
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3200);
}

function bindStatisticsEvents() {
  byId("refreshBtn").addEventListener("click", loadStatistics);
  document.querySelectorAll(".stats-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      statsState.view = tab.dataset.view;
      renderView();
    }),
  );
  [
    "dayInput",
    "monthSelect",
    "typeSelect",
    "wardSelect",
    "rangeStart",
    "rangeEnd",
  ].forEach((id) => byId(id).addEventListener("change", renderView));
  byId("fiscalSelect").addEventListener("change", () => {
    rebuildMonthOptions();
    renderView();
  });
  byId("machineInput").addEventListener("input", renderView);
  byId("pdfBtn").addEventListener("click", exportPdf);
  byId("csvBtn").addEventListener("click", exportCsv);
  byId("viewOutput").addEventListener("click", (event) => {
    const button = event.target.closest("[data-machine-type][data-machine-no]");
    if (button)
      showMachineDetail(button.dataset.machineType, button.dataset.machineNo);
  });
  document
    .querySelectorAll("[data-close-pdf]")
    .forEach((button) => button.addEventListener("click", closePdfPreview));
  byId("pdfPreviewModal").addEventListener("click", (event) => {
    if (event.target.id === "pdfPreviewModal") closePdfPreview();
  });
  byId("printPdfBtn").addEventListener("click", () => {
    const frame = byId("pdfPreviewFrame");
    if (frame.src !== "about:blank") {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }
  });
  byId("downloadPdfBtn").addEventListener("click", () => {
    if (!statsPdfUrl) return;
    const link = document.createElement("a");
    link.href = statsPdfUrl;
    link.download = statsPdfName;
    link.click();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("pdfPreviewModal").hidden)
      closePdfPreview();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  bindStatisticsEvents();
  const profile = await memsGuard("dashboard");
  if (profile) loadStatistics();
});
