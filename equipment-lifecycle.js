/* Registry-backed preparation and ward-scoped borrowing/returning. */
(() => {
  const $ = (id) => document.getElementById(id);
  let registry = [],
    status = [],
    prepared = [],
    selected = new Map(),
    version = 0;
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
  async function refresh() {
    [registry, status, prepared] = await Promise.all([
      fetchRegistryEquipment(),
      fetchEquipmentStatus(),
      fetchPreparedList(),
    ]);
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
    registry
      .filter(
        (a) => memsTypeKey(a.type) === memsTypeKey(selectedEquip) && usable(a),
      )
      .forEach((a) => {
        const item = { equipment: a.type, number: normalizeMachineNo(a.no) };
        wrap.append(
          button(
            "No. " + item.number,
            () => toggle(item, renderNumbers),
            selected.has(key(item)),
          ),
        );
      });
    if (!wrap.childElementCount) {
      const message = document.createElement("p");
      message.className = "lifecycle-empty";
      message.textContent = selectedEquip
        ? "ไม่มีเครื่องพร้อมใช้ที่ศูนย์ กรุณาตรวจสอบหรือเพิ่มทะเบียนพร้อมหมายเลขก่อน"
        : "เลือกประเภทเครื่องเพื่อแสดงหมายเลขที่พร้อมใช้";
      wrap.append(message);
    }
    $("addNumberBtn").hidden = true;
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
              selectedEquip = type;
              $("otherEquipNameCard").style.display = "none";
              renderTypes();
              renderNumbers();
            },
            selectedEquip === type,
          ),
        ),
      );
      $("readyEquipmentCard").style.display = "none";
      document.querySelector(".number-help").textContent =
        "แตะหมายเลขเพื่อเลือกหลายเครื่อง รวมหลายประเภทได้";
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
    const groups = new Map();
    source.forEach((i) => {
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
        if (S.action === "return") {
          const start = item.borrowStartedAt;
          const small = document.createElement("small");
          small.textContent = start
            ? "ยืม " +
              new Date(start).toLocaleString("th-TH", {
                timeZone: "Asia/Bangkok",
              }) +
              " · " +
              Math.max(0, (Date.now() - Date.parse(start)) / 3600000).toFixed(
                1,
              ) +
              " ชม."
            : "ข้อมูลวันเริ่มยืมไม่ครบ";
          b.append(small);
        }
        group.append(b);
        if (S.action === "return")
          group.append(
            button("ย้าย No. " + item.number, () =>
              openTransferModal(item.equipment, item.number, item.ward),
            ),
          );
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
    if (!items.length || !ward || !name)
      throw new Error("กรุณาเลือกเครื่อง ตึก และระบุชื่อให้ครบ");
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
      selected.clear();
      selectedPrepared.clear();
      retry = null;
      oldAction(a);
      renderWard();
    };
    onWardChange = async function (sel) {
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
