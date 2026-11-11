"use strict";

(() => {
  const get = id => document.getElementById(id);
  const pageSize = 30;
  const typeNames = Object.fromEntries([...device.options].map(option => [option.value, option.text]));

  const draftFields = ["calCertificate", "calDate", "calOperator", "calStandardReference", "calAmbientTemperature", "calHumidity", "calNotes"];
  const metadataDrafts = new Map();
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bangkok" }).format(new Date());
  let tools = [];
  let departments = [];
  let queuePage = 0;
  let queueRequest = 0;
  let registerMethod;
  let activeTool;
  let editingRecordId = null;
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

  const signatureBlue = "#1554a3";

  function recolorSignature(dataUrl) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        context.globalCompositeOperation = "source-in";
        context.fillStyle = signatureBlue;
        context.fillRect(0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  function createSignaturePad(id) {
    const canvas = get(id);
    const context = canvas.getContext("2d");
    let drawing = false;
    let hasInk = false;
    context.strokeStyle = signatureBlue;
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    const point = event => {
      const bounds = canvas.getBoundingClientRect();
      return { x: (event.clientX - bounds.left) * canvas.width / bounds.width,
        y: (event.clientY - bounds.top) * canvas.height / bounds.height };
    };
    canvas.addEventListener("pointerdown", event => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const p = point(event);
      context.beginPath();
      context.moveTo(p.x, p.y);
      drawing = true;
      hasInk = true;
    });
    canvas.addEventListener("pointermove", event => {
      if (!drawing) return;
      event.preventDefault();
      const p = point(event);
      context.lineTo(p.x, p.y);
      context.stroke();
    });
    const endStroke = () => { drawing = false; };
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    return {
      hasInk: () => hasInk,
      dataUrl: () => hasInk ? canvas.toDataURL("image/png") : "",
      clear: () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false;
        drawing = false;
      },
      load: dataUrl => new Promise(resolve => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false;
        if (!dataUrl) return resolve();
        const image = new Image();
        image.onload = () => {
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          context.globalCompositeOperation = "source-in";
          context.fillStyle = signatureBlue;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.globalCompositeOperation = "source-over";
          hasInk = true;
          resolve();
        };
        image.onerror = resolve;
        image.src = dataUrl;
      })
    };
  }

  const signaturePads = {
    tested: createSignaturePad("calTestSignerPad"),
    approved: createSignaturePad("calApproveSignerPad")
  };
  const signerFields = {
    tested: { name: "calTestSignerName", position: "calTestSignerPosition", title: "ผู้ทดสอบ" },
    approved: { name: "calApproveSignerName", position: "calApproveSignerPosition", title: "ผู้อนุมัติ" }
  };
  let calibrationSignatories = { tested: null, approved: null };

  async function loadCalibrationSignatories() {
    const { data, error } = await supabase.from("mems_calibration_signatories")
      .select("role,name,position,signature_data_url");
    if (error) throw error;
    calibrationSignatories = { tested: null, approved: null };
    for (const signer of data || []) calibrationSignatories[signer.role] = signer;
    return calibrationSignatories;
  }

  async function openCalibrationSignerSettings() {
    get("calSignerStatus").textContent = "กำลังโหลดค่าผู้ลงนาม…";
    get("calSignerSettings").disabled = true;
    try {
      const signers = await loadCalibrationSignatories();
      for (const role of ["tested", "approved"]) {
        const signer = signers[role];
        get(signerFields[role].name).value = signer?.name || "";
        get(signerFields[role].position).value = signer?.position || "";
        await signaturePads[role].load(signer?.signature_data_url || "");
      }
      get("calSignerStatus").textContent = "ลายเซ็นจะปรากฏใน PDF ทุกครั้งที่เปิดรายงานสอบเทียบ";
      get("calSignerDialog").showModal();
    } finally {
      get("calSignerSettings").disabled = false;
    }
  }

  async function saveCalibrationSignatories() {
    const rows = ["tested", "approved"].map(role => {
      const fields = signerFields[role];
      const name = get(fields.name).value.trim();
      const position = get(fields.position).value.trim();
      if (!name || !position || !signaturePads[role].hasInk()) {
        throw new Error("กรุณากรอกชื่อ ตำแหน่ง และวาดลายเซ็นของ" + fields.title + "ให้ครบ");
      }
      return { role, name, position, signature_data_url: signaturePads[role].dataUrl(), updated_at: new Date().toISOString() };
    });
    const { error } = await supabase.from("mems_calibration_signatories").upsert(rows, { onConflict: "role" });
    if (error) throw error;
    await loadCalibrationSignatories();
    get("calSignerDialog").close();
    notify("บันทึกชื่อและลายเซ็นผู้ทดสอบ/ผู้อนุมัติแล้ว · PDF ครั้งต่อไปจะใส่ให้อัตโนมัติ");
  }

  async function loadCalibrationOperators() {
    const { data, error } = await supabase.from("mems_report_operators")
      .select("name,position").order("name").order("position");
    if (error) throw error;
    const list = get("calOperatorOptions");
    list.replaceChildren(...data.map(person => {
      const option = document.createElement("option");
      option.value = person.name;
      option.label = person.position;
      return option;
    }));
    get("calOperatorHint").textContent = data.length
      ? "รายชื่อจาก PM · " + data.length + " รายชื่อ · เลือกจากรายการหรือพิมพ์ชื่อได้"
      : "ยังไม่มีรายชื่อใน PM · พิมพ์ชื่อผู้ปฏิบัติการได้";
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

  async function loadDashboardMetrics() {
    const monthStart = today().slice(0, 7) + "-01";
    const [year, month] = monthStart.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const monthLabel = new Intl.DateTimeFormat("th-TH", {
      month: "long", year: "numeric", timeZone: "UTC"
    }).format(new Date(monthStart + "T00:00:00Z"));
    get("calMetricMonthLabel").textContent = "ข้อมูลเดือน " + monthLabel;

    const results = await Promise.allSettled([
      supabase.from("mems_calibration_tools").select("id", { count: "exact", head: true }),
      supabase.from("mems_calibrations").select("id", { count: "exact", head: true }),
      supabase.from("mems_calibrations").select("id", { count: "exact", head: true })
        .gte("calibrated_on", monthStart).lt("calibrated_on", nextMonth)
    ]);
    const metricIds = ["calMetricTools", "calMetricRecords", "calMetricMonth"];
    const labels = ["จำนวนเครื่องในทะเบียน", "จำนวนประวัติใบรับรอง", "จำนวนผลสอบเทียบเดือนนี้"];
    results.forEach((result, index) => {
      const value = get(metricIds[index]);
      const failed = result.status !== "fulfilled" || result.value.error;
      value.textContent = failed ? "—" : new Intl.NumberFormat("th-TH").format(result.value.count || 0);
      value.setAttribute("aria-label", failed ? labels[index] + " โหลดไม่สำเร็จ" : labels[index] + " " + (result.value.count || 0));
      if (failed) value.closest(".cal-dashboard-stat").classList.add("is-unavailable");
    });
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
      const actions = document.createElement("div");
      actions.className = "cal-history-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "รายละเอียด / แก้ไข";
      editButton.dataset.edit = row.id;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "PDF / พิมพ์";
      button.dataset.report = row.id;
      actions.append(editButton, button);
      tr.insertCell().append(actions);
      return tr;
    }));
    get("calPrev").disabled = page === 0;
    get("calNext").disabled = (page + 1) * pageSize >= count;
    get("calPrintFiltered").disabled = !count;
  }

  async function editHistoryRecord(id) {
    const { data: record, error: recordError } = await supabase.from("mems_calibrations")
      .select("*").eq("id", id).single();
    if (recordError) throw recordError;
    const { data: tool, error: toolError } = await supabase.from("mems_calibration_tools")
      .select("*").eq("id", record.tool_id).single();
    if (toolError) throw toolError;
    await openForm(tool, record);
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

  async function reserveCertificate(date) {
    const { data, error } = await supabase.rpc("mems_next_calibration_certificate", {
      p_calibration_date: date || today()
    });
    if (error) throw error;
    if (typeof data !== "string" || !data.startsWith("CA-5-")) {
      throw new Error("ระบบออกเลขใบรับรองไม่สำเร็จ กรุณาลองเปิดแบบบันทึกอีกครั้ง");
    }
    get("calCertificate").value = data;
    return data;
  }

  async function ensureCertificateForDate() {
    const date = get("calDate").value;
    if (!date) return;
    const expectedYear = String(Number(date.slice(0, 4)) + 543).slice(-2);
    const currentYear = get("calCertificate").value.match(/^CA-5-(\d{2})-/)?.[1];
    if (currentYear !== expectedYear) await reserveCertificate(date);
  }

  async function openForm(tool, record = null) {
    let draft;
    let newToolForm = false;
    if (tool.id !== activeTool?.id || record) {
      newToolForm = true;
      if (activeTool) {
        metadataDrafts.set(activeTool.id, {
          fields: draftFields.map(id => get(id).value),
          measurements: structuredClone(rowsByDevice.get(device.value))
        });
      }
      activeTool = tool;
      draft = record ? {
        fields: [record.certificate_no, record.calibrated_on, record.operator_name,
          record.standard_reference, record.ambient_temperature ?? "", record.relative_humidity ?? "", record.notes || ""],
        measurements: record.measurements
      } : metadataDrafts.get(tool.id);
      const fields = draft?.fields ?? ["", today(), operatorName, "", "", "", ""];
      draftFields.forEach((id, index) => { get(id).value = fields[index]; });
      device.value = tool.method;
      rowsByDevice.set(tool.method, draft?.measurements ? structuredClone(draft.measurements) : stateFor());
      render();
    }
    editingRecordId = record?.id || null;
    get("calCertificate").readOnly = !record;
    get("calSave").textContent = record ? "บันทึกการแก้ไข" : "บันทึกผลสอบเทียบ";
    get("calBack").textContent = record ? "← กลับไปประวัติ" : "← กลับไปคิวสอบเทียบ";
    const { data: standard, error: standardError } = await supabase.from("mems_calibration_standards")
      .select("standard_reference,source_note").eq("method", tool.method).maybeSingle();
    if (standardError) throw standardError;
    if (newToolForm && !draft && standard) get("calStandardReference").value = standard.standard_reference;
    get("calStandardHint").textContent = standard?.source_note
      || "ไม่พบประวัติของประเภทนี้ใน Access จึงเว้นไว้ให้ระบุเครื่องมาตรฐานที่ใช้จริง";
    if (!record) await ensureCertificateForDate();
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
    get("calFormTitle").textContent = record ? "รายละเอียด / แก้ไข · " + tool.name : tool.name;
    showView("form");
    notify((record ? "แก้ไขผลสอบเทียบ" : "กรอกผลสอบเทียบ") + "สำหรับ ID " + tool.tool_code);
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
    const wasEditing = Boolean(editingRecordId);
    const recordId = editingRecordId;
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
    if (wasEditing) {
      const { tool_id, ...updates } = input;
      const { data, error } = await supabase.from("mems_calibrations").update(updates)
        .eq("id", recordId).select("id").maybeSingle();
      if (error?.code === "23505") throw new Error("เลขที่ใบรับรองนี้ถูกใช้แล้ว");
      if (error) throw error;
      if (!data) throw new Error("ไม่พบรายการเดิม หรือไม่มีสิทธิ์แก้ไขรายการนี้");
    } else {
      const fingerprint = JSON.stringify(input);
      if (pending?.fingerprint !== fingerprint) pending = { fingerprint, id: crypto.randomUUID() };
      const { error } = await supabase.from("mems_calibrations").insert({ id: pending.id, ...input });
      if (error) {
        if (error.code !== "23505") throw error;
        const { data, error: lookupError } = await supabase.from("mems_calibrations")
          .select("id").eq("id", pending.id).maybeSingle();
        if (lookupError || !data) throw error;
      }
    }
    pending = null;
    metadataDrafts.delete(activeTool.id);
    editingRecordId = null;
    activeTool = null;
    clearCalibrationMeasurements();
    get("calCertificate").readOnly = true;
    get("calSave").textContent = "บันทึกผลสอบเทียบ";
    get("calBack").textContent = "← กลับไปคิวสอบเทียบ";
    if (!wasEditing) {
      get("calFilterDepartment").value = "";
      get("calFilterType").value = "";
      get("calHistorySearch").value = "";
    }
    notify(wasEditing ? "แก้ไขรายการสอบเทียบแล้ว" : "บันทึกผลสอบเทียบแล้ว");
    try {
      await openHistory();
    } catch (historyError) {
      notify((wasEditing ? "แก้ไขรายการแล้ว" : "บันทึกผลสอบเทียบแล้ว") + " · โหลดประวัติไม่สำเร็จ: " + historyError.message);
    }
  }

  async function buildPdf(records) {
    const doc = await newThaiPdf({ orientation: "portrait" });
    const signatories = await loadCalibrationSignatories();
    for (const signer of Object.values(signatories)) {
      if (signer?.signature_data_url?.startsWith("data:image/png;base64,")) {
        signer.signature_data_url = await recolorSignature(signer.signature_data_url);
      }
    }
    const hospitalLogoResponse = await fetch("hospital-seal.png");
    if (!hospitalLogoResponse.ok) throw new Error("โหลดตราโรงพยาบาลสำหรับใบรับรองไม่ได้");
    const hospitalLogoBytes = new Uint8Array(await hospitalLogoResponse.arrayBuffer());
    let hospitalLogoBinary = "";
    for (let i = 0; i < hospitalLogoBytes.length; i += 0x8000) {
      hospitalLogoBinary += String.fromCharCode.apply(null, hospitalLogoBytes.subarray(i, i + 0x8000));
    }
    const hospitalLogoDataUrl = "data:image/png;base64," + btoa(hospitalLogoBinary);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const sealProperties = doc.getImageProperties(hospitalLogoDataUrl);
    const sealScale = Math.min(60 / sealProperties.width, 52 / sealProperties.height);
    const sealWidth = sealProperties.width * sealScale;
    const sealHeight = sealProperties.height * sealScale;
    const headerPages = new Set();
    const left = 46;
    const right = pageW - 46;
    const text = (value, x, y, size = 11, options) => {
      doc.setFont(PDF_FONT, "normal").setFontSize(size).setTextColor(35, 43, 50)
        .text(String(value ?? "—"), x, y, options || {});
    };
    const certificateNumber = (value, digits = 2) => Number.isFinite(value)
      ? (Math.abs(value) < 0.00005 ? 0 : value).toFixed(digits) : "—";
    const dateThai = value => {
      if (!value) return "—";
      const parsed = new Date(value + "T00:00:00Z");
      return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parsed);
    };
    const standardRows = reference => {
      const entries = String(reference || "").split(/\s+\/\s+/).filter(Boolean);
      return (entries.length ? entries : ["—"]).map(entry => {
        const fields = entry.split(" · ").map(value => value.trim()).filter(Boolean);
        let manufacturer = fields[0] || "—";
        let model = fields[1] || "—";
        let serial = fields.find(value => /^S\/N\s*/i.test(value))?.replace(/^S\/N\s*/i, "") || "—";
        let calDate = fields.find(value => /^(สอบเทียบ|Cal(?:ibration)?\s*date)/i.test(value))?.replace(/^(สอบเทียบ|Cal(?:ibration)?\s*date)\s*/i, "") || "—";
        let cert = fields.find(value => /^(รหัส|Cert(?:ificate)?\.?\s*No\.?)/i.test(value))?.replace(/^(รหัส|Cert(?:ificate)?\.?\s*No\.?)\s*/i, "") || "—";
        if (/^(S\/N|สอบเทียบ|Cal(?:ibration)?\s*date|รหัส|Cert)/i.test(model)) { manufacturer = fields[0] || "—"; model = "—"; }
        return [manufacturer, model, serial, calDate, cert];
      });
    };
    const drawHeader = record => {
      const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
      if (headerPages.has(pageNumber)) return;
      headerPages.add(pageNumber);
      doc.setDrawColor(45, 55, 60).setLineWidth(1.1);
      doc.addImage(hospitalLogoDataUrl, "PNG", left + (60 - sealWidth) / 2,
        24 + (52 - sealHeight) / 2, sealWidth, sealHeight);
      text("Phaholpolpayuhasena Hospital", left + 64, 45, 17);
      text("Medical Device Center", left + 64, 65, 15);
      doc.line(left, 88, right, 88);
      text("Certificate of Testing", pageW / 2, 119, 19, { align: "center" });
      text("Cert. No. :  " + (record.certificate_no || "—"), right, 103, 13, { align: "right" });
    };
    const drawDetails = record => {
      const snapshot = record.asset_snapshot || {};
      const colLeft = left + 2;
      const split = pageW / 2 + 3;
      const rightText = split + 14;
      doc.setDrawColor(130, 140, 145).setLineWidth(.5);
      doc.line(split, 132, split, 263);
      const labelValue = (label, value, x, y, width = 220) => {
        text(label + " :", x, y, 11);
        const lines = doc.splitTextToSize(String(value || "—"), width - 62);
        text(lines, x + 62, y, 11);
      };
      labelValue("Detail", snapshot.name || typeNames[record.method], colLeft, 145, 238);
      labelValue("Manufacture", snapshot.manufacturer, colLeft, 169, 238);
      labelValue("Model", snapshot.model, colLeft, 193, 238);
      labelValue("Serial No.", snapshot.serial_number, colLeft, 217, 238);
      labelValue("ID No.", snapshot.tool_code, colLeft, 241, 238);
      labelValue("Departments", HOSPITAL_NAME.replace(" จ.กาญจนบุรี", ""), rightText, 145, right - rightText);
      labelValue("Address", "จังหวัดกาญจนบุรี", rightText, 169, right - rightText);
      labelValue("Section", record.department, rightText, 193, right - rightText);
      labelValue("Temperature", display(record.ambient_temperature) + " ± 2 °C", rightText, 217, 150);
      labelValue("Humidity", display(record.relative_humidity) + " ±5% R.H.", rightText + 155, 217, right - (rightText + 155));
      labelValue("Tested Date", dateThai(record.calibrated_on), colLeft, 265, 238);
      labelValue("Appr. Date", dateThai(record.calibrated_on), rightText, 265, right - rightText);
      doc.setDrawColor(45, 55, 60).setLineWidth(.8).line(left + 45, 278, right - 45, 278);
    };
    const drawCertificatePage = record => {
      drawHeader(record);
      drawDetails(record);
    };
    records.forEach((record, recordIndex) => {
      if (recordIndex) doc.addPage();
      drawCertificatePage(record);
      let finalY = 289;
      (record.measurements || []).forEach((sheet, sheetIndex) => {
        const sheetTitle = devices[record.method]?.[sheetIndex]?.title || typeNames[record.method] || "ผลทดสอบ";
        const rows = (sheet.rows || []).map(row => {
          const [, nominal, s1, m1, s2, m2, s3, m3] = row;
          const result = calculatePoint({ nominal, standardReadings: [s1, s2, s3],
            measuredReadings: [m1, m2, m3], budget: sheet.budget || [], errorRule: calibrationErrorRule(record.method) });
          const limit = calibrationAcceptanceLimit(record.method, sheetIndex, nominal);
          return [certificateNumber(nominal), certificateNumber(result.mean), certificateNumber(result.error, 3),
            limit === null ? "—" : "± " + certificateNumber(limit, 3)];
        });
        doc.autoTable({
          startY: finalY,
          margin: { left: left + 42, right: left + 42, top: 290, bottom: 55 },
          head: [[{ content: sheetTitle + "  (" + sheet.unit + ")", colSpan: 4 }],
            ["UUT Setting\n(" + sheet.unit + ")", "STD Reading\n(" + sheet.unit + ")", "Error\n(" + sheet.unit + ")", "Accept value\n(" + sheet.unit + ")"]],
          body: rows,
          theme: "grid",
          styles: { font: PDF_FONT, fontSize: 10.5, halign: "center", cellPadding: 4, lineColor: [90, 100, 105], lineWidth: .35 },
          headStyles: { font: PDF_FONT, fontStyle: "normal", fillColor: [255, 255, 255], textColor: [35, 43, 50], lineColor: [60, 70, 75] },
          columnStyles: { 0: { cellWidth: 98 }, 1: { cellWidth: 98 }, 2: { cellWidth: 85 }, 3: { cellWidth: 118 } },
          rowPageBreak: "avoid",
          didDrawPage: () => drawCertificatePage(record)
        });
        finalY = doc.lastAutoTable.finalY + 12;
      });
      if (finalY > 525) {
        doc.addPage();
        drawCertificatePage(record);
        finalY = 135;
      }
      text("Standard Used", left + 43, finalY + 17, 12);
      const references = standardRows(record.standard_reference);
      doc.autoTable({
        startY: finalY + 24,
        margin: { left: left + 43, right: left + 43, bottom: 145 },
        head: [["Manufacture", "Model", "S/N", "Cal date", "Cert No."]],
        body: references,
        theme: "grid",
        styles: { font: PDF_FONT, fontSize: 10, halign: "center", cellPadding: 4, lineColor: [110, 120, 125], lineWidth: .35 },
        headStyles: { font: PDF_FONT, fontStyle: "normal", fillColor: [255, 255, 255], textColor: [35, 43, 50] },
        didDrawPage: () => drawCertificatePage(record)
      });
      finalY = doc.lastAutoTable.finalY + 16;
      if (finalY > pageH - 175) {
        doc.addPage();
        drawCertificatePage(record);
        finalY = 135;
      }
      text("วิธีทดสอบ : โดยการนำเครื่องมือที่ต้องการสอบเทียบต่อเข้ากับเครื่องมาตรฐาน แล้วควบคุมค่าตามจุดทดสอบ อ่านค่าแล้วบันทึกค่า", left + 43, finalY + 2, 10);
      const signY = pageH - 120;
      const drawSigner = (label, signer, fallbackName, x, width) => {
        const centerX = x + width / 2;
        text(label + " : ................................................", centerX, signY, 11, { align: "center", maxWidth: width });
        if (signer?.signature_data_url?.startsWith("data:image/png;base64,")) {
          doc.addImage(signer.signature_data_url, "PNG", centerX - 46, signY - 38, 92, 26);
        }
        text(signer?.name || fallbackName || "", centerX, signY + 30, 11, { align: "center", maxWidth: width });
        text(signer?.position || "นายช่างเทคนิค (เครื่องมือแพทย์)", centerX, signY + 52, 10, { align: "center", maxWidth: width });
      };
      const signerWidth = (right - left) / 2;
      const leftSignX = left;
      const rightSignX = left + signerWidth;
      drawSigner("Tested by", signatories.tested, record.operator_name, leftSignX, signerWidth);
      drawSigner("Approved by", signatories.approved, "", rightSignX, signerWidth);
      text("Comment : This report certifies the test results as of the date, location and the conditions of testing only.", left, pageH - 48, 8.5);
      doc.setDrawColor(70, 80, 85).setLineWidth(.45).line(left, pageH - 37, right, pageH - 37);
      text("โรงพยาบาลพหลพลพยุหเสนา  572 ถ.แสงชูโต  ต.ปากแพรก  อ.เมืองกาญจนบุรี 71000 โทร 034-587800",
        left, pageH - 22, 8.2, { maxWidth: right - left - 43 });
      if (doc.__memsLogoDataUrl) {
        doc.addImage(doc.__memsLogoDataUrl, "PNG", right - 40, pageH - 34, 16, 16);
        text("MEMs", right - 21, pageH - 22, 8.5, { align: "right" });
      }
    });
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      text("Page " + i + " of " + totalPages, right, 37, 9, { align: "right" });
    }
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
  get("calQueueList").addEventListener("click", guarded(async event => {
    const button = event.target.closest("[data-tool-id]");
    const tool = button && tools.find(item => item.id === button.dataset.toolId);
    if (tool) await openForm(tool);
  }));
  get("calDate").addEventListener("change", guarded(async () => {
    if (!editingRecordId) await ensureCertificateForDate();
  }));
  get("calForm").addEventListener("submit", guarded(async () => {
    get("calForm").inert = true;
    try {
      await save();
    } finally {
      get("calForm").inert = false;
    }
  }, get("calSave")));
  get("calNewTab").addEventListener("click", openPicker);
  get("calPickerQueueButton").addEventListener("click", guarded(openQueue));
  get("calPickerHistoryButton").addEventListener("click", guarded(openHistory));
  get("calBack").addEventListener("click", guarded(async () => {
    if (editingRecordId) {
      editingRecordId = null;
      activeTool = null;
      clearCalibrationMeasurements();
      get("calCertificate").readOnly = true;
      get("calSave").textContent = "บันทึกผลสอบเทียบ";
      get("calBack").textContent = "← กลับไปคิวสอบเทียบ";
      await openHistory();
      return;
    }
    await openQueue();
  }));
  get("calHistoryTab").addEventListener("click", guarded(openHistory));
  get("calPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-cal-method]");
    if (button) openRegistration(button.dataset.calMethod);
  });
  get("calFilters").addEventListener("submit", guarded(applyFilters));
  get("calPrev").addEventListener("click", guarded(() => { page--; return loadHistory(); }));
  get("calNext").addEventListener("click", guarded(() => { page++; return loadHistory(); }));
  get("calList").addEventListener("click", guarded(async event => {
    const editButton = event.target.closest("[data-edit]");
    if (editButton && historyRows.some(row => row.id === editButton.dataset.edit)) {
      await editHistoryRecord(editButton.dataset.edit);
      return;
    }
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
  get("calSignerSettings").addEventListener("click", guarded(openCalibrationSignerSettings));
  get("calSignerClose").addEventListener("click", () => get("calSignerDialog").close());
  get("calTestSignerClear").addEventListener("click", () => signaturePads.tested.clear());
  get("calApproveSignerClear").addEventListener("click", () => signaturePads.approved.clear());
  get("calSignerForm").addEventListener("submit", guarded(saveCalibrationSignatories, get("calSignerSave")));

  guarded(async () => {
    const profile = await memsGuard("calibration");
    if (!profile) return;
    operatorName = profile.display_name || "";
    await loadCalibrationOperators().catch(error => {
      console.warn("โหลดรายชื่อผู้ปฏิบัติงานจาก PM ไม่สำเร็จ", error);
      get("calOperatorHint").textContent = "โหลดรายชื่อจาก PM ไม่สำเร็จ · ยังพิมพ์ชื่อเองได้";
    });
    const savedDepartments = await fetchPreparationWards().catch(() => []);
    departments = [...new Set(["ศูนย์เครื่องมือแพทย์", ...MEMS_WARDS, ...savedDepartments])]
      .sort((left, right) => left.localeCompare(right, "th"));
    setOptions(get("calRegisterDepartment"), departments.map(name => [name, name]), "เลือกหน่วยงาน");
    setOptions(get("calQueueType"), Object.entries(typeNames), "ทุกประเภท");
    populateCalibrationTypes();
    get("calWorkspace").hidden = false;
    notify("เลือกประเภทเครื่องมือเพื่อเริ่มลงทะเบียน");
    loadDashboardMetrics().catch(error => {
      console.warn("โหลดภาพรวมงานสอบเทียบไม่สำเร็จ", error);
      for (const id of ["calMetricTools", "calMetricRecords", "calMetricMonth"]) {
        get(id).textContent = "—";
        get(id).closest(".cal-dashboard-stat").classList.add("is-unavailable");
      }
    });
  })();
})();

