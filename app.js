
const DB_NAME = "control_repartos_local";
const DB_VERSION = 1;
const STORES = ["jornadas","guias","repartidores","arqueos","cierres","eventos"];
let db, pendingImport=null, pendingReturnGuide=null, lastAuditRepId=null, lastAuditDate=null, lastAssignmentDate=null, lastDashboardDate=null, lastGuideDate=null, guideTraceTarget=null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const todayISO = () => {
  const d=new Date(), off=d.getTimezoneOffset();
  return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
};
const money = n => new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(n||0));
const fmtDate = s => s ? new Date(s+"T00:00:00").toLocaleDateString("es-CO") : "—";
const nowISO = () => new Date().toISOString();
const norm = v => String(v??"").trim().replace(/\s+/g," ");
const normGuide = v => norm(v).replace(/[^A-Z0-9]/gi,"").toUpperCase();
const normPlanilla = v => { const d=String(v??"").replace(/\D/g,""); return d || norm(v); };
const uid = (p="ID") => p+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);
const esc = s => String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));

function toast(msg,type="ok"){
  const e=document.createElement("div"); e.className="toast "+type; e.textContent=msg;
  $("#toast").appendChild(e); setTimeout(()=>e.remove(),3200);
}
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const d=r.result;
      if(!d.objectStoreNames.contains("jornadas")) d.createObjectStore("jornadas",{keyPath:"id"});
      if(!d.objectStoreNames.contains("guias")){
        const s=d.createObjectStore("guias",{keyPath:"id"});
        s.createIndex("numeroGuia","numeroGuia",{unique:false});
        s.createIndex("jornadaId","jornadaId",{unique:false});
        s.createIndex("repartidorId","repartidorId",{unique:false});
      }
      if(!d.objectStoreNames.contains("repartidores")) d.createObjectStore("repartidores",{keyPath:"id"});
      if(!d.objectStoreNames.contains("arqueos")) d.createObjectStore("arqueos",{keyPath:"id"});
      if(!d.objectStoreNames.contains("cierres")) d.createObjectStore("cierres",{keyPath:"id"});
      if(!d.objectStoreNames.contains("eventos")) d.createObjectStore("eventos",{keyPath:"id"});
    };
    r.onsuccess=()=>{db=r.result;res(db)}; r.onerror=()=>rej(r.error);
  });
}
function tx(store,mode="readonly"){return db.transaction(store,mode).objectStore(store)}
function getAll(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function getOne(store,id){return new Promise((res,rej)=>{const r=tx(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(store,obj){return new Promise((res,rej)=>{const r=tx(store,"readwrite").put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error)})}
function del(store,id){return new Promise((res,rej)=>{const r=tx(store,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function bulkPut(store,items){
  return new Promise((res,rej)=>{
    const t=db.transaction(store,"readwrite"), s=t.objectStore(store);
    items.forEach(x=>s.put(x)); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error);
  });
}
async function logEvent(tipo,detalle,guiaId=null,jornadaId=null){
  await put("eventos",{id:uid("EV"),tipo,detalle,guiaId,jornadaId,fecha:nowISO()});
}

async function normalizeExistingGuides(){
  const gs=await getAll("guias"), changed=[];
  for(const g of gs){
    const normalized=normGuide(g.numeroGuia);
    if(normalized && normalized!==g.numeroGuia){
      if(!g.numeroGuiaOriginal) g.numeroGuiaOriginal=g.numeroGuia;
      g.numeroGuia=normalized; changed.push(g);
    }
  }
  if(changed.length) await bulkPut("guias",changed);
}


async function jornadasPorFechaOperacion(fecha=todayISO()){
  return (await getAll("jornadas")).filter(j=>j.fechaPlanilla===fecha);
}

async function guiasPorFechaOperacion(fecha=todayISO()){
  const jornadas=await jornadasPorFechaOperacion(fecha);
  const ids=new Set(jornadas.map(j=>j.id));
  return (await getAll("guias")).filter(g=>ids.has(g.jornadaId));
}

async function currentJornada(){
  const js=await getAll("jornadas");
  return js.filter(j=>j.fechaPlanilla===todayISO()).sort((a,b)=>b.importadoEn.localeCompare(a.importadoEn))[0] || js.filter(j=>j.estado==="ABIERTA").sort((a,b)=>b.importadoEn.localeCompare(a.importadoEn))[0] || null;
}
async function guidesForJornada(jid){return (await getAll("guias")).filter(g=>g.jornadaId===jid)}
async function autoAdvance(){
  const js=await getAll("jornadas"), gs=await getAll("guias"), today=todayISO();
  const map=new Map(js.map(j=>[j.id,j]));
  const changed=[];
  for(const g of gs){
    const j=map.get(g.jornadaId);
    if(j && j.fechaPlanilla===today && g.repartidorId && g.estado==="ASIGNADO"){
      g.estado="EN_REPARTO"; g.enRepartoEn=nowISO(); changed.push(g);
    }
  }
  if(changed.length) await bulkPut("guias",changed);
}
function statusBadge(s){return `<span class="badge ${s}">${esc(s.replaceAll("_"," "))}</span>`}
async function hasOpenOrClosedCaja(fecha,repartidorId){
  const js=await getAll("jornadas");
  const jornada=js.find(j=>j.fechaPlanilla===fecha);
  if(!jornada) return null;
  return (await getAll("cierres")).find(c=>c.jornadaId===jornada.id && c.repartidorId===repartidorId) || null;
}


const viewInfo={
 dashboard:["Dashboard","Resumen operativo de la jornada"],
 importar:["Importar jornada","Cargar la planilla diaria de reparto"],
 guias:["Guías","Consulta y seguimiento de paquetes"],
 repartidores:["Repartidores","Base local de repartidores"],
 asignacion:["Asignaciones","Asignación física mediante lector de código de barras"],
 arqueo:["Arqueo","Lectura de devoluciones y confirmación masiva de entregas"],
 cierre:["Cierre de caja","Recaudo y legalización por repartidor"],
 historico:["Histórico","Jornadas y resultados anteriores"],
 backup:["Copias de seguridad","Exportar y restaurar información local"]
};
async function navigate(v){
  $$(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  $$(".view").forEach(x=>x.classList.remove("active"));
  $("#view-"+v).classList.add("active");
  $("#pageTitle").textContent=viewInfo[v][0]; $("#pageSubtitle").textContent=viewInfo[v][1];
  await autoAdvance(); await render(v);
}
$("#nav").addEventListener("click",e=>{const b=e.target.closest(".nav");if(b)navigate(b.dataset.view)});

async function render(v){
  if(v==="dashboard") return renderDashboard();
  if(v==="importar") return renderImport();
  if(v==="guias") return renderGuias();
  if(v==="repartidores") return renderRepartidores();
  if(v==="asignacion") return renderAsignacion();
  if(v==="arqueo") return renderArqueo();
  if(v==="cierre") return renderCierre();
  if(v==="historico") return renderHistorico();
  if(v==="backup") return renderBackup();
}

async function getJornadasByDate(fecha){
  const js=await getAll("jornadas");
  return js.filter(j=>j.fechaPlanilla===fecha).sort((a,b)=>a.numeroPlanilla.localeCompare(b.numeroPlanilla));
}

async function renderDashboard(){
  const root=$("#view-dashboard");
  const allDates=(await getAll("jornadas")).map(j=>j.fechaPlanilla).filter(Boolean).sort();
  const fecha=lastDashboardDate || todayISO();
  const allJornadas=await getJornadasByDate(fecha);
  const selected=(window.dashboardPlanillaFilter && allJornadas.some(j=>j.id===window.dashboardPlanillaFilter)) ? window.dashboardPlanillaFilter : "TODAS";
  const jornadas=selected==="TODAS" ? allJornadas : allJornadas.filter(j=>j.id===selected);

  let gs=[];
  for(const j of jornadas) gs.push(...await guidesForJornada(j.id));

  const reps=await getAll("repartidores");
  const cierres=await getAll("cierres");
  const count=s=>gs.filter(g=>g.estado===s).length;
  const total=gs.length;
  const valor=gs.reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
  const entregadas=gs.filter(g=>g.estado==="ENTREGADO");
  const dev=gs.filter(g=>g.estado==="DEVUELTO");
  const rec=entregadas.reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
  const devVal=dev.reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
  const efectivo=gs.filter(g=>["Efectivo","EFECTIVO"].includes(g.medioPago)).reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
  const transferencia=gs.filter(g=>["Transferencia","TRANSFERENCIA"].includes(g.medioPago)).reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
  const linkPago=gs.filter(g=>["LINK_PAGO","Link de Pago"].includes(g.medioPago)).reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
  const cajasCerradas=new Set(cierres.filter(c=>jornadas.some(j=>j.id===c.jornadaId)).map(c=>c.repartidorId)).size;
  const totalCajas=new Set(gs.filter(g=>g.repartidorId).map(g=>g.repartidorId)).size;
  const rm=new Map(reps.map(r=>[r.id,r]));
  const repIds=[...new Set(gs.filter(g=>g.repartidorId).map(g=>g.repartidorId))];
  const repStats=repIds.map(rid=>{
    const a=gs.filter(g=>g.repartidorId===rid);
    return {nombre:rm.get(rid)?.nombre||rid,total:a.length,pendientes:a.filter(g=>!['ENTREGADO','DEVUELTO'].includes(g.estado)).length,entregadas:a.filter(g=>g.estado==='ENTREGADO').length,devueltas:a.filter(g=>g.estado==='DEVUELTO').length,valor:a.reduce((x,g)=>x+Number(g.valorRecaudo||0),0),caja: cierres.some(c=>c.repartidorId===rid && jornadas.some(j=>j.id===c.jornadaId))};
  }).sort((a,b)=>b.total-a.total);
  const planStats=await Promise.all(jornadas.map(async j=>{const a=await guidesForJornada(j.id);return {planilla:j.numeroPlanilla,id:j.id,total:a.length,entregadas:a.filter(g=>g.estado==='ENTREGADO').length,devueltas:a.filter(g=>g.estado==='DEVUELTO').length,valor:a.reduce((x,g)=>x+Number(g.valorRecaudo||0),0)}}));

  root.innerHTML=`
  <div class="card">
    <div class="toolbar">
      <label>Fecha operación
        <input type="date" id="dashDate" value="${fecha}">
      </label>
      <label class="grow">Vista de planillas
        <select id="dashPlanilla" ${allJornadas.length?'':'disabled'}>
          <option value="TODAS">Todas las planillas de la fecha</option>
          ${allJornadas.map(j=>`<option value="${j.id}" ${selected===j.id?'selected':''}>Planilla ${esc(j.numeroPlanilla)}</option>`).join('')}
        </select>
      </label>
    </div>
    ${allJornadas.length
      ? `<div class="notice"><strong>${selected==='TODAS'?'Consolidado de la fecha':'Planilla seleccionada'}</strong> · ${jornadas.length} planilla(s) · ${fmtDate(fecha)}</div>`
      : `<div class="notice warning"><strong>Sin planillas para la fecha seleccionada.</strong> El Dashboard queda disponible para consultar otra Fecha de operación.</div>`}
  </div>

  <div class="grid kpis" style="margin-top:16px">
    <div class="card kpi"><div class="label">TOTAL GUÍAS</div><div class="value">${total}</div><div class="meta">${allJornadas.length?'Todas las planillas seleccionadas':'Sin operación registrada'}</div></div>
    <div class="card kpi"><div class="label">ENTREGADAS</div><div class="value">${count('ENTREGADO')}</div><div class="meta">${total?Math.round(count('ENTREGADO')/total*100):0}% operación</div></div>
    <div class="card kpi"><div class="label">DEVUELTAS</div><div class="value">${count('DEVUELTO')}</div><div class="meta">${money(devVal)}</div></div>
    <div class="card kpi"><div class="label">RECAUDO</div><div class="value" style="font-size:23px">${money(valor)}</div><div class="meta">${money(rec)} recuperado</div></div>
  </div>

  <div class="grid two" style="margin-top:16px">
    <div class="card"><h3>Resumen por planilla</h3><div class="table-wrap"><table><thead><tr><th>Planilla</th><th>Guías</th><th>Entregadas</th><th>Devueltas</th><th>Valor</th></tr></thead><tbody>${planStats.length?planStats.map(p=>`<tr><td>${esc(p.planilla)}</td><td>${p.total}</td><td>${p.entregadas}</td><td>${p.devueltas}</td><td class="money">${money(p.valor)}</td></tr>`).join(''):`<tr><td colspan="5" class="center muted">No hay planillas para esta fecha.</td></tr>`}</tbody></table></div></div>
    <div class="card"><h3>Estado de guías</h3>${[['PENDIENTE','Pendiente'],['ASIGNADO','Asignado'],['EN_REPARTO','En reparto'],['ENTREGADO','Entregado'],['DEVUELTO','Devuelto']].map(([st,l])=>{const n=count(st),pct=total?Math.round(n/total*100):0;return `<div class="status-progress"><div class="status-title"><span>${statusBadge(st)}</span><strong>${n}</strong></div><div class="progress-track"><div class="progress-fill ${st.toLowerCase()}" style="width:${pct}%"></div></div></div>`}).join('')}</div>
  </div>

  <div class="card" style="margin-top:16px"><h3>Control financiero</h3><div class="finance-list">
    <div class="split"><span>Valor bajo responsabilidad</span><strong>${money(valor)}</strong></div>
    <div class="split"><span>Efectivo</span><strong>${money(efectivo)}</strong></div>
    <div class="split"><span>Transferencia</span><strong>${money(transferencia)}</strong></div>
    <div class="split"><span>Link de Pago</span><strong>${money(linkPago)}</strong></div>
    <div class="split"><span>Devoluciones</span><strong>${money(devVal)}</strong></div>
    <div class="split"><span>Cajas cerradas</span><strong>${cajasCerradas} / ${totalCajas}</strong></div>
  </div></div>

  <div class="card" style="margin-top:16px"><h3>Control por repartidor</h3><div class="table-wrap"><table><thead><tr><th>Repartidor</th><th>Total</th><th>Pendientes</th><th>Entregadas</th><th>Devueltas</th><th>Valor</th><th>Caja</th></tr></thead><tbody>${repStats.length?repStats.map(r=>`<tr><td><strong>${esc(r.nombre)}</strong></td><td>${r.total}</td><td>${r.pendientes}</td><td>${r.entregadas}</td><td>${r.devueltas}</td><td class="money">${money(r.valor)}</td><td>${r.caja?'<span class="badge CERRADA">CERRADA</span>':'<span class="badge PENDIENTE">PENDIENTE</span>'}</td></tr>`).join(''):`<tr><td colspan="7" class="center muted">Sin asignaciones para esta fecha.</td></tr>`}</tbody></table></div></div>`;

  $('#dashDate').onchange=async e=>{lastDashboardDate=e.target.value||todayISO();window.dashboardPlanillaFilter='TODAS';await renderDashboard()};
  $('#dashPlanilla')?.addEventListener('change',e=>{window.dashboardPlanillaFilter=e.target.value;renderDashboard()});
}

function excelDate(v){
  if(v instanceof Date) return v.toISOString().slice(0,10);
  if(typeof v==="number" && v>20000){
    const d=XLSX.SSF.parse_date_code(v); if(d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  const s=norm(v);
  let m=s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  m=s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  return m?`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`:"";
}
function findLabelValue(rows,label){
  const target=label.toUpperCase();
  for(let r=0;r<Math.min(rows.length,45);r++){
    for(let c=0;c<(rows[r]||[]).length;c++){
      if(norm(rows[r][c]).toUpperCase().replace(":","")===target.replace(":","")){
        for(let dx=1;dx<=5;dx++){const v=rows[r]?.[c+dx];if(norm(v)) return v}
        for(let dy=1;dy<=2;dy++){const v=rows[r+dy]?.[c];if(norm(v)) return v}
      }
    }
  } return "";
}
function findExpectedGuideCount(rows){
  for(let r=0;r<rows.length;r++){
    const row=rows[r]||[];
    for(let c=0;c<row.length;c++){
      const label=norm(row[c]).toUpperCase().replace(/[:]/g,"").trim();
      if(label==="CANTIDAD DE GUIAS"){
        for(let dx=1;dx<=12;dx++){
          const v=row[c+dx];
          if(typeof v==="number" && Number.isFinite(v) && v>=0) return Math.round(v);
          const n=Number(String(v??"").replace(/[^\d.-]/g,""));
          if(Number.isFinite(n) && String(v??"").trim()!=="") return Math.round(n);
        }
      }
    }
  }
  return null;
}

function parseMoneyValue(v){
  if(typeof v==="number" && Number.isFinite(v)) return v;

  let clean=String(v??"")
    .trim()
    .replace(/\s/g,"")
    .replace(/[^\d,.\-]/g,"");

  if(!clean || clean==="-" || clean==="." || clean===",") return 0;

  const negative=clean.startsWith("-");
  clean=clean.replace(/-/g,"");

  const dots=(clean.match(/\./g)||[]).length;
  const commas=(clean.match(/,/g)||[]).length;
  let normalized=clean;

  if(dots && commas){
    const lastDot=clean.lastIndexOf(".");
    const lastComma=clean.lastIndexOf(",");
    const decimalSep=lastDot>lastComma?".":",";
    const thousandsSep=decimalSep==="."?",":".";
    const decimals=clean.length-clean.lastIndexOf(decimalSep)-1;

    if(decimals===1 || decimals===2){
      normalized=clean.split(thousandsSep).join("");
      normalized=normalized.replace(decimalSep,".");
    }else{
      normalized=clean.replace(/[.,]/g,"");
    }
  }else if(dots || commas){
    const sep=dots?".":",";
    const parts=clean.split(sep);

    if(parts.length>2){
      const allThousands=parts.slice(1).every(p=>p.length===3);
      normalized=allThousands ? parts.join("") : parts[0]+"."+parts.slice(1).join("");
    }else{
      const decimals=parts[1]?.length ?? 0;
      if(decimals===3){
        normalized=parts.join("");
      }else if(decimals===1 || decimals===2){
        normalized=parts[0]+"."+parts[1];
      }else{
        normalized=parts.join("");
      }
    }
  }

  const result=Number(normalized);
  if(!Number.isFinite(result)) return 0;
  return negative ? -result : result;
}

function parsePlanilla(workbook){
  const ws=workbook.Sheets[workbook.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});

  let hr=-1, guideCol=-1;
  for(let r=0;r<rows.length;r++){
    const caps=(rows[r]||[]).map(x=>norm(x).toUpperCase());
    const gc=caps.findIndex(x=>x==="GUIA");
    if(gc>=0 && caps.some(x=>x.includes("FLETE C.E"))){
      hr=r;
      guideCol=gc;
      break;
    }
  }
  if(hr<0 || guideCol<0) throw new Error("No se encontró la fila de encabezados (GUIA / FLETE C.E).");

  /*
   * Los XLS generados por Crystal Decisions pueden incluir columnas auxiliares antes
   * de la guía (ej. OP****, RR, CE). Por eso NO se toma la primera celda poblada.
   * La columna de GUIA se obtiene del encabezado y desde allí se identifican las
   * diez columnas reales del detalle.
   */
  let detailCols=null;
  for(let r=hr+1;r<rows.length;r++){
    const row=rows[r]||[];
    const rawGuide=row[guideCol];
    const numero=normGuide(rawGuide);
    if(!numero || !/^\d{8,}$/.test(numero)) continue;

    const cols=[];
    for(let c=guideCol;c<row.length;c++){
      const v=row[c];
      if(v!=="" && v!==null && v!==undefined) cols.push(c);
    }
    if(cols.length>=10){
      detailCols=cols.slice(0,10);
      break;
    }
  }
  if(!detailCols || detailCols.length<10){
    throw new Error("No se pudo identificar la estructura de las filas de detalle.");
  }

  const guias=[];
  const seen=new Set();

  for(let r=hr+1;r<rows.length;r++){
    const row=rows[r]||[];
    const rawGuide=row[guideCol];
    const numero=normGuide(rawGuide);

    if(!numero || !/^\d{8,}$/.test(numero)) continue;
    if(seen.has(numero)) continue;

    const values=detailCols.map(c=>row[c] ?? "");

    // Una fila de detalle debe contener una guía válida; el resto de campos puede
    // venir vacío, pero mantiene siempre sus columnas estructurales.
    guias.push({
      numeroGuia:numero,
      numeroGuiaOriginal:norm(rawGuide),
      servicio:norm(values[1]),
      remitente:norm(values[2]),
      destinatario:norm(values[3]),
      direccion:norm(values[4]),
      ciudad:norm(values[5]),
      unidades:Number(values[6]||0)||0,
      pesoReal:Number(values[7]||0)||0,
      pesoVol:Number(values[8]||0)||0,
      valorRecaudo:parseMoneyValue(values[9])
    });
    seen.add(numero);
  }

  const planilla=normPlanilla(findLabelValue(rows,"Planilla Reparto"));
  const fecha=excelDate(findLabelValue(rows,"Fecha Planilla"));
  const tercero=norm(findLabelValue(rows,"Tercero"));
  const regional=norm(findLabelValue(rows,"Regional"));
  const placa=norm(findLabelValue(rows,"Placa"));
  const cantidadEsperada=findExpectedGuideCount(rows);
  const recaudoTotal=guias.reduce((a,g)=>a+Number(g.valorRecaudo||0),0);

  return {
    numeroPlanilla:planilla,
    fechaPlanilla:fecha,
    tercero,
    regional,
    placa,
    guias,
    cantidadEsperada,
    recaudoTotal
  };
}

function pdfItemData(item){
  return {
    text:norm(item.str),
    x:Number(item.transform?.[4]||0),
    y:Number(item.transform?.[5]||0),
    width:Number(item.width||0)
  };
}
function samePdfRow(items,y,tol=2.2){
  return items.filter(i=>Math.abs(i.y-y)<=tol);
}
function pdfTextInRange(row,x0,x1){
  return row.filter(i=>i.x>=x0 && i.x<x1 && i.text).sort((a,b)=>a.x-b.x).map(i=>i.text).join(" ").trim();
}
function pdfNumericAt(row,x0,x1,target){
  const valid=row.filter(i=>i.x>=x0 && i.x<=x1 && /^[\d.,]+$/.test(i.text));
  if(!valid.length) return "";
  return valid.sort((a,b)=>Math.abs(a.x-target)-Math.abs(b.x-target))[0].text;
}
async function parsePdfPlanilla(file){
  if(typeof pdfjsLib==="undefined") throw new Error("No fue posible cargar el lector PDF. Verifique la conexión a Internet e intente nuevamente.");
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const doc=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const pages=[];
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p);
    const content=await page.getTextContent();
    pages.push(content.items.map(pdfItemData).filter(i=>i.text));
  }
  const first=pages[0]||[];
  const all=pages.flat();

  const nearestRight=(items,labelRegex,maxDy=3)=>{
    const label=items.find(i=>labelRegex.test(i.text));
    if(!label) return "";
    const candidates=items.filter(i=>i.x>label.x+label.width-2 && Math.abs(i.y-label.y)<=maxDy && i.text);
    return candidates.sort((a,b)=>a.x-b.x)[0]?.text||"";
  };

  let numeroPlanilla=normPlanilla(nearestRight(first,/^Planilla Reparto$/i));
  let fechaPlanilla=excelDate(nearestRight(first,/^Fecha Planilla$/i));
  let placa=nearestRight(first,/^Placa$/i);
  let regional=nearestRight(first,/^Regional$/i);
  let tercero="";
  const terceroLabel=first.find(i=>/^Tercero:?$/i.test(i.text));
  if(terceroLabel){
    const rr=samePdfRow(first,terceroLabel.y,3).filter(i=>i.x>terceroLabel.x).sort((a,b)=>a.x-b.x);
    tercero=rr.slice(1).map(i=>i.text).join(" ").trim();
  }

  // Fallbacks por texto si el PDF agrupa etiqueta y valor en un mismo item.
  const joined=all.map(i=>i.text).join(" ");
  if(!numeroPlanilla){ const m=joined.match(/Planilla Reparto\s*([\d,]+)/i); if(m) numeroPlanilla=normPlanilla(m[1]); }
  if(!fechaPlanilla){ const m=joined.match(/Fecha Planilla\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i); if(m) fechaPlanilla=excelDate(m[1]); }

  const guias=[];
  const seen=new Set();
  const guidePattern=/^\d{2}-\d-\d{9}$/;

  // Las páginas finales de resumen no tienen guías, por eso se recorren todas sin problema.
  for(const items of pages){
    const guideItems=items.filter(i=>guidePattern.test(i.text));
    for(const gi of guideItems){
      const numero=normGuide(gi.text);
      if(seen.has(numero)) continue;
      const row=samePdfRow(items,gi.y,2.4);

      const servicio=pdfTextInRange(row,120,155).match(/\b(PT|DE)\b/i)?.[1]||pdfTextInRange(row,120,155);
      const remitente=pdfTextInRange(row,155,285);
      const destinatario=pdfTextInRange(row,285,430);
      const direccion=pdfTextInRange(row,430,560);
      let ciudad=pdfTextInRange(row,555,645);
      if(/VALLEDUPAR/i.test(row.map(i=>i.text).join(" "))) ciudad="VALLEDUPAR";

      const unidades=parseMoneyValue(pdfNumericAt(row,642,662,650));
      const pesoReal=parseMoneyValue(pdfNumericAt(row,672,692,680));
      const pesoVol=parseMoneyValue(pdfNumericAt(row,702,722,710));
      const fleteText=pdfNumericAt(row,732,766,739);
      const valorRecaudo=parseMoneyValue(fleteText);

      guias.push({
        numeroGuia:numero,
        numeroGuiaOriginal:gi.text,
        servicio:norm(servicio),
        remitente:norm(remitente),
        destinatario:norm(destinatario),
        direccion:norm(direccion),
        ciudad:norm(ciudad),
        unidades:Number(unidades||0),
        pesoReal:Number(pesoReal||0),
        pesoVol:Number(pesoVol||0),
        valorRecaudo:Number(valorRecaudo||0)
      });
      seen.add(numero);
    }
  }

  let cantidadEsperada=null, totalEsperado=null;
  const last=pages[pages.length-1]||[];
  const countLabel=last.find(i=>/^Cantidad de Guias$/i.test(i.text));
  if(countLabel){
    const row=samePdfRow(last,countLabel.y,3).filter(i=>i.x>countLabel.x && /^[\d,.]+$/.test(i.text)).sort((a,b)=>a.x-b.x);
    if(row.length) cantidadEsperada=Math.round(parseMoneyValue(row[0].text));
  }
  const totalLabel=last.find(i=>/^TOTAL$/i.test(i.text));
  if(totalLabel){
    const row=samePdfRow(last,totalLabel.y,3).filter(i=>i.x>totalLabel.x && /^[\d,.]+$/.test(i.text)).sort((a,b)=>b.x-a.x);
    if(row.length) totalEsperado=parseMoneyValue(row[0].text);
  }
  // Fallbacks específicos del resumen textual.
  if(cantidadEsperada===null){ const m=joined.match(/Cantidad de Guias\s+(\d+)/i); if(m) cantidadEsperada=Number(m[1]); }
  if(totalEsperado===null){
    const m=joined.match(/TOTAL\s+\d+\s+\d+\s+\d+\s+([\d,]+)/i);
    if(m) totalEsperado=parseMoneyValue(m[1]);
  }

  const recaudoTotal=guias.reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
  return {numeroPlanilla,fechaPlanilla,tercero,regional,placa,guias,cantidadEsperada,recaudoTotal,totalEsperado,origen:"PDF"};
}

async function renderImport(){
  $("#view-importar").innerHTML=`
  <div class="grid two">
    <div class="card">
      <h2>Cargar planilla diaria</h2>
      <div class="import-drop">
        <strong>Seleccione la planilla .xls, .xlsx o .pdf</strong>
        <p class="muted">El sistema detectará Fecha Planilla, Planilla Reparto, guías y FLETE C.E. automáticamente.</p>
        <input type="file" id="planillaFile" accept=".xls,.xlsx,.pdf,application/pdf">
      </div>
      <div id="importPreview"></div>
    </div>
    <div class="card">
      <h3>Validaciones automáticas</h3>
      <p>✓ Excel y PDF de la planilla de reparto</p>
      <p>✓ Duplicado por Fecha Planilla + Planilla Reparto</p>
      <p>✓ Cantidad de guías contra el total del documento</p>
      <p>✓ Total FLETE C.E cuando el PDF lo informa</p>
      <p>✓ Guías normalizadas para lector de código de barras</p>
      <p>✓ Conservación de la operación existente al actualizar</p>
      <div class="notice warning" style="margin-top:18px">Los lectores de Excel/PDF se cargan desde Internet. Después de importar, la jornada y toda la operación permanecen almacenadas localmente.</div>
    </div>
  </div>`;
  $("#planillaFile").onchange=handlePlanillaFile;
}
async function handlePlanillaFile(e){
  const f=e.target.files[0]; if(!f)return;
  const preview=$("#importPreview");
  preview.innerHTML=`<div class="notice" style="margin-top:14px">Leyendo y validando ${esc(f.name)}...</div>`;
  try{
    const ext=(f.name.split(".").pop()||"").toLowerCase();
    let data;
    if(ext==="pdf" || f.type==="application/pdf"){
      data=await parsePdfPlanilla(f);
    }else if(ext==="xls" || ext==="xlsx"){
      if(typeof XLSX==="undefined") throw new Error("No fue posible cargar el lector de Excel. Verifique la conexión a Internet e intente nuevamente.");
      const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});
      data=parsePlanilla(wb); data.origen="EXCEL";
    }else{
      throw new Error("Formato no permitido. Utilice .xls, .xlsx o .pdf.");
    }

    data.numeroPlanilla=normPlanilla(data.numeroPlanilla);
    if(!data.numeroPlanilla) throw new Error("No se pudo identificar el número de Planilla Reparto.");
    if(!data.fechaPlanilla) throw new Error("No se pudo identificar la Fecha Planilla.");
    if(!data.guias.length) throw new Error("No se encontraron guías válidas.");

    const jid=`${data.fechaPlanilla}__${data.numeroPlanilla}`;
    const exists=await getOne("jornadas",jid);
    pendingImport={...data,id:jid,fileName:f.name};

    const importCountValid=data.cantidadEsperada===null || data.cantidadEsperada===undefined || data.guias.length===data.cantidadEsperada;
    const totalDetected=data.guias.reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
    const importTotalValid=data.totalEsperado===null || data.totalEsperado===undefined || Math.abs(totalDetected-Number(data.totalEsperado))<1;
    const importValid=importCountValid && importTotalValid;

    preview.innerHTML=`
      <div class="preview-meta">
        <div><small>ORIGEN</small><strong>${esc(data.origen||ext.toUpperCase())}</strong></div>
        <div><small>FECHA PLANILLA</small><strong>${fmtDate(data.fechaPlanilla)}</strong></div>
        <div><small>PLANILLA</small><strong>${esc(data.numeroPlanilla)}</strong></div>
      </div>
      <div class="preview-meta">
        <div><small>GUÍAS DETECTADAS / ESPERADAS</small><strong>${data.guias.length}${data.cantidadEsperada!==null&&data.cantidadEsperada!==undefined?` / ${data.cantidadEsperada}`:""}</strong></div>
        <div><small>FLETE C.E DETECTADO</small><strong>${money(totalDetected)}</strong></div>
        <div><small>FLETE C.E ESPERADO</small><strong>${data.totalEsperado!==null&&data.totalEsperado!==undefined?money(data.totalEsperado):"No informado"}</strong></div>
      </div>
      ${!importCountValid?`<div class="notice danger" style="margin-bottom:10px"><strong>Cantidad incompleta:</strong> el documento reporta ${data.cantidadEsperada} guías y se detectaron ${data.guias.length}.</div>`:""}
      ${!importTotalValid?`<div class="notice danger" style="margin-bottom:10px"><strong>Recaudo inconsistente:</strong> el documento reporta ${money(data.totalEsperado)} y la suma detectada es ${money(totalDetected)}.</div>`:""}
      ${importValid?`<div class="notice" style="margin-bottom:12px"><strong>Validación correcta:</strong> la planilla pasó los controles disponibles.</div>`:""}
      <div class="card" style="box-shadow:none;background:#f8fafc;margin-bottom:12px">
        <small class="muted">Muestra de importación</small>
        <div class="table-wrap" style="margin-top:8px">
          <table><thead><tr><th>Guía</th><th>Destinatario</th><th class="right">FLETE C.E</th></tr></thead>
          <tbody>${data.guias.slice(0,8).map(g=>`<tr><td><strong>${esc(g.numeroGuia)}</strong></td><td>${esc(g.destinatario)}</td><td class="money">${money(g.valorRecaudo)}</td></tr>`).join("")}</tbody></table>
        </div>
      </div>
      ${exists?`<div class="notice warning">Esta jornada ya existe. Puede actualizar los datos originales sin perder asignaciones, estados, devoluciones ni cierres.</div>
       <div style="margin-top:12px"><button id="updateImport" class="btn primary" ${!importValid?"disabled":""}>Actualizar datos desde este archivo</button></div>`:
      `<div class="notice">Revise los datos y confirme la importación.</div>
       <div style="margin-top:12px"><button id="confirmImport" class="btn primary" ${!importValid?"disabled":""}>Importar ${data.guias.length} guías</button></div>`}`;

    if(importValid){
      if(exists) $("#updateImport").onclick=updateExistingImport;
      else $("#confirmImport").onclick=confirmImport;
    }
  }catch(err){ preview.innerHTML=`<div class="notice danger" style="margin-top:14px">${esc(err.message)}</div>`; }
}

async function updateExistingImport(){
  const d=pendingImport;if(!d)return;
  const j=await getOne("jornadas",d.id);if(!j){toast("La jornada ya no existe","err");return}
  const existing=await guidesForJornada(d.id), byGuide=new Map(existing.map(g=>[normGuide(g.numeroGuia),g]));
  const toSave=[];let updated=0,added=0;
  for(const src of d.guias){
    const key=normGuide(src.numeroGuia), old=byGuide.get(key);
    if(old){
      old.numeroGuia=key;old.numeroGuiaOriginal=src.numeroGuiaOriginal||old.numeroGuiaOriginal||key;
      old.servicio=src.servicio;old.remitente=src.remitente;old.destinatario=src.destinatario;old.direccion=src.direccion;old.ciudad=src.ciudad;
      old.unidades=src.unidades;old.pesoReal=src.pesoReal;old.pesoVol=src.pesoVol;old.valorRecaudo=src.valorRecaudo;
      toSave.push(old);updated++;
    }else{
      toSave.push({...src,id:`${d.id}__${key}`,jornadaId:d.id,estado:"PENDIENTE",repartidorId:null,asignadoEn:null,enRepartoEn:null,devueltoEn:null,entregadoEn:null,medioPago:null,motivoDevolucion:null,observacionDevolucion:null,ordenImportacion:existing.length+added+1});added++;
    }
  }
  await bulkPut("guias",toSave);
  j.archivo=d.fileName;j.actualizadoDesdeArchivoEn=nowISO();j.origen=d.origen||j.origen||"EXCEL";await put("jornadas",j);
  await logEvent("ACTUALIZACION_PLANILLA",`Actualizados ${updated} registros y agregados ${added} desde ${d.fileName}`,null,d.id);
  toast(`Datos actualizados: ${updated} guías${added?` · ${added} nuevas`:""}`);pendingImport=null;await navigate("dashboard");
}

async function confirmImport(){
  const d=pendingImport;if(!d)return;
  if(await getOne("jornadas",d.id)){toast("La jornada ya existe","err");return}
  const j={id:d.id,numeroPlanilla:d.numeroPlanilla,fechaPlanilla:d.fechaPlanilla,tercero:d.tercero,regional:d.regional,placa:d.placa,archivo:d.fileName,origen:d.origen||"EXCEL",estado:"ABIERTA",importadoEn:nowISO(),cerradoEn:null};
  await put("jornadas",j);
  const gs=d.guias.map((g,i)=>{const numeroGuia=normGuide(g.numeroGuia);return {...g,numeroGuia,id:`${d.id}__${numeroGuia}`,jornadaId:d.id,estado:"PENDIENTE",repartidorId:null,asignadoEn:null,enRepartoEn:null,devueltoEn:null,entregadoEn:null,medioPago:null,motivoDevolucion:null,observacionDevolucion:null,ordenImportacion:i+1}});
  await bulkPut("guias",gs); await logEvent("IMPORTACION",`Importadas ${gs.length} guías desde ${d.fileName}`,null,d.id);
  toast(`Jornada importada: ${gs.length} guías`); pendingImport=null; await navigate("dashboard");
}

async function renderGuias(){
  const reps=await getAll("repartidores");
  const fechaInicial=lastGuideDate || todayISO();
  const js=await jornadasPorFechaOperacion(fechaInicial);
  js.sort((a,b)=>b.numeroPlanilla.localeCompare(a.numeroPlanilla));
  const root=$("#view-guias");
  root.innerHTML=`
    <div class="card">
      <div class="toolbar">
        <label>Fecha operación
          <input type="date" id="guideDate" value="${fechaInicial}">
        </label>
        <label>Planilla
          <select id="guideJourney" ${js.length?'':'disabled'}>
            ${js.length?`<option value="TODAS">Todas las planillas de la fecha</option>${js.map(j=>`<option value="${j.id}">${fmtDate(j.fechaPlanilla)} · ${esc(j.numeroPlanilla)}</option>`).join('')}`:`<option value="">Sin planillas</option>`}
          </select>
        </label>
        <label class="grow">Filtrar listado
          <input id="guideSearch" placeholder="Guía, destinatario, dirección...">
        </label>
        <button id="openGuideTrace" class="btn primary">Buscar guía</button>
        <label>Estado
          <select id="guideStatus"><option value="">Todos</option>${["PENDIENTE","ASIGNADO","EN_REPARTO","ENTREGADO","DEVUELTO"].map(st=>`<option>${st}</option>`).join("")}</select>
        </label>
      </div>
      <div class="notice">La consulta y búsqueda se realizan sobre todas las planillas de la Fecha de operación seleccionada. Use <strong>Buscar guía</strong> para consultar una guía específica.</div>
      <div id="guideTable" style="margin-top:14px"></div>
    </div>`;
  const update=async()=>{
    const jid=$("#guideJourney").value, q=norm($("#guideSearch").value).toLowerCase(), st=$("#guideStatus").value;
    let gs=await guiasPorFechaOperacion(fechaInicial);
    if(jid && jid!=="TODAS") gs=gs.filter(g=>g.jornadaId===jid);
    if(st)gs=gs.filter(g=>g.estado===st);
    if(q)gs=gs.filter(g=>[g.numeroGuia,g.destinatario,g.direccion,g.remitente,g.ciudad].some(v=>String(v||"").toLowerCase().includes(q)));
    const rm=new Map(reps.map(r=>[r.id,r.nombre]));
    $("#guideTable").innerHTML=gs.length?`<div class="table-wrap"><table><thead><tr><th>Guía</th><th>Estado</th><th>Repartidor</th><th>Destinatario</th><th>Planilla</th><th>Ciudad</th><th class="right">Recaudo</th><th>Acción</th></tr></thead><tbody>${gs.map(g=>{const j=js.find(x=>x.id===g.jornadaId);return `<tr><td><strong>${esc(g.numeroGuia)}</strong></td><td>${statusBadge(g.estado)}</td><td>${esc(rm.get(g.repartidorId)||"—")}</td><td>${esc(g.destinatario)}</td><td>${esc(j?.numeroPlanilla||"—")}</td><td>${esc(g.ciudad||"—")}</td><td class="money">${money(g.valorRecaudo)}</td><td><button class="btn" data-guide-detail="${esc(g.id)}">Ver</button></td></tr>`}).join("")}</tbody></table></div>`:`<div class="empty">No hay registros para la Fecha de operación y filtros seleccionados.</div>`;
    // Delegación de eventos para garantizar que el botón Ver funcione aunque
    // la tabla se haya reconstruido dinámicamente.
    $$('#guideTable [data-guide-detail]').forEach(b=>{
      b.onclick=async e=>{
        e.preventDefault();
        e.stopPropagation();
        try{ await openGuideTrace(b.getAttribute('data-guide-detail')); }
        catch(err){ console.error('Error abriendo detalle de guía:',err); toast('No fue posible abrir los detalles de la guía','err'); }
      };
    });
  };
  $("#guideDate").onchange=async e=>{lastGuideDate=e.target.value||todayISO();await renderGuias()};
  $("#guideJourney").onchange=update;
  $("#guideSearch").oninput=update;
  $("#guideStatus").onchange=update;
  $("#openGuideTrace").onclick=()=>openGuideTrace();
  await update();
}

async function openGuideTrace(guideId=null){
  const fecha=lastGuideDate || $("#guideDate")?.value || todayISO();
  const dialog=$("#guideTraceDialog"), body=$("#guideTraceBody");
  const reps=await getAll("repartidores"), rm=new Map(reps.map(r=>[r.id,r]));
  if(!guideId){
    body.innerHTML=`
      <div class="trace-head"><div><div class="trace-label">CONSULTA DE GUÍA</div><div class="trace-number">Buscar trazabilidad</div><p class="muted" style="margin:6px 0 0">Fecha de operación: <strong>${fmtDate(fecha)}</strong></p></div></div>
      <div class="scan-panel" style="margin-top:18px">
        <label>Número de guía / código de barras
          <input id="traceSearchInput" class="scan-input" autocomplete="off" placeholder="Escanee o digite el número de guía...">
        </label>
        <div id="traceSearchResult" class="scan-result">La búsqueda se realizará en todas las planillas de la Fecha de operación seleccionada.</div>
        <div class="dialog-actions"><button type="button" class="btn ghost" id="traceSearchClose">Cerrar</button><button type="button" class="btn primary" id="traceSearchBtn">Buscar guía</button></div>
      </div>`;
    dialog.showModal();
    const input=$("#traceSearchInput"), result=$("#traceSearchResult");
    const doSearch=async()=>{
      const n=normGuide(input.value);
      if(!n){result.className='scan-result err';result.textContent='Ingrese o escanee un número de guía.';input.focus();return}
      const gs=await guiasPorFechaOperacion(fecha), g=gs.find(x=>normGuide(x.numeroGuia)===n);
      if(!g){result.className='scan-result err';result.textContent=`La guía ${n} no fue encontrada en las planillas de ${fmtDate(fecha)}.`;input.select();return}
      await renderGuideTraceDetail(g,fecha,rm,dialog,body);
    };
    $("#traceSearchBtn").onclick=doSearch;
    $("#traceSearchClose").onclick=()=>dialog.close();
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();doSearch()}};
    setTimeout(()=>input.focus(),60);
    return;
  }
  const g=await getOne("guias",guideId);
  if(!g){toast("Guía no encontrada en la base local","err");return}
  // Si el diálogo quedó abierto por una consulta anterior, se reutiliza de
  // forma segura antes de mostrar nuevamente el detalle.
  if(dialog.open) dialog.close();
  await renderGuideTraceDetail(g,fecha,rm,dialog,body);
  if(!dialog.open) dialog.showModal();
}

async function renderGuideTraceDetail(g,fecha,rm,dialog,body){
  const jornadas=await jornadasPorFechaOperacion(fecha), jornada=jornadas.find(j=>j.id===g.jornadaId);
  const cierres=await getAll("cierres"), cierreRep=jornada?cierres.find(c=>c.jornadaId===jornada.id&&c.repartidorId===g.repartidorId):null;
  const eventos=(await getAll("eventos")).filter(e=>e.guiaId===g.id).sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha)));
  guideTraceTarget=g.id;
  body.innerHTML=`
    <div class="trace-head"><div><div class="trace-label">NÚMERO DE GUÍA</div><div class="trace-number">${esc(g.numeroGuia)}</div></div><div>${statusBadge(g.estado)}</div></div>
    <div class="trace-grid">
      <div><small>Fecha operación</small><strong>${fmtDate(jornada?.fechaPlanilla||fecha)}</strong></div>
      <div><small>Planilla</small><strong>${esc(jornada?.numeroPlanilla||"—")}</strong></div>
      <div><small>Repartidor</small><strong>${esc(rm.get(g.repartidorId)?.nombre||"Sin asignar")}</strong></div>
      <div><small>Teléfono</small><strong>${esc(rm.get(g.repartidorId)?.telefono||"—")}</strong></div>
      <div><small>Destinatario</small><strong>${esc(g.destinatario||"—")}</strong></div>
      <div><small>Ciudad</small><strong>${esc(g.ciudad||"—")}</strong></div>
      <div><small>Valor recaudo</small><strong>${money(g.valorRecaudo)}</strong></div>
      <div><small>Medio de pago</small><strong>${esc(g.medioPago||"Pendiente")}</strong></div>
    </div>
    ${g.estado==='DEVUELTO'?`<div class="notice warning"><strong>Devolución</strong><br>Motivo: ${esc(g.motivoDevolucion||"—")} ${g.observacionDevolucion?`· ${esc(g.observacionDevolucion)}`:""}<br>Legalizada: ${g.devolucionLegalizada?"Sí":"No"}</div>`:""}
    ${cierreRep?`<div class="notice warning"><strong>Caja relacionada:</strong> cerrada el ${new Date(cierreRep.cerradoEn).toLocaleString("es-CO")}.</div>`:""}
    <div><h4 style="margin:0 0 8px">Historial</h4>${eventos.length?`<div class="trace-events">${eventos.map(e=>`<div class="trace-event"><span>${new Date(e.fecha).toLocaleString("es-CO")}</span><strong>${esc(e.tipo)}</strong><p>${esc(e.detalle)}</p></div>`).join("")}</div>`:`<div class="muted">No hay eventos registrados para esta guía.</div>`}</div>
    <div class="dialog-actions"><button type="button" class="btn ghost" id="closeTrace">Cerrar</button><button type="button" class="btn danger" id="setGuidePending" ${g.estado==='PENDIENTE'?'disabled':''}>Cambiar a pendiente</button></div>`;
  $("#closeTrace").onclick=()=>dialog.close();
  $("#setGuidePending").onclick=()=>setGuidePending(g.id);
}

async function setGuidePending(guideId){
  const current=await getOne("guias",guideId);
  if(!current){toast("La guía no existe en la base local","err");return}
  if(current.estado==="PENDIENTE"){toast("La guía ya está en estado Pendiente","err");return}
  const jornadaActual=current.jornadaId?await getOne("jornadas",current.jornadaId):null;
  const fecha=jornadaActual?.fechaPlanilla;
  if(!fecha){toast("No se pudo determinar la Fecha de operación de la guía","err");return}
  const affectedJornadas=await jornadasPorFechaOperacion(fecha);
  const cierres=await getAll("cierres");
  const affectedClosures=current.repartidorId?cierres.filter(c=>c.repartidorId===current.repartidorId && affectedJornadas.some(j=>j.id===c.jornadaId)):[];
  const rep=current.repartidorId?(await getAll("repartidores")).find(r=>r.id===current.repartidorId):null;
  const extra=affectedClosures.length?` Se eliminará ${affectedClosures.length} cierre(s) de caja del repartidor ${rep?.nombre||"seleccionado"} para ${fmtDate(fecha)}.`:"";
  if(!confirm(`¿Cambiar la guía ${current.numeroGuia} a PENDIENTE?${extra}\n\nLa guía quedará sin repartidor, sin medio de pago y sin datos de entrega/devolución.`))return;
  try{
    const oldState=current.estado, oldRep=current.repartidorId;
    current.estado="PENDIENTE";
    current.repartidorId=null;
    current.asignadoEn=null;
    current.enRepartoEn=null;
    current.entregadoEn=null;
    current.devueltoEn=null;
    current.medioPago=null;
    current.motivoDevolucion=null;
    current.observacionDevolucion=null;
    current.devolucionLegalizada=false;
    await put("guias",current);
    for(const c of affectedClosures) await del("cierres",c.id);
    for(const j of affectedJornadas.filter(j=>j.estado==="CERRADA")){
      j.estado="ABIERTA"; j.cerradoEn=null; await put("jornadas",j);
      await logEvent("REAPERTURA_JORNADA",`Jornada reabierta por cambio de guía ${current.numeroGuia} a PENDIENTE`,current.id,j.id);
    }
    await logEvent("CAMBIO_ESTADO",`Guía ${current.numeroGuia}: ${oldState} → PENDIENTE${rep?` · Repartidor anterior: ${rep.nombre}`:""}`,current.id,current.jornadaId);
    for(const c of affectedClosures) await logEvent("REAPERTURA_CAJA",`Cierre eliminado por cambio de guía ${current.numeroGuia} a PENDIENTE`,current.id,c.jornadaId);
    $("#guideTraceDialog").close();
    toast(`Guía ${current.numeroGuia} ahora está PENDIENTE`);
    await renderGuias();
  }catch(err){console.error("Error cambiando guía a pendiente:",err);toast(err?.message||"No fue posible cambiar el estado de la guía","err")}
}

async function renderRepartidores(){
  const reps=(await getAll("repartidores")).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const gs=await getAll("guias");
  $("#view-repartidores").innerHTML=`
    <div class="grid two">
      <div class="card"><h3>Agregar repartidor</h3>
        <form id="repForm" class="grid" style="gap:11px">
          <label>Nombre<input id="repNombre" required></label>
          <label>Identificación<input id="repIdent" required></label>
          <label>Teléfono<input id="repTel"></label>
          <label>Correo<input id="repMail" type="email"></label>
          <button class="btn primary">Guardar repartidor</button>
        </form>
      </div>
      <div class="card"><h3>Base de repartidores</h3>
        ${reps.length?`<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Identificación</th><th>Teléfono</th><th>Guías</th><th></th></tr></thead><tbody>
        ${reps.map(r=>`<tr><td><strong>${esc(r.nombre)}</strong><br><small class="muted">${esc(r.correo||"")}</small></td><td>${esc(r.identificacion)}</td><td>${esc(r.telefono||"—")}</td><td>${gs.filter(g=>g.repartidorId===r.id).length}</td><td><button class="btn" data-editrep="${r.id}">Editar</button> <button class="btn danger" data-delrep="${r.id}">Eliminar</button></td></tr>`).join("")}
        </tbody></table></div>`:`<div class="empty">Aún no hay repartidores registrados.</div>`}
      </div>
    </div>`;
  $("#repForm").onsubmit=async e=>{
    e.preventDefault();const ident=norm($("#repIdent").value);
    if(reps.some(r=>r.identificacion===ident)){toast("Ya existe esa identificación","err");return}
    await put("repartidores",{id:uid("REP"),nombre:norm($("#repNombre").value),identificacion:ident,telefono:norm($("#repTel").value),correo:norm($("#repMail").value),activo:true,creadoEn:nowISO()});
    toast("Repartidor guardado");renderRepartidores();
  };
  $$("[data-editrep]").forEach(b=>b.onclick=async()=>{
    const id=b.dataset.editrep;
    const r=(await getAll("repartidores")).find(x=>x.id===id);
    if(!r)return;
    const nombre=prompt("Nombre:",r.nombre);
    if(nombre===null)return;
    r.nombre=norm(nombre);
    r.telefono=prompt("Teléfono:",r.telefono||"")||"";
    r.correo=prompt("Correo:",r.correo||"")||"";
    await put("repartidores",r);
    toast("Repartidor actualizado");
    renderRepartidores();
  });

  $$("[data-delrep]").forEach(b=>b.onclick=async()=>{
    const id=b.dataset.delrep;if(gs.some(g=>g.repartidorId===id)){toast("No se puede eliminar: tiene guías asociadas","err");return}
    if(confirm("¿Eliminar este repartidor?")){await del("repartidores",id);renderRepartidores()}
  });
}

async function renderAsignacion(){
  const reps=(await getAll('repartidores')).filter(r=>r.activo);
  const fechaInicial=lastAssignmentDate || todayISO();
  const js=await jornadasPorFechaOperacion(fechaInicial);
  js.sort((a,b)=>b.numeroPlanilla.localeCompare(a.numeroPlanilla));
  const root=$('#view-asignacion');
  root.innerHTML=`<div class="card"><div class="toolbar"><label>Fecha operación<input type="date" id="assignDate" value="${fechaInicial}"></label><div class="notice" style="flex:1;min-width:280px">Seleccione la fecha de operación. La búsqueda se realiza en todas las planillas registradas para esa fecha.</div></div></div>`;
  $('#assignDate').onchange=async e=>{lastAssignmentDate=e.target.value||todayISO();await renderAsignacion()};
  if(!js.length){root.insertAdjacentHTML('beforeend',`<div class="card empty" style="margin-top:16px"><h3>No existen planillas para ${fmtDate(fechaInicial)}</h3><p>Seleccione otra Fecha de operación para realizar asignaciones.</p></div>`);return}
  root.insertAdjacentHTML('beforeend',`<div class="grid two" style="margin-top:16px"><div class="card"><h2>Asignación de guías</h2><div class="notice">Puede buscar la guía en todas las planillas de la fecha o limitar la búsqueda a una planilla específica.</div><div class="toolbar" style="margin-top:14px"><label>Planilla de búsqueda<select id="assignPlanilla"><option value="TODAS">Todas las planillas de la fecha</option>${js.map(j=>`<option value="${j.id}">${esc(j.numeroPlanilla)} · ${fmtDate(j.fechaPlanilla)}</option>`).join('')}</select></label><label class="grow">Repartidor<select id="assignRep"><option value="">Seleccione...</option>${reps.map(r=>`<option value="${r.id}">${esc(r.nombre)} · ${esc(r.identificacion)}</option>`).join('')}</select></label></div><div class="scan-panel"><label>Guía / código de barras<input id="assignScan" class="scan-input" autocomplete="off" placeholder="Escanee o digite la guía..." disabled></label><button id="assignManualBtn" class="btn primary" style="margin-top:10px" disabled>Buscar guía manual</button><div id="assignResult" class="scan-result">Seleccione repartidor para iniciar.</div></div></div><div class="card"><h3>Resumen del repartidor</h3><div id="assignSummary"></div></div></div>`);
  const repSel=$('#assignRep'),planSel=$('#assignPlanilla'),scan=$('#assignScan'),btnManual=$('#assignManualBtn'),result=$('#assignResult');
  const getAvailableGuides=async()=>{const all=await getAll('guias');return planSel.value==='TODAS'?all.filter(g=>js.some(j=>j.id===g.jornadaId)):all.filter(g=>g.jornadaId===planSel.value)};
  const showSummary=async()=>{const rid=repSel.value,all=await getAll('guias'),assigned=all.filter(g=>g.repartidorId===rid&&js.some(j=>j.id===g.jornadaId));$('#assignSummary').innerHTML=rid?`<div class="big-number">${assigned.length}</div><p class="muted">guías asignadas en la fecha seleccionada</p><div class="hr"></div><div class="split"><span>Valor responsabilidad</span><strong>${money(assigned.reduce((a,g)=>a+Number(g.valorRecaudo||0),0))}</strong></div><div class="hr"></div><table><thead><tr><th>Guía</th><th>Planilla</th></tr></thead><tbody>${assigned.slice(-8).reverse().map(g=>{const j=js.find(x=>x.id===g.jornadaId);return `<tr><td>${esc(g.numeroGuia)}</td><td>${esc(j?.numeroPlanilla||'')}</td></tr>`}).join('')}</tbody></table>`:`<div class="empty">Seleccione un repartidor.</div>`};
  const searchGuide=async()=>{const n=normGuide(scan.value);if(!n||!repSel.value)return;const guides=await getAvailableGuides(),g=guides.find(x=>normGuide(x.numeroGuia)===n);if(!g){result.className='scan-result err';result.textContent=`Guía ${n} no encontrada en las planillas seleccionadas.`;return}if(g.repartidorId&&g.repartidorId!==repSel.value){result.className='scan-result warn';result.textContent='La guía ya está asignada a otro repartidor en esta fecha de operación.';return}if(['ENTREGADO','DEVUELTO'].includes(g.estado)){result.className='scan-result err';result.textContent=`La guía tiene estado ${g.estado}.`;return}const fechaOp=js.find(j=>j.id===g.jornadaId)?.fechaPlanilla||fechaInicial;const cierrePrevio=await hasOpenOrClosedCaja(fechaOp,repSel.value);if(cierrePrevio){await del('cierres',cierrePrevio.id);await logEvent('REAPERTURA_CAJA',`Caja reabierta por nueva asignación de guía ${n}`,g.id,g.jornadaId)}g.repartidorId=repSel.value;g.asignadoEn=nowISO();g.estado=(fechaOp===todayISO())?'EN_REPARTO':'ASIGNADO';if(g.estado==='EN_REPARTO')g.enRepartoEn=nowISO();await put('guias',g);await logEvent('ASIGNACION',`Guía ${n} asignada`,g.id,g.jornadaId);const plan=js.find(j=>j.id===g.jornadaId);result.className='scan-result ok';result.innerHTML=`✓ <strong>${esc(g.numeroGuia)}</strong><br>Planilla: ${esc(plan?.numeroPlanilla||'')}<br>Cliente: ${esc(g.destinatario)}<br>Valor: ${money(g.valorRecaudo)}`;scan.value='';await showSummary();setTimeout(()=>scan.focus(),50)};
  repSel.onchange=()=>{scan.disabled=!repSel.value;btnManual.disabled=!repSel.value;result.textContent=repSel.value?'Lector listo. Escanee la siguiente guía.':'Seleccione repartidor.';if(repSel.value)scan.focus();showSummary()};
  planSel.onchange=()=>{result.textContent=repSel.value?'Lector listo. Escanee la siguiente guía.':'Seleccione repartidor.';showSummary()};
  scan.onkeydown=async e=>{if(e.key==='Enter'){e.preventDefault();await searchGuide()}};btnManual.onclick=searchGuide;await showSummary();
}


async function renderArqueo(){
  try{
    const reps=await getAll('repartidores');
    const fechas=(await getAll('jornadas')).map(j=>j.fechaPlanilla).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).sort();
    const fechaInicial=lastAuditDate || todayISO();
    const gs=await guiasPorFechaOperacion(fechaInicial);
    const rids=[...new Set(gs.filter(g=>g.repartidorId).map(g=>g.repartidorId))];
    const rm=new Map(reps.map(r=>[r.id,r]));
    if(lastAuditRepId && !rids.includes(lastAuditRepId)) lastAuditRepId=null;
    $('#view-arqueo').innerHTML=`
      <div class="grid two">
        <div class="card"><h2>Arqueo por repartidor</h2>
          <label>Fecha operación<input type="date" id="auditDate" value="${fechaInicial}"></label>
          <label>Repartidor<select id="auditRep" ${rids.length?'':'disabled'}><option value="">${rids.length?'Seleccione...':'No hay repartidores con guías asignadas'}</option>${rids.map(id=>`<option value="${id}" ${lastAuditRepId===id?'selected':''}>${esc(rm.get(id)?.nombre||id)}</option>`).join('')}</select></label>
          <div id="auditWork" style="margin-top:15px"></div>
        </div>
        <div class="card"><h3>Resultado preliminar</h3><div id="auditSummary" class="empty">${gs.length?'Seleccione un repartidor.':`No hay guías para ${fmtDate(fechaInicial)}. Seleccione otra Fecha de operación.`}</div></div>
      </div>`;
    $('#auditDate').onchange=async()=>{lastAuditDate=$('#auditDate').value||todayISO();lastAuditRepId=null;await renderArqueo()};
    $('#auditRep').onchange=async()=>{lastAuditRepId=$('#auditRep').value||null;await setupAudit()};
    async function setupAudit(){
      const fecha=$('#auditDate').value||todayISO();
      const js=await jornadasPorFechaOperacion(fecha);
      const rid=$('#auditRep').value,out=$('#auditWork');
      if(!rid){out.innerHTML=js.length?'':'<div class="notice warning">No hay planillas para la fecha seleccionada.</div>';return}
      lastAuditRepId=rid;
      const all=(await guiasPorFechaOperacion(fecha)).filter(g=>g.repartidorId===rid);
      const cierresRegistrados=await getAll('cierres');
      const closed=js.some(j=>cierresRegistrados.some(c=>c.repartidorId===rid&&c.jornadaId===j.id&&c.estado!=='ANULADO'));
      if(closed){out.innerHTML='<div class="notice warning">Este repartidor ya tiene caja cerrada para la fecha de operación seleccionada.<br><small>No es posible realizar un nuevo arqueo ni modificar devoluciones.</small></div>';await auditSummary();return}
      out.innerHTML=`<div class="scan-panel"><label>Escanear devolución<input id="returnScan" class="scan-input" autocomplete="off" placeholder="Escanee guía devuelta..."></label><div id="returnResult" class="scan-result">Escanee únicamente los paquetes recibidos físicamente como devolución.</div></div><div style="margin-top:14px"><button id="confirmAudit" class="btn primary">Confirmar arqueo y marcar restantes como entregadas</button></div>`;
      $('#returnScan').onkeydown=async e=>{if(e.key!=='Enter')return;e.preventDefault();const n=normGuide(e.target.value);e.target.value='';const fresh=(await guiasPorFechaOperacion(fecha)).filter(g=>g.repartidorId===rid),g=fresh.find(x=>normGuide(x.numeroGuia)===n),rr=$('#returnResult');if(!g){rr.className='scan-result err';rr.textContent=`La guía ${n} no pertenece a este repartidor.`;return}if(g.estado==='DEVUELTO'){rr.className='scan-result warn';rr.textContent=`${n} ya fue leída como devolución.`;return}if(g.estado==='ENTREGADO'){rr.className='scan-result err';rr.textContent=`${n} ya está entregada.`;return}pendingReturnGuide=g;lastAuditRepId=rid;$('#returnGuideText').textContent=`Guía ${g.numeroGuia} · ${g.destinatario}`;$('#returnReason').value='';$('#returnOther').value='';$('#otherReasonWrap').classList.add('hidden');$('#returnDialog').showModal()};
      $('#confirmAudit').onclick=async()=>{const fresh=(await guiasPorFechaOperacion(fecha)).filter(g=>g.repartidorId===rid);if(!fresh.length)return;const remaining=fresh.filter(g=>['ASIGNADO','EN_REPARTO'].includes(g.estado));if(!confirm(`Se marcarán ${remaining.length} guías como ENTREGADAS. Las ${fresh.filter(g=>g.estado==='DEVUELTO').length} devoluciones escaneadas permanecerán como DEVUELTAS. ¿Continuar?`))return;for(const g of remaining){g.estado='ENTREGADO';g.entregadoEn=nowISO();if(Number(g.valorRecaudo||0)===0)g.medioPago='NO_APLICA'}await bulkPut('guias',remaining);await put('arqueos',{id:`${(js[0]?.id||fecha)}__${rid}`,jornadaId:js[0]?.id||null,repartidorId:rid,fechaOperacion:fecha,confirmadoEn:nowISO(),total:fresh.length,devueltas:fresh.filter(g=>g.estado==='DEVUELTO').length,entregadas:remaining.length});await logEvent('ARQUEO',`Arqueo confirmado para ${rm.get(rid)?.nombre||rid}`,null,js[0]?.id||null);toast('Arqueo confirmado');await setupAudit();await auditSummary()};
      setTimeout(()=>$('#returnScan')?.focus(),50);await auditSummary();
    }
    async function auditSummary(){const rid=$('#auditRep').value;if(!rid)return;const fecha=$('#auditDate').value||todayISO(),a=(await guiasPorFechaOperacion(fecha)).filter(g=>g.repartidorId===rid),dev=a.filter(g=>g.estado==='DEVUELTO'),ent=a.filter(g=>g.estado==='ENTREGADO');$('#auditSummary').innerHTML=`<div class="split"><span>Total asignadas</span><strong>${a.length}</strong></div><div class="hr"></div><div class="split"><span>Devoluciones escaneadas</span><strong>${dev.length}</strong></div><div class="split"><span>Entregadas confirmadas</span><strong>${ent.length}</strong></div><div class="split"><span>Pendientes de confirmar</span><strong>${a.filter(g=>['ASIGNADO','EN_REPARTO'].includes(g.estado)).length}</strong></div><div class="hr"></div><strong>Devoluciones</strong><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Guía</th><th>Motivo</th><th class="right">Valor</th></tr></thead><tbody>${dev.length?dev.map(g=>`<tr><td>${esc(g.numeroGuia)}</td><td>${esc(g.motivoDevolucion||'')}</td><td class="money">${money(g.valorRecaudo)}</td></tr>`).join(''):`<tr><td colspan="3" class="center muted">Sin devoluciones escaneadas</td></tr>`}</tbody></table></div>`}
    if(lastAuditRepId) await setupAudit();
  }catch(err){console.error('Error cargando arqueo:',err);$('#view-arqueo').innerHTML='<div class="card empty">No fue posible cargar el arqueo. Revise la consola.</div>'}
}


async function confirmReturnSave(){
  if(!pendingReturnGuide){
    toast("No hay una guía pendiente por registrar","err");
    return;
  }

  const reason=$("#returnReason").value;
  const other=norm($("#returnOther").value);

  if(!reason){
    toast("Seleccione un motivo de devolución","err");
    $("#returnReason").focus();
    return;
  }

  if(reason==="Otro" && !other){
    toast("Debe escribir la observación de la devolución","err");
    $("#returnOther").focus();
    return;
  }

  const btn=$("#confirmReturn");
  btn.disabled=true;
  const originalText=btn.textContent;
  btn.textContent="Guardando...";

  try{
    const current=await getOne("guias", pendingReturnGuide.id);
    if(!current){
      throw new Error("La guía ya no existe en la base local.");
    }

    if(current.estado==="DEVUELTO"){
      toast(`La guía ${current.numeroGuia} ya está registrada como devolución`,"err");
      return;
    }

    if(current.estado==="ENTREGADO"){
      toast(`La guía ${current.numeroGuia} ya está marcada como entregada`,"err");
      return;
    }

    current.estado="DEVUELTO";
    current.devueltoEn=nowISO();
    current.motivoDevolucion=reason;
    current.observacionDevolucion=reason==="Otro" ? other : "";
    current.devolucionLegalizada=true;

    await put("guias",current);
    await logEvent(
      "DEVOLUCION",
      `Devolución legalizada: ${current.numeroGuia} · Motivo: ${reason}`,
      current.id,
      current.jornadaId
    );

    const repRestore=lastAuditRepId || current.repartidorId;
    pendingReturnGuide=null;

    const dlg=$("#returnDialog");
    if(dlg.open) dlg.close();

    toast(`✓ Devolución ${current.numeroGuia} guardada`);

    // Re-renderizar Arqueo y regresar automáticamente al mismo repartidor.
    await renderArqueo();

    if(repRestore){
      lastAuditRepId=repRestore;
      const sel=$("#auditRep");
      if(sel){
        sel.value=repRestore;
        sel.dispatchEvent(new Event("change"));
      }
      setTimeout(()=>$("#returnScan")?.focus(),150);
    }
  }catch(err){
    console.error("Error guardando devolución:",err);
    toast(err?.message || "No se pudo guardar la devolución","err");
  }finally{
    btn.disabled=false;
    btn.textContent=originalText;
  }
}

// Controladores permanentes del diálogo de devolución.
$("#confirmReturn").addEventListener("click",e=>{
  e.preventDefault();
  e.stopPropagation();
  confirmReturnSave();
});

$("#cancelReturn").addEventListener("click",e=>{
  e.preventDefault();
  pendingReturnGuide=null;
  const dlg=$("#returnDialog");
  if(dlg.open) dlg.close();
  setTimeout(()=>$("#returnScan")?.focus(),80);
});

$("#returnForm").addEventListener("submit",e=>{
  e.preventDefault();
  confirmReturnSave();
});

$("#returnReason").addEventListener("change",e=>{
  const isOther=e.target.value==="Otro";
  $("#otherReasonWrap").classList.toggle("hidden",!isOther);
  if(isOther) setTimeout(()=>$("#returnOther").focus(),20);
});

async function renderCierre(){
  const reps=await getAll("repartidores");
  const defaultDate=todayISO();
  const available=(await getAll("jornadas")).map(j=>j.fechaPlanilla).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).sort().reverse();
  const rm=new Map(reps.map(r=>[r.id,r]));

  $("#view-cierre").innerHTML=`
    <div class="card">
      <div class="toolbar">
        <label>Fecha operación
          <input type="date" id="cashDate" value="${defaultDate}">
        </label>
        <label>Repartidor
          <select id="cashRep"><option value="">Seleccione...</option></select>
        </label>
      </div>
      <div id="cashWork" class="empty">Seleccione fecha y repartidor para revisar el cierre.</div>
    </div>`;

  async function loadCashReps(){
    const fecha=$("#cashDate").value;
    const gs=await guiasPorFechaOperacion(fecha);
    const rids=[...new Set(gs.filter(g=>g.repartidorId).map(g=>g.repartidorId))];
    $("#cashRep").innerHTML=`<option value="">Seleccione...</option>${rids.map(id=>`<option value="${id}">${esc(rm.get(id)?.nombre||id)}</option>`).join("")}`;
    $("#cashWork").innerHTML=`<div class="empty">Seleccione un repartidor para revisar el cierre.</div>`;
  }

  $("#cashDate").onchange=loadCashReps;
  $("#cashRep").onchange=showCash;
  await loadCashReps();

  async function showCash(){
    const rid=$("#cashRep").value;
    const fecha=$("#cashDate").value;
    if(!rid||!fecha)return;
    const allDate=await guiasPorFechaOperacion(fecha);
    const all=allDate.filter(g=>g.repartidorId===rid), ent=all.filter(g=>g.estado==="ENTREGADO"), dev=all.filter(g=>g.estado==="DEVUELTO"), pending=all.filter(g=>!["ENTREGADO","DEVUELTO"].includes(g.estado)), paid=ent.filter(g=>Number(g.valorRecaudo)>0), untyped=paid.filter(g=>!["EFECTIVO","TRANSFERENCIA","LINK_PAGO"].includes(g.medioPago));
    const jornadaIds=(await jornadasPorFechaOperacion(fecha)).map(j=>j.id);
    const resp=all.reduce((a,g)=>a+Number(g.valorRecaudo||0),0), devv=dev.reduce((a,g)=>a+Number(g.valorRecaudo||0),0), recv=ent.reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
    const efe=ent.filter(g=>g.medioPago==="EFECTIVO").reduce((a,g)=>a+Number(g.valorRecaudo||0),0), tra=ent.filter(g=>g.medioPago==="TRANSFERENCIA").reduce((a,g)=>a+Number(g.valorRecaudo||0),0), link=ent.filter(g=>g.medioPago==="LINK_PAGO").reduce((a,g)=>a+Number(g.valorRecaudo||0),0);
    const cierre=(await getAll("cierres")).find(c=>jornadaIds.includes(c.jornadaId)&&c.repartidorId===rid);
    const balanced=Math.abs(resp-(devv+recv))<1 && !pending.length && !untyped.length;
    $("#cashWork").innerHTML=`
      ${cierre?`<div class="notice">Caja cerrada el ${new Date(cierre.cerradoEn).toLocaleString("es-CO")}. ${cierre.tarifaPorGuia!=null?`Pago por guía entregada: <strong>${money(cierre.tarifaPorGuia)}</strong> · Total pago repartidor: <strong>${money(cierre.totalPagoRepartidor||0)}</strong>.`:""}</div>`:""}
      <h3 style="margin-top:14px">Estado de guías del repartidor</h3>
      <div class="grid kpis" style="margin:10px 0 14px">
        <div class="kpi card"><div class="label">TOTAL GUÍAS</div><div class="value">${all.length}</div></div>
        <div class="kpi card"><div class="label">PENDIENTES</div><div class="value">${pending.length}</div></div>
        <div class="kpi card"><div class="label">ENTREGADAS</div><div class="value">${ent.length}</div></div>
        <div class="kpi card"><div class="label">DEVUELTAS</div><div class="value">${dev.length}</div></div>
      </div>
      <h3>Resumen financiero</h3>
      <div class="grid kpis" style="margin:10px 0 14px">
        <div class="kpi card"><div class="label">RESPONSABILIDAD</div><div class="value" style="font-size:22px">${money(resp)}</div></div>
        <div class="kpi card"><div class="label">RECAUDADO</div><div class="value" style="font-size:22px">${money(recv)}</div></div>
        <div class="kpi card"><div class="label">DEVOLUCIONES</div><div class="value" style="font-size:22px">${money(devv)}</div></div>
        <div class="kpi card"><div class="label">DIFERENCIA</div><div class="value" style="font-size:22px">${money(resp-recv-devv)}</div></div>
      </div>
      <h3>Forma de pago de las entregas con recaudo</h3>
      <div class="toolbar"><button class="btn" id="allCash" ${(cierre||!paid.length)?"disabled":""}>Marcar seleccionadas: Efectivo</button><button class="btn" id="allLink" ${(cierre||!paid.length)?"disabled":""}>Marcar seleccionadas: Link de Pago</button><button class="btn" id="allTransfer" ${(cierre||!paid.length)?"disabled":""}>Marcar seleccionadas: Transferencia</button></div>
      <div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="checkAllPaid" ${(cierre||!paid.length)?"disabled":""}></th><th>Guía</th><th>Destinatario</th><th class="right">Valor</th><th>Forma de pago</th></tr></thead><tbody>
        ${paid.length?paid.map(g=>`<tr><td><input class="paidCheck" type="checkbox" value="${g.id}" ${cierre?"disabled":""}></td><td>${esc(g.numeroGuia)}</td><td>${esc(g.destinatario)}</td><td class="money">${money(g.valorRecaudo)}</td><td><select class="paySelect" data-id="${g.id}" ${cierre?"disabled":""}><option value="">Seleccione...</option><option value="EFECTIVO" ${g.medioPago==="EFECTIVO"?"selected":""}>Efectivo</option><option value="TRANSFERENCIA" ${g.medioPago==="TRANSFERENCIA"?"selected":""}>Transferencia</option><option value="LINK_PAGO" ${g.medioPago==="LINK_PAGO"?"selected":""}>Link de Pago</option></select></td></tr>`).join(""):`<tr><td colspan="5" class="center muted">No hay entregas con recaudo.</td></tr>`}
      </tbody></table></div>
      <div class="grid four" style="margin-top:14px"><div class="card"><span class="muted">Efectivo</span><div class="big-number" style="font-size:22px">${money(efe)}</div></div><div class="card"><span class="muted">Transferencia</span><div class="big-number" style="font-size:22px">${money(tra)}</div></div><div class="card"><span class="muted">Link de Pago</span><div class="big-number" style="font-size:22px">${money(link)}</div></div><div class="card"><span class="muted">Sin clasificar</span><div class="big-number" style="font-size:22px">${untyped.length}</div></div></div>
      <div class="hr"></div>
      ${pending.length?`<div class="notice danger">Hay ${pending.length} guías que aún no son Entregadas ni Devueltas.</div>`:""}
      ${untyped.length?`<div class="notice warning" style="margin-top:8px">Falta definir la forma de pago de ${untyped.length} guías.</div>`:""}
      <div style="margin-top:14px"><button id="closeCash" class="btn success" ${(!balanced||cierre)?"disabled":""}>Cerrar caja del repartidor</button></div>`;
    $$(".paySelect").forEach(s=>s.onchange=async()=>{const g=await getOne("guias",s.dataset.id);g.medioPago=s.value||null;await put("guias",g);await showCash()});
    $("#checkAllPaid")?.addEventListener("change",e=>$$(".paidCheck:not(:disabled)").forEach(c=>c.checked=e.target.checked));
    const mass=async val=>{if(cierre){toast("La caja está cerrada y no admite cambios","err");return}const ids=$$(".paidCheck:checked:not(:disabled)").map(c=>c.value);if(!ids.length){toast("Seleccione al menos una guía","err");return}for(const id of ids){const g=await getOne("guias",id);g.medioPago=val;await put("guias",g)}toast(`${ids.length} guías actualizadas`);await showCash()};
    $("#allCash")?.addEventListener("click",()=>mass("EFECTIVO"));$("#allTransfer")?.addEventListener("click",()=>mass("TRANSFERENCIA"));$("#allLink")?.addEventListener("click",()=>mass("LINK_PAGO"));
    $("#closeCash")?.addEventListener("click",async()=>{
      const tarifaRaw=prompt("Valor a pagar al repartidor por cada guía entregada:", "2000");
      if(tarifaRaw===null)return;
      const tarifa=Number(String(tarifaRaw).replace(/[^0-9]/g,""));
      if(!Number.isFinite(tarifa)||tarifa<0){toast("Ingrese un valor válido por guía entregada","err");return}
      if(!confirm(`¿Confirmar cierre definitivo de caja para este repartidor?\\n\\nPago por guía entregada: ${money(tarifa)}\\nGuías entregadas: ${ent.length}\\nTotal a pagar: ${money(tarifa*ent.length)}`))return;
      const j=(await getAll("jornadas")).find(x=>x.fechaPlanilla===fecha) || await currentJornada();
      if(!j){toast("No se encontró la operación seleccionada","err");return}
      await put("cierres",{id:`${j.id}__${rid}`,jornadaId:j.id,repartidorId:rid,cerradoEn:nowISO(),responsabilidad:resp,recaudado:recv,efectivo:efe,transferencia:tra,linkPago:link,devoluciones:devv,diferencia:resp-recv-devv,tarifaPorGuia:tarifa,guiasEntregadas:ent.length,totalPagoRepartidor:tarifa*ent.length});
      await logEvent("CIERRE_CAJA",`Caja cerrada para ${rm.get(rid)?.nombre||rid}. Pago por guía: ${money(tarifa)}. Total pago repartidor: ${money(tarifa*ent.length)}`,null,j.id);toast("Caja cerrada correctamente");await maybeCloseJourney();await showCash();
    });
  }
}
async function maybeCloseJourney(){
  const j=await currentJornada();if(!j)return;
  const gs=await guidesForJornada(j.id), rids=[...new Set(gs.filter(g=>g.repartidorId).map(g=>g.repartidorId))], cs=(await getAll("cierres")).filter(c=>c.jornadaId===j.id);
  if(rids.length && rids.every(id=>cs.some(c=>c.repartidorId===id)) && gs.every(g=>["ENTREGADO","DEVUELTO"].includes(g.estado))){
    j.estado="CERRADA";j.cerradoEn=nowISO();await put("jornadas",j);toast("Jornada completamente cerrada");
  }
}

async function renderHistorico(){
  const js=(await getAll("jornadas")).sort((a,b)=>b.fechaPlanilla.localeCompare(a.fechaPlanilla)), gs=await getAll("guias");
  $("#view-historico").innerHTML=`
    <div class="card"><h2>Histórico de jornadas</h2>
      ${js.length?`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Planilla</th><th>Estado</th><th>Guías</th><th>Entregadas</th><th>Devueltas</th><th class="right">Responsabilidad</th></tr></thead><tbody>
      ${js.map(j=>{const a=gs.filter(g=>g.jornadaId===j.id);return `<tr><td>${fmtDate(j.fechaPlanilla)}</td><td><strong>${esc(j.numeroPlanilla)}</strong></td><td>${statusBadge(j.estado)}</td><td>${a.length}</td><td>${a.filter(g=>g.estado==="ENTREGADO").length}</td><td>${a.filter(g=>g.estado==="DEVUELTO").length}</td><td class="money">${money(a.reduce((x,g)=>x+Number(g.valorRecaudo||0),0))}</td></tr>`}).join("")}
      </tbody></table></div>`:`<div class="empty">No hay jornadas importadas.</div>`}
    </div>`;
}
async function collectBackup(scope="all"){
  const data={version:"1.0",generadoEn:nowISO(),tipo:scope,data:{}};
  for(const s of STORES)data.data[s]=await getAll(s);
  if(scope==="current"){
    const j=await currentJornada(); if(j){
      data.data.jornadas=data.data.jornadas.filter(x=>x.id===j.id);
      data.data.guias=data.data.guias.filter(x=>x.jornadaId===j.id);
      data.data.arqueos=data.data.arqueos.filter(x=>x.jornadaId===j.id);
      data.data.cierres=data.data.cierres.filter(x=>x.jornadaId===j.id);
      data.data.eventos=data.data.eventos.filter(x=>x.jornadaId===j.id);
    }
  }
  return data;
}
function downloadJSON(obj,name){
  const b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function backupCurrent(){const j=await currentJornada();if(!j){toast("No hay jornada activa","err");return}downloadJSON(await collectBackup("current"),`Jornada_${j.fechaPlanilla}_Planilla_${j.numeroPlanilla}.json`);toast("Respaldo generado")}
$("#btnQuickBackup").onclick=backupCurrent;

async function renderBackup(){
  $("#view-backup").innerHTML=`
    <div class="grid two">
      <div class="card"><h2>Exportar</h2><p class="muted">Descargue copias JSON que podrá restaurar posteriormente.</p>
        <div class="grid"><button id="backupDay" class="btn primary">Exportar jornada activa</button><button id="backupAll" class="btn success">Exportar base completa</button></div>
      </div>
      <div class="card"><h2>Restaurar</h2><p class="muted">La restauración agrega/actualiza registros usando sus identificadores. Se recomienda exportar una copia completa antes.</p>
        <input type="file" id="restoreFile" accept=".json"><div id="restoreInfo" style="margin-top:12px"></div>
      </div>
    </div>`;
  $("#backupDay").onclick=backupCurrent;
  $("#backupAll").onclick=async()=>{downloadJSON(await collectBackup("all"),`Respaldo_Completo_${todayISO()}.json`);toast("Respaldo completo generado")};
  $("#restoreFile").onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    try{
      const obj=JSON.parse(await f.text());if(!obj.data||!obj.version)throw new Error("Formato de respaldo no reconocido.");
      if(!confirm("¿Restaurar esta copia de seguridad? Los registros con el mismo ID serán actualizados."))return;
      for(const s of STORES)if(Array.isArray(obj.data[s]))await bulkPut(s,obj.data[s]);
      $("#restoreInfo").innerHTML=`<div class="notice">Restauración completada.</div>`;toast("Copia restaurada");
    }catch(err){$("#restoreInfo").innerHTML=`<div class="notice danger">${esc(err.message)}</div>`}
  };
}

(async function init(){
  try{
    await openDB();await normalizeExistingGuides();$("#todayLabel").textContent=new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    await autoAdvance();await renderDashboard();
  }catch(e){$("#dbStatus").textContent="● Error en base local";$("#dbStatus").className="";toast("No se pudo abrir la base local","err");console.error(e)}
})();
