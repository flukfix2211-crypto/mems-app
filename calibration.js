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
  let registeredTools = [];
  let registeredPage = 0;
  let duplicateRequest = 0;
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
  const standardTable = "mems_calibration_standard_equipment";
  const nibpStandard = "Vital sign simulator · S/N 3240040 · รหัส MMP-0061-26";
  const workbookStandards = {
    "infusion:104450": "Infusion Analyzer · S/N 3749056 · รหัส MMP-0063-26",
    "nibp:137309": nibpStandard
  };
  const splitStandards = value => (value || "").split(/\s+\/\s+/).filter(Boolean);
  const standardDate = iso => iso ? iso.split("-").reverse().join("/") : "";
  const standardReference = item => [item.manufacturer, item.model, item.serial_number && "S/N " + item.serial_number,
    item.calibrated_on && "สอบเทียบ " + standardDate(item.calibrated_on),
    item.certificate_no && "รหัส " + item.certificate_no,
    item.due_on && "ครบกำหนด " + standardDate(item.due_on)].filter(Boolean).join(" · ");

  function accessStandards(method) {
    const type = {
      general: "general thermometer", refrig: "refrig.thermometer",
      "manual-bp": "blood pressure", "blood-pressure": "blood pressure",
      defibrillator: "defibrillator", tourniquet: "tourniquct"
    }[method] || (method.startsWith("x-ray") ? "x-ray" : typeNames[method]?.toLowerCase());
    return calibrationAccessStandards[type] || [];
  }

  function historicalStandard(method, value) {
    if (method === "general") return "Alpha Technics · 4600 · S/N 15GA10793 · สอบเทียบ 04/09/2025 · รหัส 25I966";
    return ["infusion", "nibp", "digital-bp"].includes(method) ? "" : value;
  }

  async function loadStandardEquipment() {
    const { data, error } = await supabase.from(standardTable).select("*").order("source_reference");
    if (error && error.code !== "PGRST205" && error.code !== "42P01") throw error;
    return { rows: data || [], available: !error };
  }

  function standardFields(reference) {
    const [manufacturer, ...parts] = reference.split(" · ");
    const date = prefix => {
      const value = parts.find(part => part.startsWith(prefix))?.slice(prefix.length);
      return /^\d{2}\/\d{2}\/\d{4}$/.test(value || "") ? value.split("/").reverse().join("-") : "";
    };
    return { manufacturer,
      model: parts.find(part => !/^(S\/N |รหัส |สอบเทียบ |ครบกำหนด )/.test(part)) || "",
      serial_number: parts.find(part => part.startsWith("S/N "))?.slice(4) || "",
      certificate_no: parts.find(part => part.startsWith("รหัส "))?.slice(5) || "",
      calibrated_on: date("สอบเทียบ "), due_on: date("ครบกำหนด ") };
  }

  function standardKey(reference) {
    const { manufacturer, serial_number } = standardFields(reference);
    return serial_number && serial_number !== "-"
      ? manufacturer.toLowerCase() + "|" + serial_number.toLowerCase() : reference;
  }

  const standardEditor = get("calStandardForm");
  const standardDialog = get("calStandardDialog");
  const standardEdit = get("calStandardEdit");
  const standardStatus = get("calStandardStatus");
  const standardDelete = get("calStandardDelete");
  let canRemoveStandard = false;
  let standardCatalogue = new Map();

  function fillStandardEditor() {
    const item = standardCatalogue.get(standardEdit.value);
    standardDelete.disabled = !item || get("calStandardSave").disabled;
    for (const name of Object.keys(standardFields(""))) {
      standardEditor.elements.namedItem(name).value = item?.[name] || "";
    }
    for (const input of get("calStandardMethods").querySelectorAll("input")) {
      input.checked = item?.methods.includes(input.value) || false;
    }
  }

  async function openStandardSettings() {
    const [{ rows, available }, { data, error }] = await Promise.all([
      loadStandardEquipment(), supabase.from("mems_calibration_standards").select("method,standard_reference")
    ]);
    if (error) throw error;
    const defaults = new Map(data.map(item => [item.method, item.standard_reference]));
    standardCatalogue = new Map();
    for (const method of Object.keys(typeNames)) {
      const references = [...splitStandards(historicalStandard(method, defaults.get(method))),
        ...accessStandards(method), ...Object.entries(workbookStandards)
          .filter(([key]) => key.startsWith(method + ":")).map(([, value]) => value)];
      for (const reference of references) {
        const key = standardKey(reference);
        if (!standardCatalogue.has(key)) {
          standardCatalogue.set(key, { ...standardFields(reference), source_reference: key, methods: [] });
        }
        const item = standardCatalogue.get(key);
        if (!item.methods.includes(method)) item.methods.push(method);
      }
    }
    for (const item of rows) {
      if (item.removed) standardCatalogue.delete(item.source_reference);
      else standardCatalogue.set(item.source_reference, item);
    }
    const choices = [...standardCatalogue].map(([key, item]) => [key, standardReference(item)]);
    choices.sort((a, b) => a[1].localeCompare(b[1], "th"));
    setOptions(standardEdit, choices, "เพิ่มเครื่องมาตรฐานใหม่");
    const labels = Object.entries(typeNames).map(([method, title]) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "methods";
      input.value = method;
      label.append(input, document.createTextNode(" " + title));
      return label;
    });
    get("calStandardMethods").replaceChildren(...labels);
    get("calStandardSave").disabled = !available;
    fillStandardEditor();
    standardStatus.textContent = available ? "" : "ต้องอัปเดตฐานข้อมูลก่อนจึงจะบันทึกการตั้งค่าได้";
    standardDialog.showModal();
  }

  get("calStandardSettings").addEventListener("click", guarded(openStandardSettings, get("calStandardSettings")));
  get("calStandardClose").addEventListener("click", () => standardDialog.close());
  standardEdit.addEventListener("change", fillStandardEditor);
  standardDelete.addEventListener("click", async () => {
    const item = standardCatalogue.get(standardEdit.value);
    const save = get("calStandardSave");
    if (!canRemoveStandard || !item || save.disabled ||
      !confirm("ลบเครื่องมาตรฐาน " + standardReference(item) + " ออกจากรายการใช้งาน?")) return;
    standardDelete.disabled = standardEdit.disabled = save.disabled = true;
    try {
      const { error } = await supabase.from(standardTable).upsert({ ...item, removed: true },
        { onConflict: "source_reference" });
      if (error) throw error;
      standardCatalogue.delete(item.source_reference);
      standardEdit.selectedOptions[0].remove();
      standardEdit.value = "";
      fillStandardEditor();
      standardStatus.textContent = "ลบเครื่องมาตรฐานออกจากรายการแล้ว";
    } catch (error) {
      standardStatus.textContent = error.message || "ลบเครื่องมาตรฐานไม่สำเร็จ";
    } finally {
      standardEdit.disabled = save.disabled = false;
      standardDelete.disabled = !standardEdit.value;
    }
  });
  standardEditor.addEventListener("submit", async event => {
    event.preventDefault();
    const button = get("calStandardSave");
    if (button.disabled || !memsIsAdmin()) return;
    const data = new FormData(standardEditor);
    const item = Object.fromEntries(Object.keys(standardFields("")).map(key => [key, data.get(key).trim()]));
    if (!item.manufacturer || Object.values(item).some(value => /\s+\/\s+| · /.test(value))) {
      standardStatus.textContent = "กรุณาระบุชื่อเครื่อง และเว้นเครื่องหมายคั่น / หรือ · ในรายละเอียด";
      return;
    }
    item.calibrated_on ||= null;
    item.due_on ||= null;
    if (item.calibrated_on && item.due_on && item.due_on < item.calibrated_on) {
      standardStatus.textContent = "วันครบกำหนดต้องอยู่หลังหรือเท่ากับวันสอบเทียบ";
      return;
    }
    item.methods = data.getAll("methods");
    item.source_reference = standardEdit.value || "new:" + crypto.randomUUID();
    button.disabled = true;
    standardDelete.disabled = true;
    standardEdit.disabled = true;
    standardStatus.textContent = "กำลังบันทึก…";
    try {
      const { error } = await supabase.from(standardTable).upsert(item, { onConflict: "source_reference" });
      if (error) throw error;
      standardCatalogue.set(item.source_reference, item);
      if (!standardEdit.value) standardEdit.add(new Option("", item.source_reference));
      standardEdit.value = item.source_reference;
      standardEdit.selectedOptions[0].text = standardReference(item);
      standardStatus.textContent = "บันทึกเครื่องมาตรฐานแล้ว";
    } catch (error) {
      standardStatus.textContent = error.message || "บันทึกเครื่องมาตรฐานไม่สำเร็จ";
    } finally {
      button.disabled = false;
      standardEdit.disabled = false;
      standardDelete.disabled = !standardEdit.value;
    }
  });

  function setOptions(select, entries, placeholder) {
    const previous = select.value;
    select.replaceChildren(new Option(placeholder, ""), ...entries.map(([value, label]) => new Option(label, value)));
    if (entries.some(([value]) => String(value) === previous)) select.value = previous;
  }

  function setRegistrationDepartments(names) {
    departments = [...new Set(names)].sort((left, right) => left.localeCompare(right, "th"));
    setOptions(get("calRegisterDepartment"), departments.map(name => [name, name]), "เลือกหน่วยงาน");
  }

  async function fetchCalibrationDepartments() {
    const rows = await fetchAllPages(() => supabase.from("mems_calibration_departments")
      .select("name").order("name"));
    return rows.map(row => row.name);
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
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        if (maxX < minX || maxY < minY) return resolve(canvas.toDataURL("image/png"));
        const padding = 12;
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(canvas.width - 1, maxX + padding);
        maxY = Math.min(canvas.height - 1, maxY + padding);
        const cropped = document.createElement("canvas");
        cropped.width = maxX - minX + 1;
        cropped.height = maxY - minY + 1;
        cropped.getContext("2d").drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
        resolve(cropped.toDataURL("image/png"));
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
    tested: { select: "calTestSignerSelect", add: "calTestSignerAdd", name: "calTestSignerName", position: "calTestSignerPosition", pad: "tested", x: "calTestSignerX", y: "calTestSignerY", xValue: "calTestSignerXValue", yValue: "calTestSignerYValue", title: "ผู้ทดสอบ" },
    approved: { select: "calApproveSignerSelect", add: "calApproveSignerAdd", name: "calApproveSignerName", position: "calApproveSignerPosition", pad: "approved", x: "calApproveSignerX", y: "calApproveSignerY", xValue: "calApproveSignerXValue", yValue: "calApproveSignerYValue", title: "ผู้อนุมัติ" }
  };
  let calibrationSignatories = { profiles: { tested: [], approved: [] }, preferences: { tested: null, approved: null } };

  async function loadCalibrationSignatories() {
    const [profilesResult, preferencesResult] = await Promise.all([
      supabase.from("mems_calibration_signer_profiles")
        .select("id,role,name,position,signature_data_url").order("name"),
      supabase.from("mems_calibration_signer_preferences")
        .select("role,profile_id,offset_x_mm,offset_y_mm")
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (preferencesResult.error) throw preferencesResult.error;
    calibrationSignatories = { profiles: { tested: [], approved: [] }, preferences: { tested: null, approved: null } };
    for (const signer of profilesResult.data || []) calibrationSignatories.profiles[signer.role].push(signer);
    for (const preference of preferencesResult.data || []) calibrationSignatories.preferences[preference.role] = preference;
    return calibrationSignatories;
  }

  function setSignerProfileOptions(role, selectedId) {
    const fields = signerFields[role];
    const select = get(fields.select);
    const profiles = calibrationSignatories.profiles[role] || [];
    select.replaceChildren(
      new Option("เลือกผู้ลงนาม", ""),
      new Option("+ เพิ่มชื่อและลายเซ็นใหม่", "__new__"),
      ...profiles.map(signer => new Option(signer.name + " · " + signer.position, signer.id))
    );
    select.value = selectedId && profiles.some(signer => signer.id === selectedId) ? selectedId : "__new__";
  }

  async function showSignerProfile(role, profileId) {
    const fields = signerFields[role];
    const signer = calibrationSignatories.profiles[role].find(item => item.id === profileId);
    get(fields.name).value = signer?.name || "";
    get(fields.position).value = signer?.position || "";
    await signaturePads[fields.pad].load(signer?.signature_data_url || "");
  }

  function updateSignerOffsetLabels(role) {
    const fields = signerFields[role];
    get(fields.xValue).textContent = Number(get(fields.x).value).toFixed(1).replace(/\.0$/, "") + " มม.";
    get(fields.yValue).textContent = Number(get(fields.y).value).toFixed(1).replace(/\.0$/, "") + " มม.";
  }

  async function openCalibrationSignerSettings() {
    get("calSignerStatus").textContent = "กำลังโหลดค่าผู้ลงนาม…";
    get("calSignerSettings").disabled = true;
    try {
      const signers = await loadCalibrationSignatories();
      for (const role of ["tested", "approved"]) {
        const fields = signerFields[role];
        const preference = signers.preferences[role];
        setSignerProfileOptions(role, preference?.profile_id || signers.profiles[role][0]?.id);
        const selectedId = get(fields.select).value;
        await showSignerProfile(role, selectedId === "__new__" ? "" : selectedId);
        get(fields.x).value = String(preference?.offset_x_mm ?? 4.2);
        get(fields.y).value = String(preference?.offset_y_mm ?? 0);
        updateSignerOffsetLabels(role);
      }
      get("calSignerStatus").textContent = "เลือกผู้ลงนามที่บันทึกไว้ เพิ่มรายชื่อใหม่ และปรับตำแหน่งลายเซ็นแยกแต่ละฝั่งได้";
      get("calSignerDialog").showModal();
    } finally {
      get("calSignerSettings").disabled = false;
    }
  }

  async function saveCalibrationSignatories() {
    for (const role of ["tested", "approved"]) {
      const fields = signerFields[role];
      const name = get(fields.name).value.trim();
      const position = get(fields.position).value.trim();
      if (!name || !position || !signaturePads[fields.pad].hasInk()) {
        throw new Error("กรุณากรอกชื่อ ตำแหน่ง และวาดลายเซ็นของ" + fields.title + "ให้ครบ");
      }
      const profileId = get(fields.select).value;
      const profile = { role, name, position, signature_data_url: signaturePads[fields.pad].dataUrl(), updated_at: new Date().toISOString() };
      let savedProfile;
      if (profileId === "__new__") {
        const { data, error } = await supabase.from("mems_calibration_signer_profiles").insert(profile).select("id").single();
        if (error) throw error;
        savedProfile = data;
      } else {
        const { data, error } = await supabase.from("mems_calibration_signer_profiles").update(profile)
          .eq("id", profileId).select("id").single();
        if (error) throw error;
        savedProfile = data;
      }
      const { error } = await supabase.from("mems_calibration_signer_preferences").upsert({
        role,
        profile_id: savedProfile.id,
        offset_x_mm: Number(get(fields.x).value),
        offset_y_mm: Number(get(fields.y).value),
        updated_at: new Date().toISOString()
      }, { onConflict: "role" });
      if (error) throw error;
    }
    await loadCalibrationSignatories();
    get("calSignerDialog").close();
    notify("บันทึกผู้ลงนามและตำแหน่งลายเซ็นแล้ว · เลือกใช้รายชื่อเดิมหรือเพิ่มรายชื่อใหม่ได้");
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
    setOptions(get("calOperator"), [...new Set(data.map(person => person.name))].map(name => [name, name]), "เลือกผู้ปฏิบัติการ");
    get("calOperatorHint").textContent = data.length
      ? "รายชื่อจาก PM · " + data.length + " รายชื่อ · กดเลือกผู้ปฏิบัติการ"
      : "ยังไม่มีรายชื่อใน PM · กรุณาเพิ่มรายชื่อใน PM ก่อน";
  }

  function assetLabel(asset) {
    return [asset.name || asset.type, asset.tool_code || asset.asset_id,
      asset.inventory_no || asset.asset_code, [asset.manufacturer, asset.model].filter(Boolean).join(" "),
      asset.serial_number && "S/N " + asset.serial_number].filter(Boolean).join(" · ");
  }

  let queuePreviewTool = null;

  function openQueuePreview(tool) {
    queuePreviewTool = tool;
    get("calQueuePreviewTitle").textContent = tool.name;
    const details = get("calQueuePreviewDetails");
    details.replaceChildren();
    for (const [label, value] of [
      ["ID เครื่องมือ", tool.tool_code], ["เลขครุภัณฑ์", tool.inventory_no],
      ["หน่วยงาน", tool.department], ["ประเภทเครื่องมือ", typeNames[tool.method]],
      ["ยี่ห้อ", tool.manufacturer], ["รุ่น", tool.model], ["S/N", tool.serial_number],
    ]) {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value || "—";
      details.append(term, description);
    }
    get("calQueuePreview").showModal();
  }

  function renderQueue() {
    const query = get("calQueueSearch").value.trim().toLowerCase();
    const department = get("calQueueDepartment").value;
    const method = get("calQueueType").value;
    const groupKey = get("calQueueGroup").value;
    const groupOf = tool => groupKey === "department" ? tool.department : typeNames[tool.method];
    const matches = tools.filter(tool => (!department || tool.department === department)
      && (!method || tool.method === method)
      && [tool.tool_code, tool.inventory_no, tool.name, tool.manufacturer, tool.model]
        .some(value => String(value ?? "").toLowerCase().includes(query)));
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
      const grid = document.createElement("div");
      grid.className = "cal-discover-items";
      section.append(title, grid);
      for (const tool of entries) {
        const row = document.createElement("div");
        row.className = "cal-discover-item";
        const cover = document.createElement("div");
        cover.className = "cal-discover-cover";
        cover.setAttribute("aria-hidden", "true");
        cover.dataset.method = tool.method;
        const code = document.createElement("span");
        code.textContent = tool.tool_code;
        cover.append(code);
        const text = document.createElement("div");
        text.className = "cal-discover-info";
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
        button.textContent = "ดูรายละเอียด →";
        button.setAttribute("aria-label", "ดูรายละเอียด " + tool.name + " " + tool.tool_code);
        row.append(cover, text, button);
        grid.append(row);
      }
      list.append(section);
    }
    get("calQueueClear").hidden = !(get("calQueueSearch").value || department || method);
    get("calQueueCount").textContent = matches.length
      ? "พบ " + matches.length + " เครื่อง · หน้า " + (queuePage + 1) + " / " + Math.ceil(matches.length / pageSize)
      : "ไม่พบเครื่องมือในทะเบียนตามที่ค้นหา";
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
    clearDuplicateNotice();
    get("calRegisterName").value = typeNames[method];
    get("calRegisterTitle").textContent = "ลงทะเบียน · " + typeNames[method];
    showView("register");
    notify("กรอกรายละเอียดเครื่องมือสำหรับทะเบียนสอบเทียบ");
    get("calRegisterTitle").focus();
  }

  function loadRegisteredTools() {
    return fetchAllPages(() => supabase.from("mems_calibration_tools")
      .select("id,tool_code,name,department,method,manufacturer,model,created_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false }));
  }

  const registrationDate = value => value
    ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value))
    : "ไม่พบวันที่";

  function clearDuplicateNotice() {
    duplicateRequest++;
    get("calDuplicateNotice").hidden = true;
    get("calDuplicateNotice").textContent = "";
    get("calRegisterCode").removeAttribute("aria-invalid");
  }

  async function warnDuplicate(code) {
    const request = ++duplicateRequest;
    const match = (await loadRegisteredTools()).find(item => item.tool_code.toLowerCase() === code.toLowerCase());
    if (!match) return false;
    const { data, error } = await supabase.from("mems_calibrations")
      .select("calibrated_on").eq("tool_id", match.id)
      .order("calibrated_on", { ascending: false }).limit(1).maybeSingle();
    if (request === duplicateRequest && get("calRegisterCode").value.trim() === code && !get("calRegister").hidden) {
      const notice = get("calDuplicateNotice");
      notice.hidden = false;
      const machine = [match.name, match.manufacturer, match.model].filter(Boolean).join(" ");
      const last = error ? "ตรวจสอบวันที่สอบเทียบล่าสุดไม่ได้"
        : data ? "สอบเทียบล่าสุด " + dateLabel(data.calibrated_on) : "ยังไม่มีประวัติสอบเทียบ";
      notice.textContent = "ID " + match.tool_code + " ซ้ำ · " + machine + " · หน่วยงาน " + match.department +
        " · ลงทะเบียนเมื่อ " + registrationDate(match.created_at) + " · " + last;
      get("calRegisterCode").setAttribute("aria-invalid", "true");
    }
    return true;
  }

  function renderRegisteredTools() {
    const term = get("calRegisteredSearch").value.trim().toLowerCase();
    const matches = registeredTools.filter(tool => [tool.tool_code, tool.name, tool.department]
      .some(value => value.toLowerCase().includes(term)));
    const list = get("calRegisteredList");
    list.replaceChildren();
    for (const tool of matches.slice(registeredPage * pageSize, (registeredPage + 1) * pageSize)) {
      const row = document.createElement("div");
      row.className = "cal-queue-row";
      const content = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = [tool.name, tool.manufacturer, tool.model].filter(Boolean).join(" ");
      const details = document.createElement("p");
      details.textContent = "ID " + tool.tool_code + " · " + tool.department + " · ลงทะเบียนเมื่อ " + registrationDate(tool.created_at);
      content.append(name, details);
      row.append(content, trashButton("tool", tool.id, name.textContent));
      list.append(row);
    }
    get("calRegisteredCount").textContent = matches.length
      ? "พบ " + matches.length + " เครื่อง · หน้า " + (registeredPage + 1) : "ไม่พบเครื่องมือในทะเบียน";
    get("calRegisteredPrev").disabled = registeredPage === 0;
    get("calRegisteredNext").disabled = (registeredPage + 1) * pageSize >= matches.length;
  }

  async function openRegisteredTools() {
    showView("registered");
    get("calRegisteredTitle").focus();
    get("calRegisteredSearch").value = "";
    get("calRegisteredSearch").disabled = true;
    get("calRegisteredList").replaceChildren();
    get("calRegisteredPrev").disabled = true;
    get("calRegisteredNext").disabled = true;
    get("calRegisteredCount").textContent = "กำลังโหลดทะเบียน…";
    try {
      registeredTools = await loadRegisteredTools();
      registeredPage = 0;
      renderRegisteredTools();
    } catch (error) {
      get("calRegisteredCount").textContent = "โหลดทะเบียนไม่สำเร็จ";
      throw error;
    } finally {
      get("calRegisteredSearch").disabled = false;
    }
  }

  async function registerTool() {
    const method = registerMethod;
    const tool = Object.fromEntries([...new FormData(get("calRegister"))].map(([key, value]) => [key, value.trim()]));
    if (!tool.name || !tool.tool_code) throw new Error("กรุณากรอกชื่อและ ID เครื่องมือ");
    if (await warnDuplicate(tool.tool_code)) return;
    const { error } = await supabase.from("mems_calibration_tools").insert({ ...tool, method });
    if (error?.code === "23505") {
      if (await warnDuplicate(tool.tool_code)) return;
      throw new Error("ID เครื่องมือนี้มีในทะเบียนสอบเทียบแล้ว");
    }
    if (error) throw error;
    if (registerMethod === method) {
      get("calRegister").reset();
      get("calRegisterName").value = typeNames[method];
      clearDuplicateNotice();
    }
    notify("ลงทะเบียนเครื่อง ID " + tool.tool_code + " สำเร็จ");
    loadDashboardMetrics().catch(error => console.warn("อัปเดตภาพรวมทะเบียนไม่สำเร็จ", error));
  }

  async function refreshFilters() {
    const { data, error } = await supabase.rpc("mems_calibration_filter_options");
    if (error) throw error;
    setOptions(get("calFilterDepartment"), data.departments.map(name => [name, name]), "ทุกหน่วยงาน");
    const typeSelect = get("calFilterType");
    setOptions(typeSelect, data.equipment_types.map(name => [name, name]), "ทุกประเภท");
    get("calHistoryTypes").replaceChildren(...Array.from(typeSelect.options, option => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.type = option.value;
      button.textContent = option.text;
      return button;
    }));
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
    get("calHistoryScroll").scrollTop = 0;
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
      actions.append(editButton, button, trashButton("record", row.id, row.certificate_no));
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

  async function changeTrash(kind, id, restore) {
    const { error } = await supabase.rpc("mems_change_calibration_trash", {
      p_kind: kind, p_id: id, p_restore: restore
    });
    if (error) throw error;
    loadDashboardMetrics().catch(console.warn);
  }

  function trashButton(kind, id, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "ย้ายลงถังขยะ";
    button.setAttribute("aria-label", "ย้ายลงถังขยะ " + label);
    button.addEventListener("click", guarded(async () => {
      const details = kind === "tool" ? " ประวัติสอบเทียบของเครื่องนี้จะย้ายไปด้วย" : "";
      if (!window.confirm("ย้าย " + label + " ลงถังขยะหรือไม่?" + details + " กู้คืนได้ภายใน 30 วัน")) return;
      await changeTrash(kind, id, false);
      if (kind === "tool") {
        metadataDrafts.delete(id);
        if (activeTool?.id === id) activeTool = null;
        registeredTools = registeredTools.filter(item => item.id !== id);
        registeredPage = 0;
        renderRegisteredTools();
      } else {
        page = 0;
        await loadHistory();
      }
      notify("ย้ายลงถังขยะแล้ว กู้คืนได้ภายใน 30 วัน");
    }, button));
    return button;
  }

  const trashDialog = get("calTrashDialog");
  async function loadTrash() {
    const status = get("calTrashStatus");
    const list = get("calTrashList");
    status.textContent = "กำลังโหลดถังขยะ…";
    list.replaceChildren();
    try {
      const items = await fetchAllPages(() => supabase.rpc("mems_list_calibration_trash"));
      const expiry = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "cal-queue-row";
        const content = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = item.label;
        const detail = document.createElement("p");
        detail.textContent = (item.kind === "tool" ? "ทะเบียนเครื่องมือ" : "ประวัติสอบเทียบ") +
          " · ครบกำหนด " + expiry.format(new Date(item.expires_at)) +
          (item.can_restore ? "" : " · กู้คืนเครื่องมือก่อน");
        content.append(title, detail);
        row.append(content);
        if (item.can_restore) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "กู้คืน";
          button.setAttribute("aria-label", "กู้คืน " + item.label);
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              await changeTrash(item.kind, item.id, true);
              await loadTrash();
              if (!get("calRegistered").hidden) await openRegisteredTools();
              if (!get("calHistory").hidden) await loadHistory();
              status.textContent = "กู้คืนแล้ว · " + status.textContent;
            } catch (error) {
              status.textContent = error.message || "กู้คืนไม่สำเร็จ";
            } finally {
              button.disabled = false;
            }
          });
          row.append(button);
        }
        list.append(row);
      }
      status.textContent = items.length ? items.length + " รายการในถังขยะ" : "ถังขยะว่าง";
    } catch (error) {
      status.textContent = error.message || "โหลดถังขยะไม่สำเร็จ";
    }
  }

  get("calTrashTab").addEventListener("click", () => {
    trashDialog.showModal();
    loadTrash();
  });
  get("calTrashClose").addEventListener("click", () => trashDialog.close());

  function showView(view) {
    const views = { picker: "calPicker", register: "calRegister", registered: "calRegistered", queue: "calQueue", form: "calForm", history: "calHistory" };
    for (const [key, id] of Object.entries(views)) get(id).hidden = key !== view;
    get("calNewTab").setAttribute("aria-pressed", String(["picker", "register", "registered"].includes(view)));
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
        measurements: record.measurements.map(sheet => {
          const rows = sheet.rows.map(row => row.map(value => String(value ?? "")));
          if (!rows.length) rows.push(blankMeasurementRow());
          return {
            ...sheet, rows,
            standardAuto: rows.map(row => [2, 4, 6].map(index => row[index] === "")),
            budget: sheet.budget.map((value, index) =>
              sheet.budget_missing?.includes(index) ? "" : String(value ?? ""))
          };
        })
      } : metadataDrafts.get(tool.id);
      const fields = draft?.fields ?? ["", today(), operatorName, "", "23", "50", ""];
      const operatorSelect = get("calOperator");
      if (draft && fields[2] && !Array.from(operatorSelect.options).some(option => option.value === fields[2])) operatorSelect.add(new Option(fields[2] + " (ข้อมูลเดิม)", fields[2]));
      draftFields.forEach((id, index) => { get(id).value = fields[index]; });
      device.value = tool.method;
      rowsByDevice.set(tool.method, draft?.measurements ? structuredClone(draft.measurements) : stateFor());
      render();
    }
    editingRecordId = record?.id || null;
    get("calCertificate").readOnly = !record;
    get("calSave").textContent = record ? "บันทึกการแก้ไข" : "บันทึกผลสอบเทียบ";
    get("calBack").textContent = record ? "← กลับไปประวัติ" : "← กลับไปคิวสอบเทียบ";
    const standardInput = get("calStandardReference");
    const { rows: managed } = await loadStandardEquipment();
    if (activeTool !== tool) return;
    const fixedEquipment = managed.find(item => item.source_reference === standardKey(nibpStandard));
    const fixedMethod = Boolean(fixedSetpoints[tool.method]) && !record;
    const fixedStandard = fixedMethod && !fixedEquipment?.removed;
    standardInput.readOnly = fixedStandard;
    if (fixedStandard) {
      standardInput.value = fixedEquipment ? standardReference(fixedEquipment) : nibpStandard;
      get("calAccessStandard").value = "";
      get("calAccessStandardField").hidden = true;
      get("calStandardHint").textContent = "เครื่องมาตรฐานที่กำหนดตามแบบสอบเทียบ NIBP";
    } else if (!await loadFormStandardOptions(tool, fixedMethod || (newToolForm && !draft), managed)) {
      return;
    }
    if (!record) await ensureCertificateForDate();
    if (activeTool !== tool) return;
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

  async function loadFormStandardOptions(tool, fillDefault, managed) {
    const { data: standard, error: standardError } = await supabase.from("mems_calibration_standards")
      .select("standard_reference,source_note").eq("method", tool.method).maybeSingle();
    if (standardError) throw standardError;
    if (activeTool !== tool) return;
    const overrides = new Map(managed.map(item => [item.source_reference, item]));
    const resolve = value => {
      const item = overrides.get(standardKey(value));
      return item ? (!item.removed && item.methods.includes(tool.method) ? standardReference(item) : "") : value;
    };
    const reference = workbookStandards[tool.method + ":" + tool.tool_code];
    const historical = historicalStandard(tool.method, standard?.standard_reference);
    const defaults = splitStandards(reference || historical).map(resolve).filter(Boolean);
    const options = [...new Set([
      ...defaults, ...accessStandards(tool.method).map(resolve),
      ...managed.filter(item => !item.removed && item.methods.includes(tool.method)).map(standardReference)
    ].filter(Boolean))];
    const select = get("calAccessStandard");
    setOptions(select, options.map(value => [value, value]), "เลือกเครื่องที่ใช้จริง");
    select.value = "";
    get("calAccessStandardField").hidden = !options.length;
    if (fillDefault) get("calStandardReference").value = defaults.join(" / ") ||
      (options.length === 1 ? options[0] : "");
    get("calStandardHint").textContent = options.length ? "ตรวจและเลือกเครื่องมาตรฐานที่ใช้จริงสำหรับใบรับรอง"
      : "ยังไม่มีเครื่องมาตรฐานที่กำหนดให้ประเภทนี้ สามารถระบุเครื่องที่ใช้จริงได้";
    return true;
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
    get("calHistoryTypes").querySelectorAll("button").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.type === filters.equipmentType));
    });
    page = 0;
    await loadHistory();
  }

  function collectMeasurements() {
    return rowsByDevice.get(device.value).map((sheet, i) => {
      const { title, optional, unit: defaultUnit } = devices[device.value][i];
      const rows = sheet.rows.filter(row => (optional ? row.slice(1) : row).some(value => value !== "")).map(row => row.map(numeric));
      const unit = sheet.unit.trim() || (optional && !rows.length ? defaultUnit : "");
      const budget = device.value === "infusion" || usesNibpWorkbook(device.value, i)
        ? [0, 0, 0, 0] : sheet.budget.map(numeric);
      if (rows.length > 100) throw new Error(title + " · เพิ่มได้ไม่เกิน 100 จุดต่อพารามิเตอร์");
      if (!unit || (!optional && !rows.length)) {
        throw new Error(title + " · กรุณาระบุหน่วยและจุดทดสอบ");
      }
      if (budget.some(value => value !== null && (!Number.isFinite(value) || value < 0))) {
        throw new Error(title + " · ค่า UCB ที่กรอกต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
      }
      for (const row of rows) {
        const [point, nominal, s1, m1, s2, m2, s3, m3] = row;
        const validInfusion = device.value === "infusion"
          && [point, nominal, s1, s2].every(Number.isFinite)
          && [m1, m2, s3, m3].every(value => value === null);
        const readingsValid = [point, nominal, m1, m2, m3].every(Number.isFinite);
        const standardReadings = [s1, s2, s3];
        const standardsValid = standardReadings.every(Number.isFinite)
          || (!["general", "ambient"].includes(device.value) && standardReadings.every(value => value === null));
        if (!validInfusion && !(readingsValid && standardsValid)) {
          if (device.value === "infusion") throw new Error(title + " · กรอก UUC setting และ Standard Reading ให้ครบ 2 รอบ");
          if (device.value === "nibp") throw new Error(title + " · กรอกค่า STD และค่าเครื่องให้ครบ 3 รอบ");
          throw new Error(title + " · กรอกจุดทดสอบ ค่า STD และค่าเครื่องให้ครบ 3 รอบ ช่องมาตรฐานให้กรอกครบหรือเว้นทั้ง 3 ช่องเมื่อใช้ STD");
        }
      }
      const missing = budget.flatMap((value, index) => value === null ? [index] : []);
      // The database validator requires four numbers. Keep track of any blank fields separately.
      return { unit, rows, budget: budget.map(value => value ?? 0),
        ...(missing.length ? { budget_missing: missing } : {}) };
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

  const pdfLayoutKey = "mems.calibration.pdf-layout.v1";
  const defaultPdfLayout = {
    orientation: "portrait", titleAlign: "center", title: "Certificate of Testing",
    titleSize: 19, hospital: "Phaholpolpayuhasena Hospital", center: "Medical Device Center",
    headerSize: 17, titleY: 0, logoX: 0, logoY: 0, logoScale: 100, logo: "", fontData: "", fontName: "",
    comment: "Comment : This report certifies the test results as of the date, location and the conditions of testing only.",
    address: "โรงพยาบาลพหลพลพยุหเสนา  572 ถ.แสงชูโต  ต.ปากแพรก  อ.เมืองกาญจนบุรี 71000 โทร 034-587800"
  };
  function loadPdfLayout() {
    try {
      return { ...defaultPdfLayout, ...JSON.parse(localStorage.getItem(pdfLayoutKey)) };
    } catch {
      return { ...defaultPdfLayout };
    }
  }

  const pdfBrandingTable = "mems_calibration_pdf_branding";
  async function loadSharedPdfLogo() {
    const { data, error } = await supabase.from(pdfBrandingTable).select("logo").eq("id", true).maybeSingle();
    if (error?.code === "PGRST205" || error?.code === "42P01") return null;
    if (error) throw error;
    return data?.logo ?? null;
  }

  async function saveSharedPdfLogo(logo) {
    const { error } = await supabase.from(pdfBrandingTable).upsert({ id: true, logo });
    if (error?.code === "PGRST205" || error?.code === "42P01") {
      throw new Error("ต้องอัปเดตฐานข้อมูลก่อนบันทึกโลโก้ส่วนกลาง");
    }
    if (error) throw error;
  }

  async function loadCertificateLayout() {
    const layout = loadPdfLayout();
    const logo = await loadSharedPdfLogo();
    return { ...layout, logo: logo ?? layout.logo };
  }

  function applyCertificateFont(doc, fontData) {
    if (!fontData) return PDF_FONT;
    const name = "CalibrationUpload";
    const filename = name + ".ttf";
    doc.addFileToVFS(filename, fontData);
    doc.addFont(filename, name, "normal");
    doc.setFont(name, "normal");
    const metadata = doc.getFont().metadata;
    if (typeof metadata?.characterToGlyph !== "function" ||
      [..."สอบเทียบเครื่องมือแพทย์ความดันผู้อนุมัติABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"]
        .some(char => !metadata.characterToGlyph(char.codePointAt(0)))) {
      throw new Error("เลือกไฟล์ TTF ที่รองรับภาษาไทย อังกฤษ และตัวเลข");
    }
    return name;
  }

  async function buildPdf(records, layout = loadPdfLayout()) {
    const doc = await newThaiPdf({ orientation: layout.orientation });
    const certificateFont = applyCertificateFont(doc, layout.fontData);
    const signerSettings = await loadCalibrationSignatories();
    const signatories = {};
    for (const role of ["tested", "approved"]) {
      const selectedId = signerSettings.preferences[role]?.profile_id;
      const signer = signerSettings.profiles[role].find(item => item.id === selectedId)
        || signerSettings.profiles[role][0] || null;
      signatories[role] = signer;
      if (signer?.signature_data_url?.startsWith("data:image/png;base64,")) {
        signer.signature_data_url = await recolorSignature(signer.signature_data_url);
      }
    }
    const hospitalLogoResponse = await fetch(layout.logo || "hospital-seal.png");
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
    const sealScale = Math.min(60 / sealProperties.width, 52 / sealProperties.height) * layout.logoScale / 100;
    const sealWidth = sealProperties.width * sealScale;
    const sealHeight = sealProperties.height * sealScale;
    const headerPages = new Set();
    const left = 46;
    const right = pageW - 46;
    const mm = value => Number(value) * 72 / 25.4;
    const text = (value, x, y, size = 11, options) => {
      doc.setFont(certificateFont, "normal").setFontSize(size).setTextColor(35, 43, 50)
        .text(String(value ?? "—"), x, y, options || {});
    };
    const fittedText = (value, x, y, size, width, align = "left") => {
      doc.setFont(certificateFont, "normal").setFontSize(size);
      const measured = doc.getTextWidth(value);
      text(value, x, y, measured > width ? size * width / measured : size, { align });
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
        const dueDate = fields.find(value => value.startsWith("ครบกำหนด "))?.slice("ครบกำหนด ".length) || "—";
        if (/^(S\/N|สอบเทียบ|Cal(?:ibration)?\s*date|รหัส|Cert|ครบกำหนด)/i.test(model)) { manufacturer = fields[0] || "—"; model = "—"; }
        return [manufacturer, model, serial, calDate, cert, dueDate];
      });
    };
    const drawHeader = record => {
      const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
      if (headerPages.has(pageNumber)) return;
      headerPages.add(pageNumber);
      doc.setDrawColor(45, 55, 60).setLineWidth(1.1);
      const sealX = left + (60 - sealWidth) / 2 + mm(layout.logoX);
      const sealY = 24 + (52 - sealHeight) / 2 + mm(layout.logoY);
      // Keep the expanded seal above the header rule while allowing position adjustments.
      const headerSealY = layout.logoScale > 100 ? Math.max(5, Math.min(sealY, 85 - sealHeight)) : sealY;
      doc.addImage(hospitalLogoDataUrl, "PNG", sealX, headerSealY, sealWidth, sealHeight);
      const headerX = Math.max(left + 70, sealX + sealWidth + 10);
      const headerWidth = right - headerX - 54;
      fittedText(layout.hospital, headerX, 45, Number(layout.headerSize), headerWidth);
      fittedText(layout.center, headerX, 65, Number(layout.headerSize) - 2, headerWidth);
      doc.line(left, 88, right, 88);
      const titleX = { left, center: pageW / 2, right }[layout.titleAlign];
      fittedText(layout.title, titleX, 119 + mm(layout.titleY), Number(layout.titleSize), right - left, layout.titleAlign);
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
    const certificatePages = [];
    const drawStandardTable = (record, startY, onPage, workbook = false) => {
      const references = standardRows(record.standard_reference);
      doc.autoTable({
        startY,
        margin: { left: left + 43, right: left + 43, top: 289, bottom: workbook ? 200 : 181 },
        head: [[{ content: "Standard Used",
          colSpan: 6, styles: { halign: "left", fontSize: 12, lineWidth: 0 } }],
        workbook ? ["Item", "Instrument", "S/N", "Cer.No", "Cal Date", "Due Date"]
          : ["Manufacture", "Model", "S/N", "Cal date", "Cert No.", "Due date"]],
        body: workbook ? references.map(([manufacturer, model, serial, calDate, cert, dueDate], index) =>
          [index + 1, [manufacturer, model].filter(value => value !== "—").join(" ") || "—",
            serial, cert, calDate, dueDate]) : references,
        theme: "grid",
        styles: { font: certificateFont, fontSize: 10, halign: "center", cellPadding: 2, lineColor: [110, 120, 125], lineWidth: .35 },
        headStyles: { font: certificateFont, fontStyle: "normal", fillColor: [255, 255, 255], textColor: [35, 43, 50] },
        pageBreak: "avoid",
        didDrawPage: onPage
      });
    };
    records.forEach((record, recordIndex) => {
      if (recordIndex) doc.addPage();
      const firstPage = doc.internal.getCurrentPageInfo().pageNumber;
      const workbookLayout = record.method === "digital-bp";
      drawCertificatePage(record);
      let finalY = 289;
      const tables = (record.measurements || []).flatMap((sheet, sheetIndex) => {
        if (devices[record.method]?.[sheetIndex]?.optional && !sheet.rows.length) return [];
        const digitalTitles = ["Systolic", "Diastolic", "Mean Arterial Pressure", "Pulse Rate", "SpO2"];
        const sheetTitle = ((workbookLayout ? digitalTitles[sheetIndex] : null) ||
          devices[record.method]?.[sheetIndex]?.title || typeNames[record.method] || "ผลทดสอบ")
          .replaceAll("SpO₂", "SpO2");
        const xray = record.method.startsWith("x-ray");
        const rowMeans = (sheet.rows || []).map(row => {
          const values = [row[3], row[5], row[7]];
          return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        });
        const cv = xray && rowMeans.every(Number.isFinite) ? calculateCoefficientVariation(rowMeans) : null;
        const nibpWorkbook = usesNibpWorkbook(record.method, sheetIndex);
        const uncertaintyReport = record.method === "infusion" || nibpWorkbook;
        const rows = (sheet.rows || []).map((row, rowIndex) => {
          const [, nominal, s1, m1, s2, m2, s3, m3] = row;
          const result = record.method === "infusion"
            ? calculateInfusionPoint({ nominal, standardReadings: [s1, s2] })
            : nibpWorkbook
            ? calculateNibpPoint({ nominal, measuredReadings: [m1, m2, m3],
              pulseRate: devices[record.method][sheetIndex].unit === "bpm" })
            : calculatePoint({ nominal, standardReadings: [s1, s2, s3],
            measuredReadings: [m1, m2, m3], budget: (sheet.budget || []).map((value, index) =>
              sheet.budget_missing?.includes(index) ? null : value), errorRule: calibrationErrorRule(record.method, sheetIndex) });
          const limit = calibrationAcceptanceLimit(record.method, sheetIndex, nominal);
          const workbookPoint = workbookLayout && nibpWorkbook;
          const rowData = [workbookPoint && Number.isInteger(nominal) ? String(nominal) : certificateNumber(nominal),
            certificateNumber(result.mean), certificateNumber(result.error, workbookPoint ? 2 : 3),
            workbookPoint ? certificateNumber(result.expanded)
              : uncertaintyReport ? "± " + certificateNumber(result.expanded, 3)
              : limit === null ? "—" : "± " + certificateNumber(limit, 3)];
          if (xray) rowData.push(rowIndex === 0 && cv !== null ? certificateNumber(cv, 3) : "—");
          return rowData;
        });
        return [{
          sheetIndex, rows, xray,
          head: [[{ content: sheetTitle + "  (" + sheet.unit + ")", colSpan: xray ? 5 : 4 }],
            [record.method === "infusion" ? "UUC setting" : "STD setting",
              record.method === "infusion" ? "STD Reading" : workbookLayout && nibpWorkbook ? "UUC Reading" : "Mean Reading",
              xray ? "Error (%)" : "Error", workbookLayout && nibpWorkbook ? "Uncertainty" : uncertaintyReport ? "Ureport" : "Accept value"]
              .concat(xray ? ["CV (%)"] : [])],
        }];
      });
      if (record.method === "digital-bp") {
        const fixedTables = tables.filter(table => usesNibpWorkbook(record.method, table.sheetIndex));
        const levels = ["High", "Medium", "Low"];
        const groupRows = levels.flatMap((level, index) => fixedTables.flatMap(table => {
          const point = fixedSetpoints[record.method][table.sheetIndex].at(-1 - index);
          const label = { 0: "Systolic (mmHg)", 1: "Diastolic (mmHg)",
            3: "Pulse Rate, " + levels[levels.length - 1 - index] + " (bpm)" }[table.sheetIndex];
          return table.rows.filter(row => Number(row[0]) === point)
            .map(row => [level, label, ...row]);
        }));
        // Older records can contain different setpoints. Keep their original tables.
        if (fixedTables.length === 3 && fixedTables.every(table => table.rows.length === 3) &&
          groupRows.length === 9 && new Set(groupRows.map(row => row.slice(0, 2).join("|"))).size === 9) {
          tables.splice(0, tables.length, {
            grouped: true, rows: groupRows,
            head: [["Pressure Range", { content: "STD Setting", colSpan: 2 }, "UUC Reading", "Error", "Uncertainty"]]
          }, ...tables.filter(table => !usesNibpWorkbook(record.method, table.sheetIndex)));
        }
      }
      for (const { head, rows, xray, grouped } of tables) {
        const resultTableWidth = 399;
        doc.autoTable({
          startY: finalY,
          margin: { left: left + 42, right: left + 42, top: 290, bottom: 55 },
          head,
          body: rows,
          theme: "grid",
          styles: { font: certificateFont, fontSize: 10.5, halign: "center",
            cellPadding: { vertical: 1, horizontal: 3 }, lineColor: [90, 100, 105], lineWidth: .35 },
          headStyles: { font: certificateFont, fontStyle: "normal", fillColor: [255, 255, 255], textColor: [35, 43, 50], lineColor: [60, 70, 75] },
          tableWidth: xray ? "auto" : resultTableWidth,
          columnStyles: xray || grouped ? {} : { 0: { cellWidth: 98 }, 1: { cellWidth: 98 }, 2: { cellWidth: 85 }, 3: { cellWidth: 118 } },
          rowPageBreak: "avoid",
          didDrawPage: () => drawCertificatePage(record)
        });
        finalY = doc.lastAutoTable.finalY + 4;
      }
      drawStandardTable(record, finalY + 3, () => drawCertificatePage(record), workbookLayout);
      if (workbookLayout) {
        const notesY = doc.lastAutoTable.finalY + 12;
        fittedText("วิธีการสอบเทียบ: อ่านค่าที่เครื่องแสดง 3 รอบต่อจุด แล้วเปรียบเทียบค่าเฉลี่ยกับค่า STD",
          left + 43, notesY, 10, right - left - 86);
        fittedText("ความไม่แน่นอนขยายแสดงที่ระดับความเชื่อมั่นประมาณ 95%",
          left + 43, notesY + 12, 10, right - left - 86);
      } else {
        text("วิธีทดสอบ : โดยการนำเครื่องมือที่ต้องการสอบเทียบต่อเข้ากับเครื่องมาตรฐาน แล้วควบคุมค่าตามจุดทดสอบ อ่านค่าแล้วบันทึกค่า",
          left + 43, doc.lastAutoTable.finalY + 12, 10);
      }
      const signY = pageH - 120;
      const drawSigner = (label, signer, fallbackName, x, width, placement) => {
        const centerX = x + width / 2;
        const offsetX = (Number(placement?.offset_x_mm) || 0) * 72 / 25.4;
        const offsetY = (Number(placement?.offset_y_mm) || 0) * 72 / 25.4;
        text(label + " : ................................................", centerX, signY, 11, { align: "center", maxWidth: width });
        if (signer?.signature_data_url?.startsWith("data:image/png;base64,")) {
          const image = doc.getImageProperties(signer.signature_data_url);
          const scale = Math.min(92 / image.width, 26 / image.height);
          const imageWidth = image.width * scale;
          const imageHeight = image.height * scale;
          doc.addImage(signer.signature_data_url, "PNG", centerX + offsetX - imageWidth / 2, signY - imageHeight - 7 + offsetY, imageWidth, imageHeight);
        }
        text(signer?.name || fallbackName || "", centerX, signY + 16, 11, { align: "center", maxWidth: width });
        text(signer?.position || (workbookLayout ? "" : "นายช่างเทคนิค (เครื่องมือแพทย์)"),
          centerX, signY + 30, 10, { align: "center", maxWidth: width });
      };
      const signerWidth = (right - left) / 2;
      drawSigner(workbookLayout ? "Calibration by" : "Tested by", signatories.tested, record.operator_name,
        left, signerWidth, signerSettings.preferences.tested);
      drawSigner("Approved by", signatories.approved, "", right - signerWidth, signerWidth, signerSettings.preferences.approved);
      if (workbookLayout) {
        text("End of Certificate", right, pageH - 41, 8.5, { align: "right" });
      }
      fittedText(layout.comment, left, pageH - 48, 8.5, right - left);
      doc.setDrawColor(70, 80, 85).setLineWidth(.45).line(left, pageH - 37, right, pageH - 37);
      fittedText(layout.address, left, pageH - 22, 8.2, right - left - 43);
      if (doc.__memsLogoDataUrl) {
        doc.addImage(doc.__memsLogoDataUrl, "PNG", right - 40, pageH - 34, 16, 16);
        fittedText("MEMs", right - 19, pageH - 22, 8.5, 19);
      }
      if (workbookLayout) certificatePages.push({ firstPage, lastPage: doc.internal.getCurrentPageInfo().pageNumber });
    });
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      const certificate = certificatePages.find(({ firstPage, lastPage }) => i >= firstPage && i <= lastPage);
      const page = certificate ? i - certificate.firstPage + 1 : i;
      const count = certificate ? certificate.lastPage - certificate.firstPage + 1 : totalPages;
      text("Page " + page + " of " + count, right, 37, 9, { align: "right" });
    }
    return doc;
  }

  async function showPdf(records) {
    if (!records.length) throw new Error("ไม่พบรายงานตามตัวกรอง");
    const doc = await buildPdf(records, await loadCertificateLayout());
    const filename = records.length === 1 ? "calibration-" + records[0].certificate_no.replace(/[^a-z0-9_-]/gi, "_") : "calibration-filtered";
    rptDeliverPdf(doc, filename + ".pdf", { preview: true });
    notify("สร้าง PDF แล้ว · เลือกพิมพ์หรือดาวน์โหลดจากหน้าตัวอย่าง");
  }

  const pdfDialog = get("calPdfDialog");
  const pdfForm = get("calPdfLayoutForm");
  const pdfLogo = get("calPdfLogo");
  const pdfFont = get("calPdfFont");
  const pdfPreview = get("calPdfLayoutPreview");
  const pdfStatus = get("calPdfLayoutStatus");
  let draftLogo = "";
  let sharedLogo = null;
  let draftFont = { fontData: "", fontName: "" };
  let previewUrl = "";
  let previewVersion = 0;

  function clearLayoutPreview() {
    previewVersion++;
    pdfPreview.hidden = true;
    pdfPreview.removeAttribute("src");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }

  function fillLayoutForm(layout) {
    for (const [name, value] of Object.entries(layout)) {
      const field = pdfForm.elements.namedItem(name);
      if (field) field.value = value;
    }
    draftLogo = layout.logo;
    pdfLogo.value = "";
    setDraftFont(layout.fontData, layout.fontName);
    get("calPdfLogoPreview").src = draftLogo || "hospital-seal.png";
    clearLayoutPreview();
  }

  function setDraftFont(fontData, fontName) {
    draftFont = { fontData, fontName };
    pdfFont.value = "";
    get("calPdfFontName").textContent = fontName || "TH Sarabun (ค่าเริ่มต้น)";
    get("calPdfClearFont").disabled = !fontData;
    clearLayoutPreview();
  }

  function readLayoutForm() {
    const layout = { ...defaultPdfLayout, logo: draftLogo, ...draftFont };
    for (const [name, value] of new FormData(pdfForm)) {
      layout[name] = typeof defaultPdfLayout[name] === "number" ? Number(value) : value.trim();
    }
    return layout;
  }

  get("calPdfSettings").addEventListener("click", guarded(async () => {
    sharedLogo = await loadSharedPdfLogo();
    const layout = loadPdfLayout();
    fillLayoutForm({ ...layout, logo: sharedLogo ?? layout.logo });
    get("calPdfLogoField").hidden = !memsIsAdmin();
    pdfStatus.textContent = sharedLogo === null && layout.logo && memsIsAdmin()
      ? "กดบันทึกการตั้งค่าเพื่อให้ทุกเครื่องใช้โลโก้ที่บันทึกไว้ในเบราว์เซอร์นี้" : "";
    pdfDialog.showModal();
  }, get("calPdfSettings")));
  get("calPdfClose").addEventListener("click", () => pdfDialog.close());
  pdfDialog.addEventListener("close", () => {
    pdfLogo.value = "";
    pdfFont.value = "";
    clearLayoutPreview();
  });
  get("calPdfReset").addEventListener("click", () => {
    fillLayoutForm({ ...defaultPdfLayout, logo: memsIsAdmin() ? "" : (sharedLogo ?? draftLogo) });
    pdfStatus.textContent = "คืนค่าเริ่มต้นแล้ว กดบันทึกเพื่อใช้งาน";
  });
  pdfForm.addEventListener("input", clearLayoutPreview);
  get("calPdfClearFont").addEventListener("click", () => {
    setDraftFont("", "");
    pdfStatus.textContent = "เลือกฟอนต์เดิมแล้ว กดบันทึกเพื่อใช้งาน";
  });
  pdfFont.addEventListener("change", async () => {
    const file = pdfFont.files[0];
    if (!file) return;
    try {
      if (!/\.ttf$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
        throw new Error("เลือกไฟล์ .ttf ขนาดไม่เกิน 2 MB");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (pdfFont.files[0] !== file || !pdfDialog.open) return;
      if (bytes.length < 12 || new DataView(bytes.buffer).getUint32(0) !== 0x00010000) {
        throw new Error("ไฟล์นี้ไม่ใช่ฟอนต์ TrueType (.ttf) ที่รองรับ");
      }
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const fontData = btoa(binary);
      applyCertificateFont(new window.jspdf.jsPDF(), fontData);
      setDraftFont(fontData, file.name);
      pdfStatus.textContent = "โหลดฟอนต์แล้ว ดูตัวอย่าง PDF หรือกดบันทึกการตั้งค่าได้";
    } catch (error) {
      if (pdfFont.files[0] === file) pdfStatus.textContent = error.message || "อ่านฟอนต์ไม่ได้";
    } finally {
      if (pdfFont.files[0] === file) pdfFont.value = "";
    }
  });
  pdfLogo.addEventListener("change", async () => {
    const file = pdfLogo.files[0];
    if (!file || !memsIsAdmin()) return;
    pdfLogo.disabled = true;
    const url = URL.createObjectURL(file);
    try {
      if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024) {
        throw new Error("เลือกไฟล์ PNG หรือ JPEG ขนาดไม่เกิน 5 MB");
      }
      const image = new Image();
      image.src = url;
      await image.decode();
      if (pdfLogo.files[0] !== file || !pdfDialog.open) return;
      const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const uploadedLogo = canvas.toDataURL("image/png");
      await saveSharedPdfLogo(uploadedLogo);
      sharedLogo = uploadedLogo;
      if (pdfLogo.files[0] !== file || !pdfDialog.open) return;
      draftLogo = uploadedLogo;
      get("calPdfLogoPreview").src = uploadedLogo;
      clearLayoutPreview();
      pdfStatus.textContent = "บันทึกโลโก้สำหรับทุกเครื่องแล้ว";
    } catch (error) {
      if (pdfLogo.files[0] === file) pdfStatus.textContent = error.message || "อ่านไฟล์โลโก้ไม่ได้";
    } finally {
      pdfLogo.disabled = false;
      URL.revokeObjectURL(url);
      if (pdfLogo.files[0] === file) pdfLogo.value = "";
    }
  });
  pdfForm.addEventListener("submit", async event => {
    event.preventDefault();
    const saveButton = pdfForm.querySelector('[type="submit"]');
    if (saveButton.disabled || pdfLogo.files.length || pdfFont.files.length) return;
    saveButton.disabled = true;
    try {
      const { logo, ...layout } = readLayoutForm();
      if (memsIsAdmin() && logo !== (sharedLogo ?? "")) {
        await saveSharedPdfLogo(logo);
        sharedLogo = logo;
      }
      localStorage.setItem(pdfLayoutKey, JSON.stringify(layout));
      pdfStatus.textContent = "บันทึกโครงร่าง PDF แล้ว";
    } catch (error) {
      pdfStatus.textContent = error.message || "บันทึกการตั้งค่าไม่ได้";
    } finally {
      saveButton.disabled = false;
    }
  });
  get("calPdfPreviewLayout").addEventListener("click", async () => {
    if (!pdfForm.reportValidity() || pdfLogo.files.length || pdfFont.files.length) return;
    clearLayoutPreview();
    const version = previewVersion;
    pdfStatus.textContent = "กำลังสร้างตัวอย่าง PDF";
    try {
      const doc = await buildPdf([{
        certificate_no: "PREVIEW", method: "infusion", department: "หน่วยงานตัวอย่าง",
        calibrated_on: today(), asset_snapshot: { name: "เครื่องมือตัวอย่าง", tool_code: "SAMPLE" },
        measurements: [{ unit: "mL/h", rows: [[1, 10, 9.8, null, 9.9, null, null, null]] }]
      }], readLayoutForm());
      if (version !== previewVersion || !pdfDialog.open) return;
      previewUrl = URL.createObjectURL(doc.output("blob"));
      pdfPreview.src = previewUrl;
      pdfPreview.hidden = false;
      pdfStatus.textContent = "ตัวอย่าง PDF พร้อมดู";
    } catch (error) {
      if (version === previewVersion) pdfStatus.textContent = error.message || "สร้างตัวอย่างไม่ได้";
    }
  });

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
  const departmentDialog = get("calDepartmentDialog");
  const departmentForm = get("calDepartmentForm");
  const departmentSave = get("calDepartmentSave");
  const departmentStatus = get("calDepartmentStatus");

  get("calDepartmentOpen").addEventListener("click", () => {
    departmentForm.reset();
    departmentStatus.textContent = "";
    departmentDialog.showModal();
  });
  get("calDepartmentClose").addEventListener("click", () => departmentDialog.close());
  departmentDialog.addEventListener("cancel", event => {
    if (departmentSave.disabled) event.preventDefault();
  });
  departmentForm.addEventListener("submit", guarded(async () => {
    const name = departmentForm.elements.namedItem("name").value.trim();
    if (!name || departments.some(department => department.toLowerCase() === name.toLowerCase())) {
      departmentStatus.textContent = name ? "มีหน่วยงานชื่อนี้แล้ว" : "กรุณากรอกชื่อหน่วยงาน";
      return;
    }

    get("calDepartmentClose").disabled = true;
    departmentStatus.textContent = "กำลังบันทึก…";
    try {
      const { error } = await supabase.from("mems_calibration_departments").insert({ name });
      if (error?.code === "23505") {
        setRegistrationDepartments([...departments, ...await fetchCalibrationDepartments()]);
        departmentStatus.textContent = "มีหน่วยงานชื่อนี้แล้ว";
        return;
      }
      if (error) throw error;

      setRegistrationDepartments([...departments, name]);
      get("calRegisterDepartment").value = name;
      departmentDialog.close();
      notify("เพิ่มหน่วยงาน " + name + " แล้ว");
    } catch (error) {
      console.warn("บันทึกหน่วยงานสอบเทียบไม่สำเร็จ", error);
      departmentStatus.textContent = "บันทึกหน่วยงานไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      get("calDepartmentClose").disabled = false;
    }
  }, departmentSave));

  get("calRegisterBack").addEventListener("click", openPicker);
  get("calAccessStandard").addEventListener("change", guarded(() => {
    const select = get("calAccessStandard");
    const selected = select.value;
    select.value = "";
    const input = get("calStandardReference");
    if (!selected || input.readOnly) return;
    const entries = [input.value.trim(), selected].flatMap(value => value.split(/\s+\/\s+/)).filter(Boolean);
    const value = [...new Set(entries)].join(" / ");
    if (value.length > input.maxLength) throw new Error("รายการเครื่องมาตรฐานยาวเกิน " + input.maxLength + " ตัวอักษร");
    input.value = value;
  }));
  get("calRegisteredOpen").addEventListener("click", guarded(openRegisteredTools));
  get("calRegisteredFromForm").addEventListener("click", guarded(openRegisteredTools));
  get("calRegisteredBack").addEventListener("click", openPicker);
  get("calRegisteredSearch").addEventListener("input", () => {
    registeredPage = 0;
    renderRegisteredTools();
  });
  get("calRegisteredPrev").addEventListener("click", () => { registeredPage--; renderRegisteredTools(); });
  get("calRegisteredNext").addEventListener("click", () => { registeredPage++; renderRegisteredTools(); });
  get("calRegisterCode").addEventListener("input", clearDuplicateNotice);
  get("calRegisterCode").addEventListener("blur", guarded(async () => {
    const code = get("calRegisterCode").value.trim();
    if (code && !get("calRegister").inert && !get("calRegister").hidden) await warnDuplicate(code);
  }));
  get("calQueueTab").addEventListener("click", guarded(openQueue));
  get("calQueueFilters").addEventListener("submit", event => event.preventDefault());
  get("calQueueFilters").addEventListener("input", () => { queuePage = 0; renderQueue(); });
  get("calQueueClear").addEventListener("click", () => {
    for (const id of ["calQueueSearch", "calQueueDepartment", "calQueueType"]) get(id).value = "";
    queuePage = 0;
    get("calQueueSearch").focus();
    renderQueue();
  });
  document.querySelectorAll("[data-cal-queue-view]").forEach(button => {
    button.addEventListener("click", () => {
      get("calQueueList").dataset.view = button.dataset.calQueueView;
      for (const option of button.parentElement.querySelectorAll("button")) {
        option.setAttribute("aria-pressed", String(option === button));
      }
    });
  });
  get("calQueuePrev").addEventListener("click", () => { queuePage--; renderQueue(); });
  get("calQueueNext").addEventListener("click", () => { queuePage++; renderQueue(); });
  get("calQueueList").addEventListener("click", event => {
    const button = event.target.closest("[data-tool-id]");
    const tool = button && tools.find(item => item.id === button.dataset.toolId);
    if (tool) openQueuePreview(tool);
  });
  get("calQueuePreviewStart").addEventListener("click", guarded(async () => {
    const tool = queuePreviewTool;
    if (!tool) return;
    get("calQueuePreview").close();
    queuePreviewTool = null;
    await openForm(tool);
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
  get("calHistoryTypes").addEventListener("click", guarded(event => {
    const button = event.target.closest("button[data-type]");
    if (!button) return;
    get("calFilterType").value = button.dataset.type;
    return applyFilters();
  }));
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
  for (const role of ["tested", "approved"]) {
    const fields = signerFields[role];
    get(fields.select).addEventListener("change", () => {
      showSignerProfile(role, get(fields.select).value === "__new__" ? "" : get(fields.select).value)
        .catch(error => { get("calSignerStatus").textContent = error.message || "โหลดลายเซ็นไม่สำเร็จ"; });
    });
    get(fields.add).addEventListener("click", () => {
      get(fields.select).value = "__new__";
      showSignerProfile(role, "");
      get(fields.name).focus();
    });
    get(fields.x).addEventListener("input", () => updateSignerOffsetLabels(role));
    get(fields.y).addEventListener("input", () => updateSignerOffsetLabels(role));
  }
  get("calTestSignerClear").addEventListener("click", () => signaturePads.tested.clear());
  get("calApproveSignerClear").addEventListener("click", () => signaturePads.approved.clear());
  get("calSignerForm").addEventListener("submit", guarded(saveCalibrationSignatories, get("calSignerSave")));

  guarded(async () => {
    const profile = await memsGuard("calibration");
    if (!profile) return;
    get("calStandardSettings").hidden = !memsIsAdmin();
    canRemoveStandard = memsIsSuperAdmin(profile);
    standardDelete.hidden = !canRemoveStandard;
    operatorName = profile.display_name || "";
    await loadCalibrationOperators().catch(error => {
      console.warn("โหลดรายชื่อผู้ปฏิบัติงานจาก PM ไม่สำเร็จ", error);
      get("calOperatorHint").textContent = "โหลดรายชื่อจาก PM ไม่สำเร็จ · กรุณาโหลดหน้าใหม่";
    });
    const [savedDepartments, calibrationDepartments] = await Promise.all([
      fetchPreparationWards().catch(() => []),
      fetchCalibrationDepartments().catch(error => {
        console.warn("โหลดหน่วยงานสอบเทียบไม่สำเร็จ", error);
        return [];
      })
    ]);
    setRegistrationDepartments(["ศูนย์เครื่องมือแพทย์", ...MEMS_WARDS, ...savedDepartments, ...calibrationDepartments]);
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

