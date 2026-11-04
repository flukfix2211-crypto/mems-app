/* Missing borrow/return entries recorded by equipment-center staff. */
function memsSummarizeUnkeyed(preparations, returns) {
  const incidents = [];
  for (const row of preparations) {
    if (!/^ยกเลิก:\s*หน่วยงาน(?:ไม่คีย์ยืมเครื่องมือ|นำเครื่องไปไม่คีย์ยืม(?:เครื่อง(?:มือ)?)?)\s*$/.test(row.status || '')) continue;
    incidents.push({ kind: 'borrow', ward: row.ward || 'ไม่ระบุหน่วยงาน', equipment: row.equipment_type,
      number: row.equipment_number, date: row.recorded_at, staff: row.prepared_by, reason: row.status });
  }
  for (const row of returns) {
    if (!(row.action || '').includes('คืน') || row.note !== 'หน่วยงาน ' + row.ward + ' ไม่คีย์คืนเครื่อง') continue;
    incidents.push({ kind: 'return', ward: row.ward || 'ไม่ระบุหน่วยงาน', equipment: row.equipment_name,
      number: row.equipment_number, date: row.recorded_at, staff: row.staff_name, reason: row.note });
  }
  const wards = new Map();
  for (const incident of incidents) {
    if (!wards.has(incident.ward)) wards.set(incident.ward, { ward: incident.ward, borrow: 0, return: 0, total: 0 });
    const entry = wards.get(incident.ward);
    entry[incident.kind]++;
    entry.total++;
  }
  return { borrow: incidents.filter(i => i.kind === 'borrow').length,
    return: incidents.filter(i => i.kind === 'return').length,
    wards: [...wards.values()].sort((a,b) => b.total - a.total || a.ward.localeCompare(b.ward, 'th')),
    incidents: incidents.sort((a,b) => Date.parse(b.date) - Date.parse(a.date)) };
}

function memsUnkeyedMonthRange(month) {
  if (!month) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('กรุณาเลือกเดือนให้ถูกต้อง');
  const [year, number] = month.split('-').map(Number);
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2,'0')}`;
  return [month + '-01T00:00:00+07:00', next + '-01T00:00:00+07:00'];
}

async function memsLoadUnkeyedStatistics() {
  const status = document.getElementById('unkeyedStatus');
  const results = document.getElementById('unkeyedResults');
  const month = document.getElementById('unkeyedMonth').value;
  const request = (memsLoadUnkeyedStatistics.request || 0) + 1;
  memsLoadUnkeyedStatistics.request = request;
  results.hidden = true;
  memsLoadUnkeyedStatistics.latest = null;
  document.getElementById("unkeyedPdfBtn").disabled = true;
  status.textContent = 'กำลังโหลดสถิติ…';
  try {
    const range = memsUnkeyedMonthRange(month);
    const query = (table, columns) => {
      let q = supabase.from(table).select(columns).order('id');
      if (range) q = q.gte('recorded_at', range[0]).lt('recorded_at', range[1]);
      return q;
    };
    const [preparations, returns] = await Promise.all([
      fetchAllPages(() => query('prepare_records', 'id,ward,equipment_type,equipment_number,prepared_by,status,recorded_at').like('status', 'ยกเลิก:%')),
      fetchAllPages(() => query('borrow_records', 'id,ward,equipment_name,equipment_number,staff_name,action,note,recorded_at').like('note', '%ไม่คีย์คืนเครื่อง')),
    ]);
    if (request !== memsLoadUnkeyedStatistics.request) return;
    const data = memsSummarizeUnkeyed(preparations, returns);
    for (const [id, value] of [['unkeyedBorrow',data.borrow],['unkeyedReturn',data.return],['unkeyedWards',data.wards.length]])
      document.getElementById(id).textContent = value.toLocaleString('th-TH');
    const fill = (id, rows) => {
      const body = document.getElementById(id);
      body.replaceChildren();
      rows.forEach(values => {
        const tr = document.createElement('tr');
        values.forEach(value => { const td = document.createElement('td'); td.textContent = value ?? '—'; tr.append(td); });
        body.append(tr);
      });
    };
    fill('unkeyedWardRows', data.wards.map(row => [row.ward,row.borrow,row.return,row.total]));
    fill('unkeyedIncidentRows', data.incidents.map(row => [
      new Intl.DateTimeFormat('th-TH', {timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(row.date)),
      row.kind === 'borrow' ? 'ไม่คีย์ยืม' : 'ไม่คีย์คืน', row.ward,
      (row.equipment || 'ไม่ระบุ') + ' No.' + (row.number || '—'), row.staff, row.reason,
    ]));
    memsLoadUnkeyedStatistics.latest = { data, month };
    document.getElementById("unkeyedPdfBtn").disabled = !data.incidents.length;
    results.hidden = false;
    status.textContent = data.incidents.length ? 'นับเป็นรายเครื่อง · ' + (month ? 'เดือนที่เลือก' : 'ทุกช่วงเวลา') : 'ไม่พบรายการในช่วงเวลานี้';
  } catch (error) {
    if (request !== memsLoadUnkeyedStatistics.request) return;
    status.textContent = 'โหลดสถิติไม่สำเร็จ: ' + (error.message || error) + ' กรุณากดรีเฟรชอีกครั้ง';
  }
}

async function memsExportUnkeyedPdf() {
  const snapshot = memsLoadUnkeyedStatistics.latest;
  if (!snapshot) return;
  const button = document.getElementById('unkeyedPdfBtn');
  button.disabled = true;
  try {
    const {data,month} = snapshot;
    const doc = await newThaiPdf({orientation:'landscape'});
    const start = rptPdfHeader(doc, 'สถิติหน่วยงานไม่คีย์ยืม–คืนเครื่อง', month ? 'เดือน ' + month : 'ทุกช่วงเวลา', new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}));
    thaiTable(doc, {startY:start,head:[['หน่วยงาน','ไม่คีย์ยืม (เครื่อง)','ไม่คีย์คืน (เครื่อง)','รวม']],body:data.wards.map(r=>[r.ward,r.borrow,r.return,r.total])});
    let noteY = doc.lastAutoTable.finalY + 20;
    if (noteY > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); noteY = 40; }
    doc.setFontSize(11);
    doc.text('ไม่คีย์ยืมนับตามวันที่เตรียมเครื่อง · ไม่คีย์คืนนับตามวันที่ยืนยันคืนเครื่อง',40,noteY);
    doc.addPage();
    doc.setFontSize(16); doc.text('รายละเอียดรายการและเหตุผล',40,40);
    thaiTable(doc, {startY:55,head:[['วันที่','ประเภท','หน่วยงาน','เครื่อง','เจ้าหน้าที่','เหตุผล']],body:data.incidents.map(r=>[
      new Date(r.date).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}),r.kind==='borrow'?'ไม่คีย์ยืม':'ไม่คีย์คืน',r.ward,
      (r.equipment||'—')+' No.'+(r.number||'—'),r.staff||'—',r.reason
    ])});
    rptPdfFooter(doc);
    rptDeliverPdf(doc,'MEMs_Unkeyed_'+(month||'all')+'.pdf',{preview:true});
  } catch(error) { alert('สร้าง PDF ไม่สำเร็จ: '+(error.message||error)); }
  finally { button.disabled = !memsLoadUnkeyedStatistics.latest?.data.incidents.length; }
}
