function memsInitSiriPrepare() {
  const settings = document.getElementById("siriPrepareSettings");
  const create = document.getElementById("siriPrepareCreate");
  const revoke = document.getElementById("siriPrepareRevoke");
  const config = document.getElementById("siriPrepareConfig");
  const status = document.getElementById("siriPrepareStatus");

  async function changeLink(action) {
    create.disabled = true;
    revoke.disabled = true;
    config.value = "";
    config.hidden = true;
    status.textContent = "กำลังติดต่อ MEMS…";
    try {
      const { data, error } = await supabase.rpc("mems_siri_prepare_link", { p_action: action });
      if (error) throw error;
      if (action === "revoke") {
        status.textContent = "ยกเลิกรหัส Siri แล้ว";
        return;
      }
      if (data?.status !== "linked" || !data.code) throw new Error("MEMS ไม่ส่งรหัสกลับมา");
      config.value = JSON.stringify({
        url: SUPABASE_URL + "/rest/v1/rpc/mems_siri_prepare",
        apiKey: SUPABASE_ANON_KEY,
        code: data.code,
      });
      try {
        await navigator.clipboard.writeText(config.value);
        status.textContent = "คัดลอกการตั้งค่าแล้ว วางในแอปคำสั่งลัดบน iPhone เครื่องนี้";
      } catch {
        config.hidden = false;
        config.select();
        status.textContent = "คัดลอกชุดการตั้งค่าจากช่องนี้ไปวางในแอปคำสั่งลัด";
      }
    } catch {
      status.textContent = "จัดการรหัส Siri ไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      create.disabled = false;
      revoke.disabled = false;
    }
  }

  create.addEventListener("click", () => changeLink("create"));
  revoke.addEventListener("click", () => changeLink("revoke"));
  settings.hidden = false;
}
