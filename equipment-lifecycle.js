/* Registry-backed preparation and ward-scoped borrowing/returning. */
(() => {
  const $ = (id) => document.getElementById(id);
  let registry = [],
    status = [],
    prepared = [],
    selected = new Map(),
    version = 0;
  let returnType = null;
  let saving = false,
    retry = null;
  const isPrepare = !!$("equipGrid");
  const key = (i) => memsMachineKey(i.equipment, i.number);
  const limit = (items) =>
    items.every((i) => memsTypeKey(i.equipment) === "infusion pump") ? 10 : 5;
  const error = (e) => alert(e.message || String(e));
  const button = (label, click, active = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "equip-chip lifecycle-number";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(active));
    b.classList.toggle("active", active);
    b.onclick = click;
    return b;
  };
  function addMachineThumbnail(target, type, number) {
    const original = [...document.querySelectorAll(".equip-grid .equip-btn")]
      .find(item => memsTypeKey(item.dataset.e) === memsTypeKey(type));
    const sample = original?.querySelector("img.ei");
    const thumbnail = document.createElement("span");
    thumbnail.className = "lifecycle-machine-thumbnail";
    thumbnail.setAttribute("aria-hidden", "true");
    // Show the equipment name if no photo exists, never another device's photo.
    const fallback = () => { thumbnail.textContent = type; };
    if (sample) {
      const picture = document.createElement("img");
      picture.src = sample.getAttribute("src");
      picture.alt = "";
      picture.addEventListener("error", fallback, { once: true });
      thumbnail.append(picture);
    } else fallback();
    const label = document.createElement("span");
    label.className = "lifecycle-machine-label";
    label.textContent = "No. " + number;
    target.replaceChildren(thumbnail, label);
    target.classList.add("lifecycle-machine-choice");
    target.setAttribute("aria-label", type + " No. " + number);
  }
  async function refresh() {
    const results = await Promise.all([
      fetchRegistryEquipment(),
      fetchEquipmentStatus(),
      fetchPreparedList(),
      fetchPreparationWards(),
    ]);
    [registry, status, prepared] = results;
    const select = $("wardSel");
    const existing = new Set([...select.options].map(option => option.value));
    const other = [...select.options].find(option => option.value === "อื่นๆ โปรดระบุชื่อตึก");
    const names = [...new Set([...results[3], ...prepared.map(item => item.ward),
      ...status.map(item => item.ward)].filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
    for (const name of names) {
      if (existing.has(name)) continue;
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.insertBefore(option, other || null);
      existing.add(name);
    }
  }
  function usable(a) {
    const k = memsMachineKey(a.type, a.no);
    return (
      a.no != null &&
      a.status === "ใช้งานได้" &&
      registry.filter((b) => memsMachineKey(b.type, b.no) === k).length === 1 &&
      !status.some(
        (s) => s.isBorrowed && memsMachineKey(s.equipment, s.number) === k,
      ) &&
      !prepared.some((p) => key(p) === k)
    );
  }
  function toggle(item, render) {
    if (saving) return;
    if (selected.has(key(item))) selected.delete(key(item));
    else {
      const all = [...selected.values(), item];
      if (!isPrepare && all.length > limit(all))
        return alert(
          "เลือกได้สูงสุด 5 เครื่อง หรือ Infusion Pump อย่างเดียว 10 เครื่อง",
        );
      selected.set(key(item), item);
    }
    if (!isPrepare && typeof memsQrBatchItems !== "undefined")
      memsQrBatchItems = [];
    retry = null;
    render();
  }
  function renderNumbers() {
    const wrap = $("numberInputs");
    wrap.replaceChildren();
    wrap.hidden = true;
    let manual = $("lifecycleManualNumber");
    if (!manual) {
      manual = document.createElement("form");
      manual.id = "lifecycleManualNumber";
      const input = document.createElement("input");
      input.className = "field";
      input.type = "text";
      input.inputMode = "numeric";
      input.placeholder = "กรอกหมายเลขเครื่อง เช่น 5";
      input.setAttribute("aria-label", "กรอกหมายเลขเครื่อง");
      const add = button("＋ เพิ่มเครื่อง", () => {});
      add.type = "submit";
      manual.append(input, add);
      manual.onsubmit = (event) => {
        event.preventDefault();
        if (saving) return;
        const number = normalizeMachineNo(input.value.trim());
        const asset = registry.find((a) =>
          memsTypeKey(a.type) === memsTypeKey(selectedEquip) &&
          normalizeMachineNo(a.no) === number && usable(a));
        if (!asset) return alert("ไม่พบเครื่องพร้อมใช้หมายเลขนี้ในประเภทที่เลือก กรุณาตรวจสอบทะเบียนหรือสถานะเครื่อง");
        const item = { equipment: asset.type, number };
        selected.set(key(item), item);
        retry = null;
        input.value = "";
        renderNumbers();
        input.focus();
      };
      wrap.before(manual);
    }
    manual.querySelector("input").disabled = !selectedEquip;
    if (!selectedEquip) manual.querySelector("input").value = "";
    $("addNumberBtn").hidden = true;
    renderRecommendations();
    let summary = $("lifecycleSelection");
    if (!summary) {
      summary = document.createElement("p");
      summary.id = "lifecycleSelection";
      wrap.after(summary);
    }
    summary.textContent =
      "เลือกแล้ว " +
      selected.size +
      " เครื่อง: " +
      [...selected.values()]
        .map((i) => i.equipment + " No." + i.number)
        .join(", ");
  }
  function renderRecommendations() {
    const card = $("readyEquipmentCard");
    card.style.display = selectedEquip ? "block" : "none";
    card.classList.toggle("show", !!selectedEquip);
    card.setAttribute("aria-hidden", String(!selectedEquip));
    $("readyEquipmentContext").textContent =
      (selectedEquip || "") + " · 15 อันดับแรก เรียงจากวันคืนเก่าสุดก่อน";
    const items = registry.filter((a) =>
      memsTypeKey(a.type) === memsTypeKey(selectedEquip) && usable(a)
    ).map((a) => {
      const item = { equipment: a.type, number: normalizeMachineNo(a.no) };
      const record = status.find((s) => key(s) === key(item));
      const time = record && !record.isBorrowed ? Date.parse(record.lastUpdate) : NaN;
      return { ...item, time: Number.isFinite(time) ? time : Infinity };
    }).sort((a, b) => {
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      return a.number.localeCompare(b.number, "th", { numeric: true });
    }).slice(0, 15);
    $("readyEquipmentCount").textContent = items.length + " ลำดับ";
    const list = $("readyEquipmentList");
    list.replaceChildren();
    const bangkokDay = (date) => Date.parse(bkkDateStr(date) + "T00:00:00+07:00");
    items.forEach((item, index) => {
      const row = button("", () => {
        if (saving) return;
        toggle(item, renderNumbers);
        const input = $("lifecycleManualNumber").querySelector("input");
        input.value = selected.has(key(item)) ? item.number : "";
      }, selected.has(key(item)));
      row.classList.add("ready-item");
      const rank = document.createElement("span");
      rank.className = "ready-rank";
      rank.textContent = index + 1;
      const description = document.createElement("span");
      description.textContent = "No. " + item.number;
      const meta = document.createElement("small");
      meta.className = "ready-meta";
      meta.textContent = Number.isFinite(item.time)
        ? formatReadyEquipmentDate(new Date(item.time).toISOString())
        : "ยังไม่มีประวัติคืน";
      description.append(meta);
      const duration = document.createElement("span");
      duration.className = "ready-duration";
      duration.textContent = Number.isFinite(item.time)
        ? Math.max(0, Math.round((bangkokDay(new Date()) - bangkokDay(new Date(item.time))) / 86400000)) + " วัน"
        : "—";
      row.append(rank, description, duration);
      list.append(row);
    });
    if (!items.length) list.textContent = "ยังไม่มีเครื่องพร้อมใช้สำหรับประเภทนี้";
  }
  function renderTypes() {
    const types = [
      ...new Set(registry.filter((a) => a.type).map((a) => a.type)),
    ].sort((a, b) => a.localeCompare(b, "th"));
    if (isPrepare) {
      $("equipGrid").replaceChildren(
        ...types.map((type) =>
          button(
            type,
            () => {
              const input = $("lifecycleManualNumber")?.querySelector("input");
              if (input && selectedEquip !== type) input.value = "";
              selectedEquip = type;
              $("otherEquipNameCard").style.display = "none";
              renderTypes();
              renderNumbers();
            },
            selectedEquip === type,
          ),
        ),
      );

      document.querySelector(".number-help").textContent =
        "กรอกหมายเลขแล้วกดเพิ่ม หรือแตะรายการแนะนำเครื่องที่ควรใช้ก่อน รวมหลายประเภทได้";
    } else {
      const grid = document.querySelector(".equip-grid");
      // Keep image buttons for QR compatibility; extend from the registry.
      types.forEach((type) => {
        let b = [...grid.querySelectorAll(".equip-btn")].find(
          (b) => memsTypeKey(b.dataset.e) === memsTypeKey(type),
        );
        if (!b) {
          b = button(type, () => {});
          b.classList.add("equip-btn");
          grid.append(b);
        }
        b.dataset.e = type;
      });
    }
  }
  function hideManual() {
    [
      "normalNumCard",
      "c2BorrowCard",
      "c2GridCard",
      "otherEquipNameCard",
    ].forEach((id) => {
      if ($(id)) $(id).style.display = "none";
    });
    document.querySelector(".equip-grid").closest(".card").style.display =
      "none";
  }
  function renderWard() {
    hideManual();
    const el = $("preparedBanner"),
      ward = $("wardSel").value;
    el.replaceChildren();
    el.dataset.action = S.action || "";
    el.style.display = ward && S.action ? "" : "none";
    if (!ward || !S.action) return;
    const source =
      S.action === "borrow"
        ? prepared.filter((p) => p.ward === ward)
        : status.filter((s) => s.isBorrowed && s.ward === ward);
    const title = document.createElement("h3");
    title.textContent =
      S.action === "borrow"
        ? "เครื่องที่เตรียมไว้สำหรับ " + ward
        : "เครื่องที่กำลังยืมโดย " + ward;
    el.append(title);
    if (!source.length) {
      const p = document.createElement("p");
      p.textContent =
        S.action === "borrow"
          ? "หน่วยงานนี้ยังไม่มีเครื่องที่เตรียมไว้"
          : "หน่วยงานนี้ไม่มีเครื่องที่กำลังยืม";
      el.append(p);
    }
    if (S.action === "return" && source.length) {
      const types = [...new Set(source.map(item => item.equipment))].sort((a, b) => a.localeCompare(b, "th"));
      if (!types.includes(returnType)) returnType = null;
      const prompt = document.createElement("p");
      prompt.textContent = "เลือกประเภทเครื่องที่จะคืน";
      el.append(prompt);
      const choices = document.createElement("div");
      choices.className = "lifecycle-grid lifecycle-return-types";
      el.append(choices);
      for (const type of types) {
        const choice = button(type, () => {
          if (saving) return;
          returnType = type;
          renderWard();
        }, type === returnType);
        const original = [...document.querySelectorAll(".equip-grid .equip-btn")]
          .find(item => memsTypeKey(item.dataset.e) === memsTypeKey(type));
        const sample = original?.querySelector(".ei, .ei-fb");
        const picture = sample ? sample.cloneNode(true) : document.createElement("span");
        if (!sample) {
          picture.className = "ei-fb";
          picture.textContent = "🏥";
        }
        picture.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "ei-label";
        label.textContent = type;
        const check = document.createElement("span");
        check.className = "ei-check";
        check.setAttribute("aria-hidden", "true");
        choice.replaceChildren(picture, label, check);
        choice.dataset.returnType = type;
        choice.classList.remove("lifecycle-number");
        choice.classList.add("equip-btn", "lifecycle-return-type");
        choice.setAttribute("aria-current", String(type === returnType));
        choice.removeAttribute("aria-pressed");
        choice.setAttribute("aria-label", "เลือกประเภทคืน " + type);
        choices.append(choice);
      }
    }
    const groups = new Map();
    source.filter(item => S.action !== "return" || item.equipment === returnType).forEach((i) => {
      if (!groups.has(i.equipment)) groups.set(i.equipment, []);
      groups.get(i.equipment).push(i);
    });
    groups.forEach((items, type) => {
      const h = document.createElement("h4");
      h.textContent = type;
      el.append(h);
      const group = document.createElement("div");
      group.className = "lifecycle-grid";
      el.append(group);
      items.forEach((item) => {
        const b = button(
          "No. " + item.number,
          () => toggle(item, renderWard),
          selected.has(key(item)),
        );
        addMachineThumbnail(b, item.equipment, item.number);
        const container = document.createElement("div");
        container.className = "lifecycle-return-machine";
        if (S.action === "return") {
          const start = item.borrowStartedAt;
          const small = document.createElement("small");
          small.textContent = start
            ? "ยืม " +
              new Date(start).toLocaleString("th-TH", {
                timeZone: "Asia/Bangkok", day: "numeric", month: "numeric",
                year: "2-digit", hour: "2-digit", minute: "2-digit",
              }) +
              " · " +
              Math.max(0, (Date.now() - Date.parse(start)) / 3600000).toFixed(
                1,
              ) +
              " ชม."
            : "ข้อมูลวันเริ่มยืมไม่ครบ";
          small.className = "lifecycle-return-time";
          container.append(b, small);
          const transfer = button("ย้าย", () =>
            openTransferModal(item.equipment, item.number, item.ward));
          transfer.classList.add("lifecycle-transfer");
          transfer.setAttribute("aria-label", "ย้าย " + item.equipment + " No. " + item.number);
          if (typeof memsCanTransferWard === "function" && memsCanTransferWard()) container.append(transfer);
          group.classList.add("lifecycle-return-grid");
          group.append(container);
        } else group.append(b);
      });
    });
    const info = document.createElement("p");
    info.textContent = "เลือกแล้ว " + selected.size + " เครื่อง";
    el.append(info);
  }
  async function submit(mode, items, ward, name, options = {}) {
    if (saving) return false;
    if (mode !== "prepare" && items.length > limit(items))
      throw new Error(
        "เลือกได้สูงสุด 5 เครื่อง หรือ Infusion Pump อย่างเดียว 10 เครื่อง",
      );
    if (!items.length) throw new Error("กรุณาเลือกเครื่องจากรายการแนะนำ หรือกรอกหมายเลขเครื่องก่อนบันทึก");
    if (!ward) throw new Error("กรุณาเลือกหรือระบุชื่อตึก/หน่วยงาน");
    if (!name) throw new Error("กรุณาระบุชื่อผู้ทำรายการ");
    saving = true;
    const b = $(isPrepare ? "saveBtn" : "submitBtn");
    b.disabled = true;
    const signature = JSON.stringify({
      mode,
      items: items.map((i) => ({ equipment: i.equipment, number: i.number })),
      ward,
      name,
      options,
    });
    if (!retry || retry.signature !== signature)
      retry = { signature, id: crypto.randomUUID() };
    try {
      await saveEquipmentBatch(mode, items, ward, name, {
        ...options,
        requestId: retry.id,
      });
      retry = null;
      selected.clear();
      if (isPrepare) {
        memsResetPrepareQrBatch();
        resetPrepareForm();
        loadList();
      } else {
        if (typeof memsClearQrReturnContext === "function")
          memsClearQrReturnContext();
        resetForm();
      }
      b.disabled = true;
      if (isPrepare) toast("✅ บันทึกสำเร็จครบ " + items.length + " เครื่อง");
      else
        showSuccess({
          action: mode === "return" ? "🟥 คืน" : "🟩 ยืม",
          ward,
          name,
          shift: options.shift,
          equipmentNumbers: items.map((i) => i.number),
          equipmentItems: items.map((i) => ({
            equipment: i.equipment,
            equipmentNumber: i.number,
          })),
          savedCount: items.length,
        });
      try {
        await refresh();
        if (isPrepare) {
          renderTypes();
          renderNumbers();
        } else renderWard();
      } catch (e) {
        console.warn("บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่ได้", e);
      }
      return true;
    } finally {
      saving = false;
      b.disabled = false;
    }
  }
  if (isPrepare) {
    // Keep legacy cancellation callbacks on the same registry-backed list.
    loadReadyEquipmentRecommendations = async () => renderRecommendations();
    const cancelPreparation = doCancel;
    doCancel = async function (reason) {
      await cancelPreparation(reason);
      try {
        await refresh();
        renderNumbers();
      } catch (e) {
        console.warn("โหลดเครื่องหลังยกเลิกไม่ได้", e);
      }
    };
    window.savePrepare = async () => {
      if (saving) return;
      const qr =
        typeof memsPrepareQrBatchItems !== "undefined"
          ? memsPrepareQrBatchItems
          : [];
      const combined = new Map(
        [...selected.values(), ...qr].map((i) => [key(i), i]),
      );
      const items = [...combined.values()];
      const ward =
        $("wardSel").value === "อื่นๆ โปรดระบุชื่อตึก"
          ? $("otherWard").value.trim()
          : $("wardSel").value;
      const name =
        $("preparedBySel").value === "อื่นๆ"
          ? $("preparedByOther").value.trim()
          : $("preparedBySel").value;
      try {
        // Saving also accepts a valid number still typed in the entry field.
        const input = $("lifecycleManualNumber")?.querySelector("input");
        const number = normalizeMachineNo((input?.value || "").trim());
        if (number) {
          const asset = registry.find((a) =>
            memsTypeKey(a.type) === memsTypeKey(selectedEquip) &&
            normalizeMachineNo(a.no) === number && usable(a));
          if (!asset) throw new Error("ไม่พบเครื่องพร้อมใช้หมายเลขนี้ในประเภทที่เลือก กรุณาตรวจสอบทะเบียนหรือสถานะเครื่อง");
          const item = { equipment: asset.type, number };
          if (!items.some((existing) => key(existing) === key(item))) items.push(item);
        }
        await submit(
          prepareMode === "deliver" ? "deliver" : "prepare",
          items,
          ward,
          name ? name + " เจ้าหน้าที่ศูนย์เครื่องมือแพทย์" : "",
          { shift: detectShiftTH() },
        );
      } catch (e) {
        error(e);
      }
    };
  } else {
    // Fixed submit controls must sit above the shared footer's stacking context.
    document.body.appendChild(document.querySelector(".submit-bar"));
    const oldAction = setAction,
      oldWard = onWardChange,
      oldPick = pickEquip,
      oldTransfer = submitTransfer;
    pickEquip = function (...args) {
      oldPick(...args);
      hideManual();
    };
    submitTransfer = async function () {
      await oldTransfer();
      selected.clear();
      retry = null;
      await refresh();
      renderWard();
    };
    const selectQr = async (items) => {
      await refresh();
      const ward = $("wardSel").value;
      const source =
        S.action === "borrow"
          ? prepared.filter((p) => p.ward === ward)
          : status.filter((p) => p.isBorrowed && p.ward === ward);
      if (items.some((i) => !source.some((p) => key(p) === key(i))))
        throw new Error("เครื่องไม่ได้อยู่ในรายการของหน่วยงานนี้");
      if (items.length > limit(items))
        throw new Error("เกินจำนวนเครื่องสูงสุดต่อครั้ง");
      selected = new Map(items.map((i) => [key(i), i]));
      if (S.action === "return") returnType = items[0]?.equipment || null;
      renderWard();
    };
    memsApplyQrReturnSelection = async function () {
      if (!memsQrReturnAsset || S.action !== "return") return;
      const asset = memsQrReturnAsset;
      const current = await fetchEquipmentStatusForMachine(
        asset.type,
        asset.no,
      );
      if (
        !current ||
        !current.isBorrowed ||
        current.ward !== $("wardSel").value
      )
        throw new Error("เครื่องไม่ได้อยู่ในรายการของหน่วยงานนี้");
      await selectQr([
        { equipment: asset.type, number: normalizeMachineNo(asset.no) },
      ]);
      memsSetQrBanner(
        "เลือกคืนแล้ว: " + asset.type + " No." + asset.no,
        "success",
      );
    };
    const oldQrBatch = memsApplyQrBatchItems,
      oldQrBorrow = memsApplyQrBorrowBatchItems;
    memsApplyQrBatchItems = async function (items, action) {
      const result = await oldQrBatch(items, action);
      if (result && $("wardSel").value) await selectQr(items);
      return result;
    };
    memsApplyQrBorrowBatchItems = async function (items) {
      const result = await oldQrBorrow(items);
      if (result) await selectQr(items);
      return result;
    };
    setAction = function (a) {
      returnType = null;
      selected.clear();
      selectedPrepared.clear();
      retry = null;
      oldAction(a);
      renderWard();
    };
    onWardChange = async function (sel) {
      returnType = null;
      selected.clear();
      selectedPrepared.clear();
      c2SelectedNums.clear();
      retry = null;
      // A ward change invalidates every selection, including a previous QR batch.
      if (typeof memsClearQrReturnContext === "function")
        memsClearQrReturnContext();
      const v = ++version;
      await oldWard(sel);
      try {
        await refresh();
        if (v === version) renderWard();
      } catch (e) {
        error(e);
      }
    };
    renderPreparedBanner = renderWard;
    filterEquipButtons = hideManual;
    window.handleSubmit = async () => {
      if (saving) return;
      const qr =
        typeof memsQrBatchItems !== "undefined" ? memsQrBatchItems : [];
      let items = selected.size ? [...selected.values()] : qr;
      if (!items.length && selectedPrepared.size)
        items = [...selectedPrepared.values()];
      if (!items.length && S.equip)
        items = getEquipNumbers().map((number) => ({
          equipment: S.equip,
          number,
        }));
      const actual = readActualTime();
      if (actual === false) return;
      const ward =
        $("wardSel").value === "อื่นๆ โปรดระบุชื่อตึก"
          ? $("otherWard").value.trim()
          : $("wardSel").value;
      try {
        await submit(S.action, items, ward, $("staffName").value.trim(), {
          shift: { morning: "เวรเช้า", afternoon: "เวรบ่าย", night: "เวรดึก" }[
            S.shift
          ],
          timestamp: actual ? actual.toISOString() : null,
        });
      } catch (e) {
        error(e);
      }
    };
  }
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      await refresh();
      renderTypes();
      if (isPrepare) renderNumbers();
      else renderWard();
    } catch (e) {
      error(e);
    }
  });
})();
