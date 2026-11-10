"use strict";

(() => {
  const get = id => document.getElementById(id);
  const pageSize = 30;
  const typeNames = Object.fromEntries([...device.options].map(option => [option.value, option.text]));
  const reportColumns = ["จุด", "STD", "STD 1", "เครื่อง 1", "STD 2", "เครื่อง 2", "STD 3", "เครื่อง 3",
    "Standard", "Mean", "Error", "SD", "UCA", "U (k=2)"];

  const draftFields = ["calCertificate", "calDate", "calOperator", "calStandardReference", "calAmbientTemperature", "calHumidity", "calNotes"];
  const metadataDrafts = new Map();
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" }).format(new Date());
  let tools = [];
  let departments = [];
  let queuePage = 0;
  let queueRequest = 0;
  let registerMethod;
  let activeTool;
  let operatorName = "";
  let page = 0;
  let count = 0;
  let filters = {};
  let pending;
  let historyRequest = 0;
  let historyRows = [];
  const notify = message => { status.textContent = message; };
  const display = value => Number.isFinite(value)
    ? formatter.format(Math.abs(value) < 0.00005 ? 0 : value) : "—";
  const dateLabel = date => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(date + "T00:00:00Z"));

  function setOptions(select, entries, placeholder) {
    const previous = select.value;
    select.replaceChildren(new Option(placeholder, ""), ...entries.map(([value, label]) => new Option(label, value)));
    if (entries.some(([value]) => String(value) === previous)) select.value = previous;
  }

  function assetLabel(asset) {
    return [asset.name || asset.type, asset.tool_code || asset.asset_id,
      asset.inventory_no || asset.asset_code, [asset.manufacturer, asset.model].filter(Boolean).join(" "),
      asset.serial_number && "S/N " + asset.serial_number].filter(Boolean).join(" · ");
  }

  function renderQueue() {
    const query = get("calQueueSearch").value.trim().toLowerCase();
    const department = get("calQueueDepartment").value;
    const method = get("calQueueType").value;
    const groupKey = get("calQueueGroup").value;
    const groupOf = tool => groupKey === "department" ? tool.department : typeNames[tool.method];
    const matches = tools.filter(tool => (!department || tool.department === department)
      && (!method || tool.method === method)
      && [tool.tool_code, tool.inventory_no].some(value => value.toLowerCase().includes(query)));
    matches.sort((left, right) => groupOf(left).localeCompare(groupOf(right), "th")
      || left.name.localeCompare(right.name, "th") || left.tool_code.localeCompare(right.tool_code, "th"));

    const groups = new Map();
    for (const tool of matches.slice(queuePage * pageSize, (queuePage + 1) * pageSize)) {
      const group = groupOf(tool);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(tool);
    }
    const list = get("calQueueList");
    list.replaceChildren();
    for (const [name, entries] of groups) {
      const section = document.createElement("section");
      section.className = "cal-queue-group";
      const title = document.createElement("h2");
      title.textContent = name;
      section.append(title);
      for (const tool of entries) {
        const row = document.createElement("div");
        row.className = "cal-queue-row";
        const text = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = tool.name;
        const details = document.createElement("p");
        details.textContent = [typeNames[tool.method], tool.department, "ID " + tool.tool_code,
          tool.inventory_no && "ครุภัณฑ์ " + tool.inventory_no,
          [tool.manufacturer, tool.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
        text.append(name, details);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.toolId = tool.id;
        button.textContent = "เริ่มสอบเทียบ →";
        row.append(text, button);
        section.append(row);
      }
      list.append(section);
    }
    get("calQueueCount").textContent = matches.length
      ? "พบ " + matches.length + " เครื่อง · หน้า " + (queuePage + 1) : "ไม่พบเครื่องมือในทะเบียนตามที่ค้นหา";
    get("calQueuePrev").disabled = queuePage === 0;
    get("calQueueNext").disabled = (queuePage + 1) * pageSize >= matches.length;
  }

  async function openQueue() {
    showView("queue");
    const request = ++queueRequest;
    get("calQueueList").replaceChildren();
    get("calQueueCount").textContent = "กำลังโหลดทะเบียน…";
    get("calQueuePrev").disabled = true;
    get("calQueueNext").disabled = true;
    get("calQueueTitle").focus();
    notify("ค้นหาและเลือกเครื่องที่จะสอบเทียบ");
    const data = await fetchAllPages(() => supabase.from("mems_calibration_tools").select("*").order("id"));
    if (request !== queueRequest) return;
    tools = data;
    const queueDepartments = [...new Set(tools.map(tool => tool.department))].sort((a,b) => a.localeCompare(b,"th"));
    setOptions(get("calQueueDepartment"), queueDepartments.map(name => [name, name]), "ทุกหน่วยงาน");
    queuePage = 0;
    renderQueue();
  }

  function openRegistration(method) {
    if (registerMethod !== method) get("calRegister").reset();
    registerMethod = method;
    get("calRegisterName").value = typeNames[method];
    get("calRegisterTitle").textContent = "ลงทะเบียน · " + typeNames[method];
    showView("register");
    notify("กรอกรายละเอียดเครื่องมือสำหรับทะเบียนสอบเทียบ");
    get("calRegisterTitle").focus();
  }

  async function registerTool() {
    const tool = Object.fromEntries([...new FormData(get("calRegister"))].map(([key, value]) => [key, value.trim()]));
    if (!tool.name || !tool.tool_code) throw new Error("กรุณากรอกชื่อและ ID เครื่องมือ");
    const { error } = await supabase.from("mems_calibration_tools").insert({ ...tool, method: registerMethod });
    if (error?.code === "23505") throw new Error("ID เครื่องมือนี้มีในทะเบียนสอบเทียบแล้ว");
    if (error) throw error;
    get("calRegister").reset();
    get("calQueueSearch").value = "";
    get("calQueueDepartment").value = "";
    get("calQueueType").value = "";
    try {
      await openQueue();
      notify("ลงทะเบียน " + tool.tool_code + " แล้ว · เลือกเครื่องเพื่อเริ่มสอบเทียบ");
    } catch (error) {
      notify("ลงทะเบียน " + tool.tool_code + " แล้ว · โหลดคิวไม่สำเร็จ: " + error.message);
    }
  }

  async function refreshFilters() {
    const { data, error } = await supabase.rpc("mems_calibration_filter_options");
    if (error) throw error;
    setOptions(get("calFilterDepartment"), data.departments.map(name => [name, name]), "ทุกหน่วยงาน");
    setOptions(get("calFilterType"), data.equipment_types.map(name => [name, name]), "ทุกประเภท");
  }

  function historyQuery(columns, options, criteria) {
    let query = supabase.from("mems_calibrations").select(columns, options)
      .order("calibrated_on", { ascending: false }).order("id", { ascending: false });
    if (criteria.department) query = query.eq("department", criteria.department);
    if (criteria.equipmentType) query = query.eq("equipment_type", criteria.equipmentType);
    if (criteria.search) query = query.ilike("search_text", "%" + criteria.search.replace(/[\\%_]/g, char => "\\" + char) + "%");
    return query;
  }

  async function loadHistory() {
    const request = ++historyRequest;
    get("calPrev").disabled = true;
    get("calNext").disabled = true;
    get("calPrintFiltered").disabled = true;
    get("calList").replaceChildren();
    historyRows = [];
    get("calCount").textContent = "กำลังโหลดรายการ…";
    const { data, count: total, error } = await historyQuery(
      "id,calibrated_on,certificate_no,department,equipment_type,asset_snapshot", { count: "exact" }, filters
    ).range(page * pageSize, (page + 1) * pageSize - 1);
    if (request !== historyRequest) return;
    if (error) {
      get("calCount").textContent = "โหลดรายการไม่สำเร็จ";
      throw error;
    }
    count = total ?? 0;
    historyRows = data;
    get("calCount").textContent = count ? "หน้า " + (page + 1) + " · " + count + " รายการ" : "ไม่พบรายการสอบเทียบ";
    get("calList").replaceChildren(...data.map(row => {
      const tr = document.createElement("tr");
      for (const value of [dateLabel(row.calibrated_on), row.certificate_no, row.department,
        row.equipment_type, assetLabel(row.asset_snapshot)]) tr.insertCell().textContent = value;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "PDF / พิมพ์";
      button.dataset.report = row.id;
      tr.insertCell().append(button);
      return tr;
    }));
    get("calPrev").disabled = page === 0;
    get("calNext").disabled = (page + 1) * pageSize >= count;
    get("calPrintFiltered").disabled = !count;
  }

  function showView(view) {
    const views = { picker: "calPicker", register: "calRegister", queue: "calQueue", form: "calForm", history: "calHistory" };
    for (const [key, id] of Object.entries(views)) get(id).hidden = key !== view;
    get("calNewTab").setAttribute("aria-pressed", String(view === "picker" || view === "register"));
    get("calQueueTab").setAttribute("aria-pressed", String(view === "queue" || view === "form"));
    get("calHistoryTab").setAttribute("aria-pressed", String(view === "history"));
  }

  function populateCalibrationTypes() {
    const groups = Object.groupBy(additionalCalibrationTypes.filter(type => !type.legacy), type => type.group);
    for (const [name, types] of Object.entries(groups)) {
      const section = document.createElement("section");
      section.className = "cal-type-group";
      section.innerHTML = '<h2>' + escapeValue(name) + '</h2><div class="cal-type-grid">' +
        types.map(type => '<button class="cal-type" type="button" data-cal-method="' + escapeValue(type.method) + '">' +
          '<span class="cal-type-icon" aria-hidden="true">◎</span><span><strong>' + escapeValue(type.label) +
          '</strong><small>' + escapeValue(type.name) +
          '</small></span><span class="cal-type-arrow" aria-hidden="true">→</span></button>').join("") + '</div>';
      get("calExtraTypes").append(section);
    }
    for (const name of cal1CatalogueOnly) {
      const entry = document.createElement("li");
      entry.textContent = name;
      get("calCatalogueNames").append(entry);
    }
    get("calCatalogueCount").textContent = "(" + cal1CatalogueOnly.length + ")";
  }

  function openPicker() {
    showView("picker");
    notify("เลือกประเภทเครื่องมือเพื่อเริ่มลงทะเบียน");
    get("calPickerTitle").focus();
  }

  function openForm(tool) {
    if (tool.id !== activeTool?.id) {
      if (activeTool) {
        metadataDrafts.set(activeTool.id, {
          fields: draftFields.map(id => get(id).value),
          measurements: structuredClone(rowsByDevice.get(device.value))
        });
      }
      activeTool = tool;
      const draft = metadataDrafts.get(tool.id);
      const fields = draft?.fields ?? ["", today(), operatorName, "", "", "", ""];
      draftFields.forEach((id, index) => { get(id).value = fields[index]; });
      device.value = tool.method;
      rowsByDevice.set(tool.method, draft?.measurements ?? stateFor());
      render();
    }
    const summary = get("calToolSummary");
    summary.replaceChildren();
    for (const [label, value] of [
      ["ประเภท", typeNames[tool.method]], ["หน่วยงาน", tool.department], ["ID เครื่องมือ", tool.tool_code],
      ["เลขครุภัณฑ์", tool.inventory_no], ["ยี่ห้อ / รุ่น", [tool.manufacturer, tool.model].filter(Boolean).join(" ")],
      ["S/N", tool.serial_number]
    ]) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value || "—";
      const item = document.createElement("div");
      item.append(dt, dd);
      summary.append(item);
    }
    get("calFormTitle").textContent = tool.name;
    showView("form");
    notify("กรอกผลสอบเทียบสำหรับ ID " + tool.tool_code);
    get("calFormTitle").focus();
  }

  async function openHistory() {
    showView("history");
    await refreshFilters();
    await applyFilters();
  }

  async function applyFilters() {
    filters = {
      department: get("calFilterDepartment").value,
      equipmentType: get("calFilterType").value,
      search: get("calHistorySearch").value.trim()
    };
    page = 0;
    await loadHistory();
  }

  function collectMeasurements() {
    return rowsByDevice.get(device.value).map((sheet, i) => {
      const { title } = devices[device.value][i];
      const unit = sheet.unit.trim();
      const rows = sheet.rows.filter(row => row.some(value => value !== "")).map(row => row.map(numeric));
      const budget = sheet.budget.map(numeric);
      if (rows.length > 100) throw new Error(title + " · เพิ่มได้ไม่เกิน 100 จุดต่อพารามิเตอร์");
      if (!unit || !rows.length || !budget.every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error(title + " · กรุณาระบุหน่วย จุดทดสอบ และ UCB ให้ครบ");
      }
      for (const row of rows) {
        const [point, nominal, s1, m1, s2, m2, s3, m3] = row;
        if (![point, nominal, m1, m2, m3].every(Number.isFinite)
          || (calibrationErrorRule(device.value) === "mean-std" && ![s1, s2, s3].every(Number.isFinite))
          || (![s1, s2, s3].every(value => value === null) && ![s1, s2, s3].every(Number.isFinite))) {
          throw new Error(title + " · กรอกจุดทดสอบ ค่า STD และค่าเครื่องให้ครบ 3 รอบ ช่องมาตรฐานให้กรอกครบหรือเว้นทั้ง 3 ช่องเมื่อใช้ STD");
        }
      }
      return { unit, rows, budget };
    });
  }

  async function save() {
    const certificateNo = get("calCertificate").value.trim();
    const operator = get("calOperator").value.trim();
    if (!activeTool || !certificateNo || !operator) throw new Error("กรุณาระบุเครื่องมือ เลขที่ใบรับรอง และผู้ปฏิบัติการ");
    const input = {
      tool_id: activeTool.id,
      calibrated_on: get("calDate").value,
      certificate_no: certificateNo,
      operator_name: operator,
      standard_reference: get("calStandardReference").value.trim(),
      ambient_temperature: numeric(get("calAmbientTemperature").value),
      relative_humidity: numeric(get("calHumidity").value),
      notes: get("calNotes").value.trim(),
      measurements: collectMeasurements()
    };
    const fingerprint = JSON.stringify(input);
    if (pending?.fingerprint !== fingerprint) pending = { fingerprint, id: crypto.randomUUID() };
    const { error } = await supabase.from("mems_calibrations").insert({ id: pending.id, ...input });
    if (error) {
      if (error.code !== "23505") throw error;
      const { data, error: lookupError } = await supabase.from("mems_calibrations")
        .select("id").eq("id", pending.id).maybeSingle();
      if (lookupError || !data) throw error;
    }
    pending = null;
    metadataDrafts.delete(activeTool.id);
    activeTool = null;
    clearCalibrationMeasurements();
    get("calFilterDepartment").value = "";
    get("calFilterType").value = "";
    get("calHistorySearch").value = "";
    notify("บันทึกผลสอบเทียบแล้ว");
    try {
      await openHistory();
    } catch (historyError) {
      notify("บันทึกผลสอบเทียบแล้ว · โหลดประวัติไม่สำเร็จ: " + historyError.message);
    }
  }

  async function buildPdf(records) {
    const doc = await newThaiPdf({ orientation: "landscape" });
    records.forEach((record, index) => {
      if (index) doc.addPage();
      const snapshot = record.asset_snapshot;
      doc.setFont(PDF_FONT, "normal");
      if (doc.__memsLogoDataUrl) doc.addImage(doc.__memsLogoDataUrl, "PNG", 38, 26, 34, 34);
      doc.setFontSize(22).text("รายงานผลสอบเทียบเครื่องมือ", 82, 40);
      doc.setFontSize(15).text(HOSPITAL_NAME, 82, 59);
      const metadata = [
        ["เลขที่ใบรับรอง", record.certificate_no, "วันที่สอบเทียบ", dateLabel(record.calibrated_on)],
        ["หน่วยงาน", record.department, "วิธีสอบเทียบ", typeNames[record.method]],
        ["เครื่องมือ", assetLabel(snapshot), "สูตร", record.formula_version],
        ["ผู้ปฏิบัติการ", record.operator_name || "—", "เครื่องมาตรฐาน", record.standard_reference || "—"],
        ["อุณหภูมิ (°C)", display(record.ambient_temperature), "ความชื้น (%)", display(record.relative_humidity)],
        ["หมายเหตุ", record.notes || "—", "", ""]
      ];
      doc.autoTable({ startY: 72, body: metadata, theme: "plain",
        styles: { font: PDF_FONT, fontSize: 13, overflow: "linebreak" } });
      const digital = record.method === "digital-bp";
      const columns = digital
        ? ["จุด", "STD", "เครื่อง 1", "เครื่อง 2", "เครื่อง 3", "Standard", "Mean", "Error", "SD", "UCA", "U (k=2)"]
        : reportColumns;
      record.measurements.forEach((sheet, sheetIndex) => {
        const title = devices[record.method][sheetIndex].title + " (" + sheet.unit + ")";
        const rows = sheet.rows.map(row => {
          const [, nominal, s1, m1, s2, m2, s3, m3] = row;
          const result = calculatePoint({ nominal, standardReadings: [s1, s2, s3],
            measuredReadings: [m1, m2, m3], budget: sheet.budget, errorRule: calibrationErrorRule(record.method) });
          return (digital ? [row[0], nominal, m1, m2, m3] : row)
            .concat(outputs.map(key => result[key])).map(display);
        });
        doc.autoTable({
          startY: doc.lastAutoTable.finalY + 12,
          head: [[{ content: title, colSpan: columns.length }], columns],
          body: rows,
          foot: [[{ content: sheet.budget.map((value, i) => "UCB" + (i + 1) + " = " + display(value)).join("   ·   "),
            colSpan: columns.length }]],
          showFoot: "lastPage",
          rowPageBreak: "avoid",
          styles: { font: PDF_FONT, fontSize: 12, halign: "right", cellPadding: 4 },
          headStyles: { font: PDF_FONT, fontStyle: "normal", fillColor: PDF_THEME.brand },
          footStyles: { font: PDF_FONT, fontStyle: "normal", fillColor: PDF_THEME.soft, textColor: PDF_THEME.text }
        });
      });
    });
    rptPdfFooter(doc);
    return doc;
  }

  async function showPdf(records) {
    if (!records.length) throw new Error("ไม่พบรายงานตามตัวกรอง");
    const doc = await buildPdf(records);
    const filename = records.length === 1 ? "calibration-" + records[0].certificate_no.replace(/[^a-z0-9_-]/gi, "_") : "calibration-filtered";
    rptDeliverPdf(doc, filename + ".pdf", { preview: true });
    notify("สร้าง PDF แล้ว · เลือกพิมพ์หรือดาวน์โหลดจากหน้าตัวอย่าง");
  }

  function guarded(action, button) {
    return async event => {
      event?.preventDefault();
      if (button?.disabled) return;
      if (button) button.disabled = true;
      try {
        await action(event);
      } catch (error) {
        notify(error.message || "ดำเนินการไม่สำเร็จ");
      } finally {
        if (button) button.disabled = false;
      }
    };
  }

  get("calRegister").addEventListener("submit", guarded(async () => {
    get("calRegister").inert = true;
    try { await registerTool(); } finally { get("calRegister").inert = false; }
  }, get("calRegisterSave")));
  get("calRegisterBack").addEventListener("click", openPicker);
  get("calQueueTab").addEventListener("click", guarded(openQueue));
  get("calQueueFilters").addEventListener("submit", event => event.preventDefault());
  get("calQueueFilters").addEventListener("input", () => { queuePage = 0; renderQueue(); });
  get("calQueuePrev").addEventListener("click", () => { queuePage--; renderQueue(); });
  get("calQueueNext").addEventListener("click", () => { queuePage++; renderQueue(); });
  get("calQueueList").addEventListener("click", event => {
    const button = event.target.closest("[data-tool-id]");
    const tool = button && tools.find(item => item.id === button.dataset.toolId);
    if (tool) openForm(tool);
  });
  get("calForm").addEventListener("submit", guarded(async () => {
    get("calForm").inert = true;
    try {
      await save();
    } finally {
      get("calForm").inert = false;
    }
  }, get("calSave")));
  get("calNewTab").addEventListener("click", openPicker);
  get("calBack").addEventListener("click", guarded(openQueue));
  get("calHistoryTab").addEventListener("click", guarded(openHistory));
  get("calPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-cal-method]");
    if (button) openRegistration(button.dataset.calMethod);
  });
  get("calFilters").addEventListener("submit", guarded(applyFilters));
  get("calPrev").addEventListener("click", guarded(() => { page--; return loadHistory(); }));
  get("calNext").addEventListener("click", guarded(() => { page++; return loadHistory(); }));
  get("calList").addEventListener("click", guarded(async event => {
    const button = event.target.closest("[data-report]");
    if (!button || !historyRows.some(row => row.id === button.dataset.report)) return;
    const { data, error } = await supabase.from("mems_calibrations").select("*").eq("id", button.dataset.report).single();
    if (error) throw error;
    await showPdf([data]);
  }));
  get("calPrintFiltered").addEventListener("click", guarded(async () => {
    const criteria = { ...filters };
    if (count > 200) throw new Error("กรุณาเลือกหน่วยงานหรือประเภทให้เหลือไม่เกิน 200 รายการต่อไฟล์ PDF");
    const { data, error } = await historyQuery("*", {}, criteria).limit(201);
    if (error) throw error;
    if (data.length > 200) throw new Error("กรุณากรองให้เหลือไม่เกิน 200 รายการต่อไฟล์ PDF");
    await showPdf(data);
  }));

  guarded(async () => {
    const profile = await memsGuard("calibration");
    if (!profile) return;
    operatorName = profile.display_name || "";
    const savedDepartments = await fetchPreparationWards().catch(() => []);
    departments = [...new Set(["ศูนย์เครื่องมือแพทย์", ...MEMS_WARDS, ...savedDepartments])]
      .sort((left, right) => left.localeCompare(right, "th"));
    setOptions(get("calRegisterDepartment"), departments.map(name => [name, name]), "เลือกหน่วยงาน");
    setOptions(get("calQueueType"), Object.entries(typeNames), "ทุกประเภท");
    populateCalibrationTypes();
    get("calWorkspace").hidden = false;
    notify("เลือกประเภทเครื่องมือเพื่อเริ่มลงทะเบียน");
  })();
})();
