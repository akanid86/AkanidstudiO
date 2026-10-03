// Flood Map — Mae Klong Basin prototype v0.5
// REAL WATER CONNECTIONS
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

const reports = [
  {id:1,type:'flood',lat:13.548,lng:100.274,level:.25,car:'ผ่านได้',walk:'ผ่านได้',note:'ตัวอย่างข้อมูลสาธิต',time:Date.now()-18*60000},
  {id:2,type:'flood',lat:13.409,lng:100.001,level:.55,car:'ผ่านลำบาก',walk:'ไม่ควรผ่าน',note:'ตัวอย่างข้อมูลสาธิต',time:Date.now()-42*60000},
  {id:3,type:'help',lat:13.521,lng:100.184,level:.9,car:'ผ่านไม่ได้',walk:'ไม่ควรผ่าน',note:'ต้องการน้ำดื่ม (ข้อมูลสาธิต)',time:Date.now()-12*60000}
];

let picked = null;
let heat = null;
let currentMode = 'live';
let routeLoading = false;
let canalLoading = false;
let canalFetchTimer = null;

const floodLayer = L.layerGroup().addTo(map);
const helpLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const canalLayer = L.layerGroup().addTo(map);
const basinLayer = L.layerGroup();
const controlLayer = L.layerGroup().addTo(map);

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

function age(t){
  const m=Math.round((Date.now()-t)/60000);
  return m<60 ? `${m} นาทีที่แล้ว` : `${Math.round(m/60)} ชม.ที่แล้ว`;
}
function renderReports(){
  floodLayer.clearLayers();
  helpLayer.clearLayers();
  const heatPts=[];
  let f=0,h=0;
  reports.forEach(r=>{
    const fresh=Math.max(.2,1-(Date.now()-r.time)/(6*3600000));
    if(r.type==='flood'){
      f++;
      heatPts.push([r.lat,r.lng,Math.min(1,r.level*fresh)]);
      L.circleMarker([r.lat,r.lng],{radius:7,weight:2,fillOpacity:.9})
        .bindPopup(`<b>รายงานน้ำท่วม</b><br>ระดับประมาณ ${r.level} ม.<br>รถเล็ก: ${r.car}<br>คนเดิน: ${r.walk}<br>${r.note||''}<br><small>${age(r.time)}</small>`)
        .addTo(floodLayer);
    }else{
      h++;
      L.marker([r.lat,r.lng])
        .bindPopup(`<b>🆘 ขอความช่วยเหลือ</b><br>${r.note}<br><small>${age(r.time)}</small>`)
        .addTo(helpLayer);
    }
  });
  if(heat && map.hasLayer(heat)) map.removeLayer(heat);
  heat=L.heatLayer(heatPts,{radius:38,blur:28,maxZoom:15,minOpacity:.25});
  if(document.querySelector('#heatToggle').checked && currentMode==='live') heat.addTo(map);
  document.querySelector('#floodCount').textContent=f;
  document.querySelector('#helpCount').textContent=h;
}
renderReports();

function setMode(mode){
  currentMode = mode;
  document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  const live = mode==='live';
  const basin = mode==='basin';

  document.getElementById('liveCard').hidden = !live;
  document.getElementById('basinCard').hidden = !basin;
  document.getElementById('reportBtn').disabled = !live;
  document.getElementById('helpBtn').disabled = !live;

  if(map.hasLayer(basinLayer)) map.removeLayer(basinLayer);
  if(heat && map.hasLayer(heat)) map.removeLayer(heat);

  if(live){
    document.getElementById('modeBadge').textContent='LIVE • รายงานประชาชน';
    map.setView([13.62,99.95],9);
    if(document.querySelector('#heatToggle').checked) heat.addTo(map);
    if(document.querySelector('#basinToggle').checked) basinLayer.addTo(map);
  }
  if(basin){
    document.getElementById('modeBadge').textContent='BASIN • เส้นทางน้ำจริง';
    basinLayer.addTo(map);
    map.fitBounds(BASIN_VIEW);
  }
  loadConnectionRoutes();
  scheduleCanalLoad(600);
}

document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));

map.on('click',e=>{
  if(currentMode!=='live') return;
  picked=e.latlng;
  document.querySelector('#picked').textContent=`จุดที่เลือก: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
});

const dlg=document.querySelector('#reportDialog');
function openForm(type){
  if(currentMode!=='live') setMode('live');
  document.querySelector('#reportType').value=type;
  document.querySelector('#formTitle').textContent=type==='help'?'ขอความช่วยเหลือ':'ส่งรายงานน้ำท่วม';
  document.querySelector('#helpFields').hidden=type!=='help';
  picked=null;
  document.querySelector('#picked').textContent='ยังไม่ได้เลือกตำแหน่ง';
  dlg.showModal();
}
document.querySelector('#reportBtn').onclick=()=>openForm('flood');
document.querySelector('#helpBtn').onclick=()=>openForm('help');

document.querySelector('#locateBtn').onclick=()=>{
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(p=>{
    const ll=L.latLng(p.coords.latitude,p.coords.longitude);
    picked=ll;
    map.setView(ll,14);
    document.querySelector('#picked').textContent=`ตำแหน่ง: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  },()=>document.querySelector('#picked').textContent='อ่าน GPS ไม่สำเร็จ กรุณาจิ้มแผนที่');
};

document.querySelector('#reportForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!picked){alert('กรุณาเลือกตำแหน่งบนแผนที่ก่อน');return;}
  const type=document.querySelector('#reportType').value;
  reports.push({
    id:Date.now(), type,
    lat:picked.lat, lng:picked.lng,
    level:+document.querySelector('#level').value,
    car:document.querySelector('#car').value,
    walk:document.querySelector('#walk').value,
    note:type==='help'?`${document.querySelector('#need').value} • ${document.querySelector('#people').value} คน • ${document.querySelector('#note').value}`:document.querySelector('#note').value,
    time:Date.now()
  });
  renderReports();
  dlg.close();
});

document.querySelector('#heatToggle').onchange=e=>{
  if(currentMode!=='live') return;
  e.target.checked?heat.addTo(map):map.removeLayer(heat);
};
document.querySelector('#routeToggle').onchange=e=>{
  if(e.target.checked){routeLayer.addTo(map);loadConnectionRoutes();}
  else map.removeLayer(routeLayer);
};
document.querySelector('#waterToggle').onchange=e=>{
  if(e.target.checked){canalLayer.addTo(map);scheduleCanalLoad(50);}
  else map.removeLayer(canalLayer);
};
document.querySelector('#basinToggle').onchange=e=>e.target.checked?basinLayer.addTo(map):map.removeLayer(basinLayer);
document.querySelector('#controlToggle').onchange=e=>{if(e.target.checked){controlLayer.addTo(map);loadNamedControls();}else map.removeLayer(controlLayer);};
document.querySelector('#helpToggle').onchange=e=>e.target.checked?helpLayer.addTo(map):map.removeLayer(helpLayer);

setMode('live');
loadConnectionRoutes();
scheduleCanalLoad(900);
setTimeout(loadNamedControls,1400);
