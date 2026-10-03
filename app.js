// Flood Map — Mae Klong Basin prototype v0.8
// GERARAI ER + REAL WATER CONNECTIONS
// Rule: hydrological connection lines are NEVER invented. Every visible route segment
// comes directly from OpenStreetMap geometry returned by Overpass. No dam-to-dam
// straight lines, no interpolation, and no manual geometry to close data gaps.
// Public Overpass endpoints are prototype/light-use infrastructure only.

const BASIN_VIEW = L.latLngBounds([12.7, 98.3], [15.9, 100.65]);
const map = L.map('map', { minZoom: 6, maxZoom: 17 }).fitBounds(BASIN_VIEW);

const baseMap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors',
  crossOrigin: true
}).addTo(map);

let tileErrors = 0;
baseMap.on('tileerror', () => {
  tileErrors++;
  if (tileErrors === 3) {
    const msg = document.getElementById('mapStatus');
    msg.hidden = false;
    msg.textContent = 'แผนที่พื้นหลังโหลดไม่ได้ — กรุณารีเฟรชหน้าเว็บ หรือเปลี่ยนผู้ให้บริการ Base Map ก่อนใช้งานจริง';
  }
});


// ---------------------------------------------------------------------------
// GERARAI Emergency Discovery UI/logic port
// Source basis: GERARAI phase13 emergency-core.js / emergency-ui.js.
// This standalone prototype keeps reports in localStorage only. The production
// backend must be separate from GERARAI production and enforce CAPTCHA/rate limits.
// ---------------------------------------------------------------------------
const E = window.GerarAIEmergency;
const REPORT_STORE_KEY = 'maeklong-emergency-v06-local';
const emergencyLayer = L.layerGroup().addTo(map);
const floodAreaLayer = L.layerGroup().addTo(map);
let currentMode = 'live';
let picked = null;
let pickOnMap = false;
let selectedType = 'flood';
let editingReportId = null;
let pickedSource = '';
let pickedAccuracy = null;
let selectedFilter = '';
let routeLoading = false;
let canalLoading = false;
let canalFetchTimer = null;
const routeLayer = L.layerGroup().addTo(map);
const canalLayer = L.layerGroup().addTo(map);
const basinLayer = L.layerGroup();
const controlLayer = L.layerGroup().addTo(map);
let reports = loadReports();

const FLOOD_LEVEL_STYLE = {
  wet:{color:'#9bd9ff',label:'น้ำเริ่มขัง'},
  ankle:{color:'#62bfff',label:'ข้อเท้า'},
  shin:{color:'#378fd3',label:'หน้าแข้ง'},
  knee:{color:'#5668d8',label:'เข่า'},
  waist:{color:'#8a43b8',label:'เอว'},
  above_waist:{color:'#c72f63',label:'สูงกว่าเอว'},
  unknown:{color:'#7891a5',label:'ไม่ทราบระดับ'}
};
const WHEN = [['0','ตอนนี้'],['15','15 นาทีที่แล้ว'],['30','30 นาทีที่แล้ว'],['60','1 ชม. ที่แล้ว']];

function loadReports(){
  try{
    const raw=localStorage.getItem(REPORT_STORE_KEY);
    if(raw){const rows=JSON.parse(raw);if(Array.isArray(rows))return rows;}
  }catch(_){/* ignore */}
  const now=Date.now();
  return [
    makeReport({id:'demo-flood',type_code:'flood',latitude:13.548,longitude:100.274,location_precision:'approximate',reported_at:new Date(now-18*60000).toISOString(),water_depth:'ankle',vehicle_access:'general_passable',note:'ตัวอย่างข้อมูลสาธิต'}),
    makeReport({id:'demo-road',type_code:'road_blocked',latitude:13.409,longitude:100.001,location_precision:'approximate',reported_at:new Date(now-42*60000).toISOString(),vehicle_access:'general_impassable',note:'ตัวอย่างข้อมูลสาธิต'}),
    makeReport({id:'demo-help',type_code:'help_request',latitude:13.521,longitude:100.184,location_precision:'approximate',reported_at:new Date(now-12*60000).toISOString(),need_code:'water',people_count:3,note:'ข้อมูลตัวอย่าง'}),
  ];
}
function saveReports(){
  try{localStorage.setItem(REPORT_STORE_KEY,JSON.stringify(reports.filter(r=>!String(r.id).startsWith('demo-'))));}catch(_){/* ignore */}
}
function makeReport(d){
  const rule=E.ruleMap().get(d.type_code) || {ttl_minutes:360};
  const t=new Date(d.reported_at||Date.now());
  return {emergency_status:'active',source_type:'community',created_at:d.created_at||new Date().toISOString(),...d,expires_at:d.expires_at||new Date(t.getTime()+rule.ttl_minutes*60000).toISOString()};
}
function emergencyPinIcon(report,selected=false){
  const rule=E.ruleMap().get(report.type_code)||{icon:'📍',label_th:report.type_code};
  const f=E.freshness(report,null,Date.now());
  const PIN_THEME={
    help_request:'#d63b4a', road_blocked:'#d9534f', road_passable:'#2f8f6b', shelter:'#486fb3',
    food_water:'#258fb5', medical:'#d94256', power_charging:'#d69b22', toilet:'#6e62a8',
    shower:'#328fc4', recovered:'#3b9a67'
  };
  const pin=PIN_THEME[report.type_code]||'#3e6f8f';
  const cls=`emg-drop emg-${f.state} ${selected?'selected':''}`;
  return L.divIcon({
    className:'emergency-marker',
    html:`<span class="${cls}" style="--pin:${pin}" aria-label="${escapeHtml(rule.label_th)}"><b>${rule.icon}</b></span>`,
    iconSize:[30,36],iconAnchor:[15,34],popupAnchor:[0,-31]
  });
}
function isOwnedLocalReport(r){
  return String(r?.id||'').startsWith('local-');
}
function reportPopup(r){
  const rule=E.ruleMap().get(r.type_code)||{icon:'📍',label_th:r.type_code};
  const f=E.freshness(r,null,Date.now());
  const lines=E.timeLines(r,null,Date.now());
  const bits=[];
  if(r.water_depth) bits.push(`ระดับน้ำ: ${E.label(E.DEPTHS,r.water_depth)}`);
  if(r.vehicle_access) bits.push(`รถ: ${E.label(E.VEHICLES,r.vehicle_access)}`);
  if(r.need_code) bits.push(`ต้องการ: ${E.label(E.NEEDS,r.need_code)}`);
  if(r.people_count) bits.push(`ประมาณ ${r.people_count} คน`);
  const stale=E.staleWarning(r,null,Date.now());
  const owned=isOwnedLocalReport(r);
  const actions=owned ? `<div class="report-actions">
    <button type="button" data-report-action="edit" data-report-id="${escapeHtml(r.id)}">✏️ อัปเดตสถานการณ์</button>
    ${r.emergency_status!=='resolved'?`<button type="button" data-report-action="resolve" data-report-id="${escapeHtml(r.id)}">✅ คลี่คลายแล้ว</button>`:''}
    <button type="button" class="report-delete" data-report-action="delete" data-report-id="${escapeHtml(r.id)}">🗑️ ลบหมุด</button>
  </div><p class="form-help">จัดการได้เฉพาะรายงานที่สร้างจากเบราว์เซอร์เครื่องนี้</p>` : '';
  return `<div class="emergency-detail"><div class="emg-detail-head"><div><strong>${rule.icon} ${escapeHtml(rule.label_th)}</strong><div class="emg-chips-row"><span class="emg-fresh emg-${f.state}">${escapeHtml(f.label)}</span><span class="emg-source">รายงานจากชุมชน</span></div></div></div><p class="emg-headline">${escapeHtml(E.headline(r))}</p>${bits.length?`<p>${bits.map(escapeHtml).join('<br>')}</p>`:''}${r.note?`<p class="emg-note">${escapeHtml(r.note)}</p>`:''}${stale?`<span class="emg-stale">${escapeHtml(stale)}</span>`:''}<ul class="emg-times">${lines.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul><p class="form-help">${escapeHtml(E.PRECISION_LABEL[r.location_precision]||'')}</p>${actions}</div>`;
}

function visibleReports(){
  const history=document.getElementById('historyToggle')?.checked;
  const freshOnly=document.getElementById('freshOnly')?.checked;
  return reports.filter(r=>{
    const f=E.freshness(r,null,Date.now());
    if(selectedFilter && r.type_code!==selectedFilter)return false;
    if(!history && !f.current)return false;
    if(freshOnly && f.state!=='fresh')return false;
    return true;
  });
}
function floodRadiusM(r){
  if(r.location_precision==='exact')return 420;
  if(r.location_precision==='near')return 650;
  return 950;
}
function drawFloodArea(r){
  const f=E.freshness(r,null,Date.now());
  const st=FLOOD_LEVEL_STYLE[r.water_depth]||FLOOD_LEVEL_STYLE.unknown;
  const freshFactor=f.state==='fresh'?1:f.state==='aging'?.62:.28;
  const radius=floodRadiusM(r);
  // Soft outer halo: visual area only, not a claim that water fills this exact circle.
  L.circle([r.latitude,r.longitude],{
    radius:radius*1.35,stroke:false,fillColor:st.color,fillOpacity:.055*freshFactor,interactive:false
  }).addTo(floodAreaLayer);
  L.circle([r.latitude,r.longitude],{
    radius,stroke:false,fillColor:st.color,fillOpacity:.22*freshFactor
  }).bindPopup(reportPopup(r),{maxWidth:340}).addTo(floodAreaLayer);
}
function renderEmergency(){
  emergencyLayer.clearLayers();
  floodAreaLayer.clearLayers();
  const rows=visibleReports();
  let flood=0,help=0,other=0;
  rows.forEach(r=>{
    if(r.type_code==='flood'){
      flood++;
      if(document.getElementById('heatToggle')?.checked && currentMode==='live')drawFloodArea(r);
      return; // Flood reports are shown as colored areas, never as map pins.
    }
    if(r.type_code==='help_request')help++; else other++;
    if(document.getElementById('emergencyToggle')?.checked){
      L.marker([r.latitude,r.longitude],{icon:emergencyPinIcon(r)})
        .bindPopup(reportPopup(r),{maxWidth:340})
        .addTo(emergencyLayer);
    }
  });
  document.getElementById('floodCount').textContent=flood;
  document.getElementById('helpCount').textContent=help;
  document.getElementById('otherCount').textContent=other;
}
// LOCKED UX: keep GERARAI ER filter choices/behavior stable unless explicitly revised.
function renderFilters(){
  const box=document.getElementById('emgFilters');
  const list=[['','ทั้งหมด'],...E.FALLBACK_RULES.map(r=>[r.type_code,`${r.icon} ${r.label_th}`])];
  box.innerHTML=list.map(([code,label])=>`<button type="button" data-filter="${code}" class="${selectedFilter===code?'active':''}">${escapeHtml(label)}</button>`).join('');
  box.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{selectedFilter=b.dataset.filter;renderFilters();renderEmergency();});
}
function chips(name,list,current){
  return `<div class="emg-chips">${list.map(([v,t])=>`<label class="emg-chip"><input type="radio" name="${name}" value="${v}" ${String(current)===String(v)?'checked':''}><span>${escapeHtml(t)}</span></label>`).join('')}</div>`;
}
function renderTypeGrid(preselect='flood'){
  const grid=document.getElementById('typeGrid');
  grid.innerHTML=E.FALLBACK_RULES.map(r=>`<label class="emg-type"><input type="radio" name="type_code" value="${r.type_code}" ${r.type_code===preselect?'checked':''}><span><b>${r.icon}</b>${escapeHtml(r.label_th)}</span></label>`).join('');
  grid.querySelectorAll('[name=type_code]').forEach(i=>i.onchange=()=>{selectedType=i.value;renderTypeFields({});});
}
function renderTypeFields(values={}){
  const rule=E.ruleMap().get(selectedType)||E.FALLBACK_RULES[0];
  const specific=document.getElementById('typeSpecific');
  let html='';
  if(selectedType==='flood')html=`<p class="emg-sub">ระดับน้ำ</p>${chips('water_depth',E.DEPTHS,values.water_depth||'unknown')}<p class="emg-sub">การผ่านของรถ (ตามที่คุณเห็น)</p>${chips('vehicle_access',E.VEHICLES,values.vehicle_access||'unknown')}`;
  else if(selectedType==='road_passable'||selectedType==='road_blocked')html=`<p class="emg-sub">การผ่านของรถ (ตามที่คุณเห็น)</p>${chips('vehicle_access',E.VEHICLES,values.vehicle_access||(selectedType==='road_blocked'?'general_impassable':'general_passable'))}`;
  else if(selectedType==='help_request')html=`<p class="emg-sub">ต้องการอะไร</p>${chips('need_code',E.NEEDS,values.need_code||'water')}<label class="form-field">จำนวนคนโดยประมาณ (ไม่บังคับ)<input id="peopleCount" type="number" min="1" max="999" inputmode="numeric" value="${values.people_count?escapeHtml(values.people_count):''}"></label><p class="form-help">อย่าใส่ชื่อ เบอร์โทร บ้านเลขที่ หรือข้อมูลส่วนตัวในรายงานสาธารณะ</p>`;
  else html='<p class="form-help">เลือกตำแหน่งและใส่รายละเอียดสั้น ๆ ได้เลย</p>';
  specific.innerHTML=html;
  let defaultPrecision=values.location_precision;
  if(!defaultPrecision || !rule.allowed_precisions.includes(defaultPrecision)) defaultPrecision=(selectedType==='help_request'&&rule.allowed_precisions.includes('approximate'))?'approximate':rule.allowed_precisions[0];
  document.getElementById('precisionChips').innerHTML=chips('location_precision',rule.allowed_precisions.map(p=>[p,E.PRECISION_LABEL[p]]),defaultPrecision);
  document.getElementById('helpNotice').hidden=selectedType!=='help_request';
}
function pickerBar(show){
  const bar=document.getElementById('mapPickBar');
  bar.hidden=!show;
  if(show){
    const cancel=document.getElementById('mapPickCancel');
    cancel.textContent=editingReportId?'ยกเลิกการแก้ไข':'ยกเลิกการรายงาน';
  }
}
function cancelReportFlow(){
  pickOnMap=false; editingReportId=null; picked=null; pickedSource=''; pickedAccuracy=null;
  pickerBar(false);
  const dlg=document.getElementById('reportDialog');
  if(dlg.open)dlg.close();
}
function openReport(type='flood', existing=null){
  if(currentMode!=='live')setMode('live');
  selectedType=existing?.type_code||type;
  editingReportId=existing?.id||null;
  pickOnMap=false; pickerBar(false);
  picked=null; pickedSource=''; pickedAccuracy=null;
  if(existing)setPicked(existing.latitude,existing.longitude,'existing');
  else document.getElementById('picked').textContent='ยังไม่ได้เลือกตำแหน่ง';
  document.getElementById('note').value=existing?.note||'';
  document.getElementById('formError').hidden=true;
  renderTypeGrid(selectedType); renderTypeFields(existing||{});
  document.getElementById('whenChips').innerHTML=chips('when',WHEN,'0');
  document.getElementById('formTitle').textContent=editingReportId?'อัปเดตสถานการณ์':(selectedType==='help_request'?'ขอความช่วยเหลือ':'แจ้งสถานการณ์');
  document.getElementById('submitReportBtn').textContent=editingReportId?'บันทึกการอัปเดต':'ส่งรายงาน';
  document.getElementById('reportDialog').showModal();
}
function setPicked(lat,lng,source='map',accuracy=null){
  picked=L.latLng(+lat,+lng); pickedSource=source; pickedAccuracy=Number.isFinite(Number(accuracy))?Number(accuracy):null;
  const sourceText=source==='gps'?'GPS ปัจจุบัน':source==='existing'?'ตำแหน่งเดิม':'เลือกจากแผนที่';
  const acc=pickedAccuracy!=null?` • ความแม่นยำประมาณ ±${Math.round(pickedAccuracy)} ม.`:'';
  document.getElementById('picked').textContent=`${sourceText}: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}${acc}`;
}
function formRadio(name){return document.querySelector(`#reportForm [name="${name}"]:checked`)?.value||'';}
function submitReport(e){
  e.preventDefault();
  const err=document.getElementById('formError');
  if(!picked){err.textContent='ระบุตำแหน่งบนแผนที่หรือใช้ GPS';err.hidden=false;return;}
  const mins=Number(formRadio('when')||0);
  const d={
    type_code:selectedType,location_precision:formRadio('location_precision'),latitude:picked.lat,longitude:picked.lng,
    reported_at:new Date(Date.now()-mins*60000).toISOString(),note:document.getElementById('note').value.trim()
  };
  if(selectedType==='flood'){d.water_depth=formRadio('water_depth');d.vehicle_access=formRadio('vehicle_access');}
  if(['road_passable','road_blocked'].includes(selectedType))d.vehicle_access=formRadio('vehicle_access');
  if(selectedType==='help_request'){d.need_code=formRadio('need_code');const pc=document.getElementById('peopleCount')?.value;if(pc)d.people_count=Number(pc);}
  const validation=E.validateDraft(d);
  if(validation){err.textContent=validation;err.hidden=false;return;}
  if(editingReportId){
    const idx=reports.findIndex(r=>r.id===editingReportId);
    if(idx>=0){
      const old=reports[idx];
      reports[idx]=makeReport({id:old.id,created_at:old.created_at,updated_at:new Date().toISOString(),...d});
    }
  }else{
    reports.push(makeReport({id:`local-${Date.now()}`,...d}));
  }
  saveReports();
  selectedFilter='';renderFilters();renderEmergency();
  document.getElementById('reportDialog').close();
  editingReportId=null; picked=null; pickedSource=''; pickedAccuracy=null; pickerBar(false);
}

renderFilters();

// ---------------------------------------------------------------------------
// DAMS / WATER CONTROL STRUCTURES
// Points are seed locations from official/public references and can be visually
// cross-checked using the Google Maps link in each popup. Google map content is
// not scraped or converted to GIS geometry.
// ---------------------------------------------------------------------------
const HYDRAULIC_STRUCTURES = [
  {name:'เขื่อนวชิราลงกรณ', kind:'เขื่อน', lat:14.79944, lng:98.59694, water:'แม่น้ำแควน้อย', agency:'กฟผ.', source:'EGAT / public geodata'},
  {name:'เขื่อนศรีนครินทร์', kind:'เขื่อน', lat:14.40861, lng:99.12833, water:'แม่น้ำแควใหญ่', agency:'กฟผ.', source:'EGAT / public geodata'},
  {name:'เขื่อนท่าทุ่งนา', kind:'เขื่อน', lat:14.23361, lng:99.23583, water:'แม่น้ำแควใหญ่', agency:'กฟผ.', source:'EGAT schematic / public geodata'},
  {name:'เขื่อนแม่กลอง', kind:'เขื่อนทดน้ำ', lat:13.95479, lng:99.62501, water:'แม่น้ำแม่กลอง', agency:'กรมชลประทาน / กฟผ.', source:'RID / EGAT / public geodata'},
  {name:'ประตูน้ำบางนกแขวก', kind:'ประตูระบายน้ำ', lat:13.4709927, lng:99.9405064, water:'คลองดำเนินสะดวก ↔ แม่น้ำแม่กลอง', agency:'กรมชลประทาน', source:'public government reference'}
];

function googleMapsUrl(lat,lng){
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat+','+lng)}`;
}
function controlIcon(kind){
  const symbol = kind.includes('ประตู') ? '▥' : '▲';
  return L.divIcon({className:'control-div-icon',html:`<span>${symbol}</span>`,iconSize:[28,28],iconAnchor:[14,14]});
}
function escapeHtml(s=''){
  return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function addSeedControls(){
  HYDRAULIC_STRUCTURES.forEach(s=>{
    const popup=`<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.kind)} • ${escapeHtml(s.water)}<br><small>${escapeHtml(s.agency)} • ${escapeHtml(s.source)}</small><br><a href="${googleMapsUrl(s.lat,s.lng)}" target="_blank" rel="noopener">เปิดพิกัดตรวจสอบใน Google Maps ↗</a>`;
    L.marker([s.lat,s.lng],{icon:controlIcon(s.kind)})
      .bindTooltip(s.name,{direction:'top'})
      .bindPopup(popup)
      .addTo(controlLayer);
  });
}
addSeedControls();

let controlLoading=false;
const seenControlFeatures=new Set();
function wayName(tags={}){
  return tags['name:th'] || tags.name || tags['name:en'] || '';
}
function buildControlQuery(bounds){
  const s=bounds.getSouth().toFixed(5), w=bounds.getWest().toFixed(5), n=bounds.getNorth().toFixed(5), e=bounds.getEast().toFixed(5);
  return `[out:json][timeout:30];(nwr["name"]["waterway"~"^(dam|weir|lock_gate|sluice_gate)$"](${s},${w},${n},${e});nwr["name"]["barrier"="sluice_gate"](${s},${w},${n},${e}););out center tags;`;
}
async function loadNamedControls(){
  if(controlLoading || !document.getElementById('controlToggle')?.checked || !map.hasLayer(controlLayer)) return;
  const bounds=normalizedBounds(); if(!bounds) return;
  controlLoading=true;
  try{
    const data=await overpassFetch(buildControlQuery(bounds));
    for(const el of (data.elements||[])){
      const id=`${el.type}/${el.id}`; if(seenControlFeatures.has(id)) continue;
      const lat=el.lat ?? el.center?.lat, lng=el.lon ?? el.center?.lon;
      const name=wayName(el.tags||{}); if(!lat || !lng || !name) continue;
      if(HYDRAULIC_STRUCTURES.some(s=>Math.abs(s.lat-lat)<0.003 && Math.abs(s.lng-lng)<0.003)) continue;
      seenControlFeatures.add(id);
      const wt=el.tags?.waterway || el.tags?.barrier || 'control';
      const kind=wt==='dam'?'เขื่อน':wt==='weir'?'ฝาย':'ประตู/อาคารควบคุมน้ำ';
      L.marker([lat,lng],{icon:controlIcon(kind)})
        .bindTooltip(name,{direction:'top'})
        .bindPopup(`<b>${escapeHtml(name)}</b><br>${kind}<br><small>ตำแหน่งจาก OpenStreetMap • ${id}</small><br><a href="${googleMapsUrl(lat,lng)}" target="_blank" rel="noopener">ตรวจใน Google Maps ↗</a>`)
        .addTo(controlLayer);
    }
  }catch(err){ console.warn('control structures load failed',err); }
  finally{controlLoading=false;}
}

// Study envelope only — NOT an official Mae Klong basin polygon.
L.rectangle(BASIN_VIEW, {
  weight: 2,
  dashArray: '8 8',
  fillOpacity: 0.03
}).bindTooltip('กรอบศึกษาลุ่มน้ำแม่กลอง — Prototype ไม่ใช่ขอบเขตทางการ').addTo(basinLayer);

// ---------------------------------------------------------------------------
// REAL HYDROLOGICAL CONNECTION ROUTES — OSM GEOMETRY ONLY
// ---------------------------------------------------------------------------
const ROUTE_DEFS = [
  {id:'khwae-noi', label:'แม่น้ำแควน้อย • สาขาเขื่อนวชิราลงกรณ', terms:['แควน้อย','Khwae Noi','Kwae Noi'], type:'river'},
  {id:'khwae-yai', label:'แม่น้ำแควใหญ่ • ศรีนครินทร์–ท่าทุ่งนา', terms:['แควใหญ่','Khwae Yai','Kwae Yai'], type:'river'},
  {id:'mae-klong', label:'แม่น้ำแม่กลอง • ลำน้ำหลักถึงเขื่อนแม่กลอง/ปลายน้ำ', terms:['แม่กลอง','Mae Klong'], type:'river'},
  {id:'damnoen', label:'คลองดำเนินสะดวก • สาขาประตูน้ำบางนกแขวก', terms:['ดำเนินสะดวก','Damnoen Saduak'], type:'canal'}
];
const ROUTE_REGEX = ROUTE_DEFS.flatMap(r=>r.terms).join('|');
const routeSeen = new Set();
const routeStats = Object.fromEntries(ROUTE_DEFS.map(r=>[r.id,0]));
const ROUTE_CACHE_KEY='maeklong-route-v05-osm';
const WATER_CACHE_TTL = 24 * 60 * 60 * 1000;

function normalizeWaterName(name=''){
  return String(name).trim().toLowerCase().replace(/แม่น้ำ|คลอง/g,'').replace(/river|canal/g,'').replace(/\s+/g,' ');
}
function routeDefForName(name=''){
  const n=normalizeWaterName(name);
  return ROUTE_DEFS.find(r=>r.terms.some(t=>n.includes(normalizeWaterName(t)))) || null;
}
function routeStyle(def){
  const z=map.getZoom();
  if(def?.type==='canal') return {color:'#168aa8',weight:z>=10?4.2:3.2,opacity:.88};
  return {color:'#1565b8',weight:z>=10?5.6:4.2,opacity:.92};
}
function routeStatus(text){
  const el=document.getElementById('routeStatus'); if(el) el.textContent=text;
}
function routeSummary(){
  const parts=ROUTE_DEFS.map(r=>`${r.label.split(' • ')[0]} ${routeStats[r.id]||0}`);
  const missing=ROUTE_DEFS.filter(r=>!routeStats[r.id]);
  let text=parts.join(' • ');
  if(missing.length) text += ' • ขาดช่วง: '+missing.map(r=>r.label.split(' • ')[0]).join(', ')+' (ไม่สร้างเส้นทดแทน)';
  return text;
}
function basinBBox(){
  const b=BASIN_VIEW;
  return `${b.getSouth().toFixed(5)},${b.getWest().toFixed(5)},${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)}`;
}
function buildRouteQuery(){
  const bbox=basinBBox();
  const rx=ROUTE_REGEX.replace(/"/g,'\\"');
  // Query both ways and waterway relations. Some OSM river relations carry the
  // name on the relation while member ways may be unnamed.
  return `[out:json][timeout:45];(`+
    `way["waterway"~"^(river|canal)$"]["name"~"${rx}",i](${bbox});`+
    `way["waterway"~"^(river|canal)$"]["name:th"~"${rx}",i](${bbox});`+
    `way["waterway"~"^(river|canal)$"]["name:en"~"${rx}",i](${bbox});`+
    `rel["type"="waterway"]["name"~"${rx}",i](${bbox});`+
    `rel["type"="waterway"]["name:th"~"${rx}",i](${bbox});`+
    `rel["type"="waterway"]["name:en"~"${rx}",i](${bbox});`+
  `);out tags geom;`;
}
function addRoutePolyline(coords, def, sourceId, name){
  if(!def || !Array.isArray(coords) || coords.length<2) return 0;
  const key=`${sourceId}:${coords.length}:${coords[0][0].toFixed(5)},${coords[0][1].toFixed(5)}`;
  if(routeSeen.has(key)) return 0;
  routeSeen.add(key);
  L.polyline(coords,routeStyle(def))
    .bindTooltip(`${escapeHtml(name || def.label)} • เส้นทางน้ำจริง`,{sticky:true})
    .bindPopup(`<b>${escapeHtml(name || def.label)}</b><br>เส้นทางจาก OpenStreetMap เท่านั้น<br><small>${escapeHtml(sourceId)}</small><br><b>ไม่มีการลากเส้นเติมช่องว่าง</b>`)
    .addTo(routeLayer);
  routeStats[def.id]=(routeStats[def.id]||0)+1;
  return 1;
}
function addRouteData(data){
  let added=0;
  for(const el of (data.elements||[])){
    if(el.type==='way' && Array.isArray(el.geometry)){
      const name=wayName(el.tags||{});
      const def=routeDefForName(name);
      const coords=el.geometry.map(p=>[p.lat,p.lon]);
      added+=addRoutePolyline(coords,def,`OSM way ${el.id}`,name);
    }else if(el.type==='relation' && Array.isArray(el.members)){
      const relName=wayName(el.tags||{});
      const def=routeDefForName(relName);
      if(!def) continue;
      for(const m of el.members){
        if(m.type!=='way' || !Array.isArray(m.geometry)) continue;
        const coords=m.geometry.map(p=>[p.lat,p.lon]);
        added+=addRoutePolyline(coords,def,`OSM relation ${el.id} / way ${m.ref}`,relName);
      }
    }
  }
  return added;
}
async function loadConnectionRoutes(){
  if(routeLoading || !document.getElementById('routeToggle')?.checked || !map.hasLayer(routeLayer)) return;
  routeLoading=true;
  routeStatus('กำลังโหลด geometry ทางน้ำจริงจาก OSM…');
  try{
    let data=cacheGet(ROUTE_CACHE_KEY);
    let source='cache';
    if(!data){
      data=await overpassFetch(buildRouteQuery());
      cachePut(ROUTE_CACHE_KEY,data); source='OSM สด';
    }
    addRouteData(data);
    routeStatus(`${source} • ${routeSummary()}`);
  }catch(err){
    console.error('connection routes load failed',err);
    routeStatus('โหลดเส้นทางจริงไม่สำเร็จ — ไม่สร้างเส้นสำรอง');
  }finally{routeLoading=false;}
}

// ---------------------------------------------------------------------------
// CURATED MAJOR NAMED CANALS — OSM GEOMETRY ONLY
// Minor streams/drains are intentionally excluded.
// ---------------------------------------------------------------------------
const MAJOR_CANAL_KEYWORDS = [
  'ภาษีเจริญ','phasi charoen',
  'มหาชัย','mahachai',
  'สุนัขหอน','sunak hon','sunakhon',
  'บางนกแขวก','bang nok khwaek','bang nok kwaek',
  'จินดา','jinda'
];
const canalSeen=new Set();
let canalCount=0;

function waterStatus(text){
  const el = document.getElementById('waterStatus'); if(el) el.textContent = text;
}
function normalizedName(name=''){
  return String(name).trim().toLowerCase().replace(/คลอง/g,'').replace(/\s+/g,' ');
}
function isMajorCanal(name=''){
  const n=normalizedName(name);
  return !!n && MAJOR_CANAL_KEYWORDS.some(k=>n.includes(normalizedName(k)));
}
function canalStyle(){
  const z=map.getZoom();
  return {color:'#4aa9c8',weight:z>=12?3.4:2.6,opacity:.78,dashArray:z>=11?null:'6 4'};
}
function buildCanalQuery(bounds){
  const s=bounds.getSouth().toFixed(5), w=bounds.getWest().toFixed(5), n=bounds.getNorth().toFixed(5), e=bounds.getEast().toFixed(5);
  return `[out:json][timeout:30];(way["waterway"="canal"]["name"](${s},${w},${n},${e});way["waterway"="canal"]["name:th"](${s},${w},${n},${e});way["waterway"="canal"]["name:en"](${s},${w},${n},${e}););out tags geom;`;
}
function normalizedBounds(){
  const b = map.getBounds().pad(0.12);
  const south = Math.max(b.getSouth(), BASIN_VIEW.getSouth());
  const west  = Math.max(b.getWest(),  BASIN_VIEW.getWest());
  const north = Math.min(b.getNorth(), BASIN_VIEW.getNorth());
  const east  = Math.min(b.getEast(),  BASIN_VIEW.getEast());
  if(south >= north || west >= east) return null;
  return L.latLngBounds([south,west],[north,east]);
}
function cacheKey(bounds){
  const r=x=>(Math.round(x*10)/10).toFixed(1);
  return `canal-v05-major:${r(bounds.getSouth())},${r(bounds.getWest())},${r(bounds.getNorth())},${r(bounds.getEast())}`;
}
function cacheGet(key){
  try{
    const raw=localStorage.getItem(key); if(!raw) return null;
    const obj=JSON.parse(raw);
    if(Date.now()-obj.savedAt > WATER_CACHE_TTL){localStorage.removeItem(key);return null;}
    return obj.data;
  }catch(_){return null;}
}
function cachePut(key,data){
  try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),data}));}catch(_){/* quota/full — ignore */}
}
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
async function overpassFetch(query){
  let lastErr;
  for(const endpoint of OVERPASS_ENDPOINTS){
    try{
      const controller = new AbortController();
      const timer=setTimeout(()=>controller.abort(),50000);
      const res=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body:'data='+encodeURIComponent(query),
        signal:controller.signal
      });
      clearTimeout(timer);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }catch(err){lastErr=err;}
  }
  throw lastErr || new Error('Overpass unavailable');
}
function addCanalWays(data){
  let added=0;
  for(const el of (data.elements||[])){
    if(el.type!=='way' || !Array.isArray(el.geometry) || el.geometry.length<2) continue;
    const name=wayName(el.tags||{});
    if(!isMajorCanal(name)) continue;
    const unique=`way/${el.id}`; if(canalSeen.has(unique)) continue;
    canalSeen.add(unique);
    const coords=el.geometry.map(p=>[p.lat,p.lon]);
    L.polyline(coords,canalStyle())
      .bindTooltip(`${escapeHtml(name)} • คลองหลัก`,{sticky:true})
      .bindPopup(`<b>${escapeHtml(name)}</b><br>คลองหลักจาก OpenStreetMap<br><small>OSM way ${el.id}</small><br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}" target="_blank" rel="noopener">ตรวจชื่อใน Google Maps ↗</a>`)
      .addTo(canalLayer);
    canalCount++; added++;
  }
  return added;
}
async function loadMajorCanals(){
  if(canalLoading || !document.getElementById('waterToggle')?.checked || !map.hasLayer(canalLayer)) return;
  const bounds=normalizedBounds(); if(!bounds) return;
  canalLoading=true;
  waterStatus('กำลังโหลดคลองหลักที่มีชื่อ…');
  try{
    const key=cacheKey(bounds);
    let data=cacheGet(key); let source='cache';
    if(!data){data=await overpassFetch(buildCanalQuery(bounds));cachePut(key,data);source='OSM สด';}
    const added=addCanalWays(data);
    waterStatus(`${source} • ${canalCount.toLocaleString('th-TH')} ช่วง`+(added?` (+${added})`:'') );
  }catch(err){
    console.error('major canals load failed',err);
    waterStatus('โหลดคลองหลักไม่สำเร็จ');
  }finally{canalLoading=false;}
}
function scheduleCanalLoad(delay=450){
  clearTimeout(canalFetchTimer);
  canalFetchTimer=setTimeout(loadMajorCanals,delay);
}

map.on('moveend zoomend',()=>{
  scheduleCanalLoad();
  setTimeout(loadNamedControls,850);
});



function setMode(mode){
  currentMode=mode;
  document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  const live=mode==='live', basin=mode==='basin';
  document.getElementById('liveCard').hidden=!live;
  document.getElementById('emergencyCard').hidden=!live;
  // Basin text cards are intentionally reserved/hidden in v0.8; map layers remain available.
  document.getElementById('basinCard').hidden=true;
  document.getElementById('dataCard').hidden=true;
  document.getElementById('reportBtn').disabled=!live;
  document.getElementById('reportBtn').hidden=!live;
  if(map.hasLayer(basinLayer))map.removeLayer(basinLayer);
  floodAreaLayer.clearLayers();
  if(live){
    document.getElementById('modeBadge').textContent='LIVE • รายงานสถานการณ์';
    map.setView([13.62,99.95],9);
    renderEmergency();
    if(document.getElementById('basinToggle').checked)basinLayer.addTo(map);
  }else{
    document.getElementById('modeBadge').textContent='BASIN • เส้นทางน้ำจริง';
    basinLayer.addTo(map);map.fitBounds(BASIN_VIEW);
  }
  loadConnectionRoutes();scheduleCanalLoad(600);
}
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));

map.on('click',ev=>{
  if(currentMode!=='live'||!pickOnMap)return;
  setPicked(ev.latlng.lat,ev.latlng.lng,'map');
  pickOnMap=false; pickerBar(false);
  document.getElementById('reportDialog').showModal();
});

function useCurrentGps(){
  const pickedEl=document.getElementById('picked');
  if(!navigator.geolocation){pickedEl.textContent='อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับ GPS';return;}
  pickedEl.textContent='กำลังอ่านตำแหน่ง GPS…';
  navigator.geolocation.getCurrentPosition(
    p=>{
      setPicked(p.coords.latitude,p.coords.longitude,'gps',p.coords.accuracy);
      map.setView(picked,Math.max(map.getZoom(),14));
      pickOnMap=false; pickerBar(false);
      const dlg=document.getElementById('reportDialog'); if(!dlg.open)dlg.showModal();
    },
    err=>{
      const msg=err.code===1?'ยังไม่ได้อนุญาตตำแหน่ง GPS':err.code===2?'หา GPS ไม่พบ':'อ่าน GPS หมดเวลา';
      pickedEl.textContent=`${msg} — กรุณาเลือกจากแผนที่`;
      if(pickOnMap){ const dlg=document.getElementById('reportDialog'); if(!dlg.open)dlg.showModal(); pickOnMap=false; pickerBar(false); }
    },
    {enableHighAccuracy:true,timeout:10000,maximumAge:30000}
  );
}

document.getElementById('reportBtn').onclick=()=>openReport('flood');
document.getElementById('closeReport').onclick=cancelReportFlow;
document.getElementById('locateBtn').onclick=useCurrentGps;
document.getElementById('pickOnMapBtn').onclick=()=>{
  pickOnMap=true;
  document.getElementById('reportDialog').close();
  pickerBar(true);
};
document.getElementById('mapPickGps').onclick=useCurrentGps;
document.getElementById('mapPickBack').onclick=()=>{pickOnMap=false;pickerBar(false);document.getElementById('reportDialog').showModal();};
document.getElementById('mapPickCancel').onclick=cancelReportFlow;
document.getElementById('reportDialog').addEventListener('cancel',e=>{e.preventDefault();cancelReportFlow();});
document.getElementById('reportDialog').addEventListener('click',e=>{if(e.target===e.currentTarget)cancelReportFlow();});
document.getElementById('reportForm').addEventListener('submit',submitReport);

document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-report-action]'); if(!btn)return;
  const id=btn.dataset.reportId, action=btn.dataset.reportAction;
  const r=reports.find(x=>String(x.id)===String(id));
  if(!r || !isOwnedLocalReport(r))return;
  if(action==='edit'){map.closePopup();openReport(r.type_code,r);return;}
  if(action==='resolve'){
    r.emergency_status='resolved'; r.updated_at=new Date().toISOString(); r.resolved_at=r.updated_at;
    saveReports();map.closePopup();renderEmergency();return;
  }
  if(action==='delete'){
    if(!confirm('ลบหมุดนี้ออกจากเครื่องนี้ใช่ไหม? การลบย้อนกลับไม่ได้'))return;
    reports=reports.filter(x=>String(x.id)!==String(id));
    saveReports();map.closePopup();renderEmergency();
  }
});

document.getElementById('freshOnly').onchange=renderEmergency;
document.getElementById('historyToggle').onchange=renderEmergency;
document.getElementById('heatToggle').onchange=()=>renderEmergency();
document.getElementById('emergencyToggle').onchange=e=>{if(e.target.checked){emergencyLayer.addTo(map);renderEmergency();}else map.removeLayer(emergencyLayer);};
document.getElementById('routeToggle').onchange=e=>{if(e.target.checked){routeLayer.addTo(map);loadConnectionRoutes();}else map.removeLayer(routeLayer);};
document.getElementById('waterToggle').onchange=e=>{if(e.target.checked){canalLayer.addTo(map);scheduleCanalLoad(50);}else map.removeLayer(canalLayer);};
document.getElementById('basinToggle').onchange=e=>e.target.checked?basinLayer.addTo(map):map.removeLayer(basinLayer);
document.getElementById('controlToggle').onchange=e=>{if(e.target.checked){controlLayer.addTo(map);loadNamedControls();}else map.removeLayer(controlLayer);};

renderEmergency();
setMode('live');
loadConnectionRoutes();
scheduleCanalLoad(900);
setTimeout(loadNamedControls,1400);
setInterval(renderEmergency,60000);
