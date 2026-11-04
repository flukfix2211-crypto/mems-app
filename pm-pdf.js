/* Generate printable A4 inspection reports from immutable MEMs snapshots. */
async function memsExportInspectionPdf(reports) {
  if (!reports.length) throw new Error('เลือกรายงานที่จะพิมพ์');
  const doc = await newThaiPdf({unit:'pt',format:'a4',compress:true});
  const pageLabels = [];
  for (let index=0;index<reports.length;index++) {
    const report=reports[index], s=report.snapshot, p=report.payload;
    if(index)doc.addPage();
    const firstPage=doc.getNumberOfPages();
    const color=report.kind==='pm'?[20,110,75]:[8,104,151];
    const identifier=s.no?'No.'+s.no:'S/N '+(s.serial_number||p.serial_number||'—');
    const label=(s.equipment_type||s.tool_type||'เครื่องมือ')+' · '+identifier;
    doc.setFont(PDF_FONT);doc.setTextColor(...color);doc.setFontSize(19);
    if(doc.__memsLogoDataUrl)doc.addImage(doc.__memsLogoDataUrl,'PNG',40,30,46,46,'mems-logo');
    doc.text(report.kind==='pm'?'PREVENTIVE MAINTENANCE REPORT':'ใบตรวจรับเครื่องมือแพทย์รับใหม่',98,46);
    doc.setFontSize(12);doc.text('ศูนย์เครื่องมือแพทย์ โรงพยาบาลพหลพลพยุหเสนา',98,64);
    doc.setFontSize(10);doc.text('MEMs — Medical Equipment Management Systems',98,78);
    doc.setDrawColor(...color);doc.line(40,92,555,92);
    const ids=[s.asset_id?'ID '+s.asset_id:'',s.asset_code||''].filter(Boolean).join(' / ')||'—';
    const options={headStyles:{fillColor:color,cellPadding:5},styles:{fontSize:12,cellPadding:4},margin:{top:48,bottom:52}};
    thaiTable(doc,{...options,startY:105,head:[['ชนิดเครื่องมือ / TYPE','ยี่ห้อ / BRAND','รุ่น / MODEL']],body:[[s.tool_type||s.equipment_type,s.brand||'—',s.model||'—']],columnStyles:{0:{cellWidth:175},1:{cellWidth:170},2:{cellWidth:170}}});
    thaiTable(doc,{...options,startY:doc.lastAutoTable.finalY+6,head:[['No. / S/N','ID / เลขครุภัณฑ์','หน่วยงาน / SECTION']],body:[[s.equipment_type+' · '+identifier+(s.no&&s.serial_number?'\nS/N '+s.serial_number:''),ids,p.section]],columnStyles:{0:{cellWidth:175},1:{cellWidth:170},2:{cellWidth:170}}});
    const checks=MemsPM.fields(report.kind).map(f=>[f,p.results?.[f]||'—']);
    if(report.kind==='pm')checks.push(['เปลี่ยนวัสดุตามอายุงาน',p.replacement||'ไม่มี']);
    thaiTable(doc,{...options,startY:doc.lastAutoTable.finalY+12,head:[['รายการตรวจ','ผลตรวจ']],body:checks,columnStyles:{0:{cellWidth:365},1:{cellWidth:150}},rowPageBreak:'avoid'});
    thaiTable(doc,{...options,startY:doc.lastAutoTable.finalY+12,head:[['หมายเหตุรายเครื่อง']],body:[[p.note||'—']],styles:{fontSize:12,overflow:'linebreak'}});
    let y=doc.lastAutoTable.finalY+22;
    doc.setTextColor(25,50,60);doc.setFontSize(13);
    const date=new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'long'}).format(new Date(new Date(report.report_date).toISOString().slice(0,10)+'T12:00:00+07:00'));
    const signer=doc.splitTextToSize((report.kind==='pm'?'ผู้ปฏิบัติงาน: ':'ผู้ตรวจรับ: ')+p.operator,500);
    if(y+signer.length*16+38>doc.internal.pageSize.getHeight()-58){doc.addPage();y=65;}
    doc.text(signer,40,y);y+=signer.length*16;
    doc.text('วันที่ '+date,40,y);doc.text('ลงชื่อ ........................................................',320,y+23);
    doc.setFontSize(10);doc.text('ชื่อผู้ตรวจที่บันทึกใน MEMs · ช่องลงนามจริง',320,y+38);
    for(let page=firstPage;page<=doc.getNumberOfPages();page++)pageLabels[page]={label,id:report.id,continued:page!==firstPage};
  }
  const total=doc.getNumberOfPages();
  for(let i=1;i<=total;i++){
    doc.setPage(i);doc.setFont(PDF_FONT);doc.setTextColor(85,111,120);doc.setFontSize(9);
    const entry=pageLabels[i];
    if(entry.continued)doc.text(doc.splitTextToSize(entry.label+' (ต่อ)',500),40,25);
    doc.text(doc.splitTextToSize('MEMs · '+entry.label,420)[0],40,doc.internal.pageSize.getHeight()-32);
    doc.text('หน้า '+i+' / '+total,555,doc.internal.pageSize.getHeight()-32,{align:'right'});
    doc.text('เลขรายงาน '+entry.id,40,doc.internal.pageSize.getHeight()-19);
  }
  const label=new Set(reports.map(r=>r.kind)).size>1?'Inspections':reports[0].kind==='pm'?'PM':'Acceptance';
  return rptDeliverPdf(doc,'MEMs_'+label+'_'+new Date(reports[0].report_date).toISOString().slice(0,10)+'_'+reports.length+'_machines.pdf',{preview:true});
}
