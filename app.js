// Flood Map — Mae Klong Basin prototype v0.4
// MAJOR WATERWAYS: named rivers + curated major named canals only. Geometry is loaded from OpenStreetMap via Overpass API.
// Hydraulic structures: verified seed points + named OSM control structures. Google Maps is used only as a visual cross-check link, not scraped as a dataset.
// The basin outline is still a study envelope (NOT an official basin boundary).
// Public Overpass endpoints are suitable for prototype/light use only; production should host a curated GeoJSON/vector-tile snapshot.

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
let waterLoading = false;
let waterFetchTimer = null;

const floodLayer = L.layerGroup().addTo(map);
const helpLayer = L.layerGroup().addTo(map);
const waterLayer = L.layerGroup().addTo(map);
const basinLayer = L.layerGroup();
const infographicLayer = L.layerGroup();
const controlLayer = L.layerGroup().addTo(map);

// ---------------------------------------------------------------------------
// DAMS / WATER CONTROL STRUCTURES
// Seed coordinates are from public/official references; each popup includes a
// Google Maps check link so the user can visually verify the point.
// ---------------------------------------------------------------------------
const HYDRAULIC_STRUCTURES = [
  {name:'เขื่อนศรีนครินทร์', kind:'เขื่อน', lat:14.40861, lng:99.12833, water:'แม่น้ำแควใหญ่', agency:'กฟผ.', source:'EGAT / public geodata'},
  {name:'เขื่อนวชิราลงกรณ', kind:'เขื่อน', lat:14.79940, lng:98.59690, water:'แม่น้ำแควน้อย', agency:'กฟผ.', source:'EGAT / ThaiWater reference'},
  {name:'เขื่อนแม่กลอง', kind:'เขื่อนทดน้ำ', lat:13.95479, lng:99.62501, water:'แม่น้ำแม่กลอง', agency:'กรมชลประทาน / กฟผ.', source:'RID / EGAT / public geodata'},
  {name:'ประตูน้ำบางนกแขวก', kind:'ประตูระบายน้ำ', lat:13.4709927, lng:99.9405064, water:'คลองดำเนินสะดวก ↔ แม่น้ำแม่กลอง', agency:'กรมชลประทาน', source:'กระทรวงวัฒนธรรม / RID'}
];

function googleMapsUrl(lat,lng){
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat+','+lng)}`;
}
function controlIcon(kind){
  const symbol = kind.includes('ประตู') ? '▥' : '▲';
  return L.divIcon({className:'control-div-icon',html:`<span>${symbol}</span>`,iconSize:[28,28],iconAnchor:[14,14]});
}
function addSeedControls(){
  HYDRAULIC_STRUCTURES.forEach(s=>{
    const popup=`<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.kind)} • ${escapeHtml(s.water)}<br><small>${escapeHtml(s.agency)} • ${escapeHtml(s.source)}</small><br><a href="${googleMapsUrl(s.lat,s.lng)}" target="_blank" rel="noopener">เปิดพิกัดตรวจสอบใน Google Maps ↗</a>`;
    L.marker([s.lat,s.lng],{icon:controlIcon(s.kind)}).bindTooltip(s.name,{direction:'top'}).bindPopup(popup).addTo(controlLayer);
  });
}
addSeedControls();

let controlLoading=false;
const seenControlFeatures=new Set();
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
      L.marker([lat,lng],{icon:controlIcon(kind)}).bindTooltip(name,{direction:'top'})
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

// Infographic arrows / zones — conceptual presentation layer only.
[
  [[15.05,98.52],[14.45,98.90]],
  [[14.42,98.92],[13.95,99.40]],
  [[13.92,99.43],[13.48,99.90]],
  [[13.47,99.92],[13.34,100.03]]
].forEach(seg => L.polyline(seg,{weight:8,opacity:.28}).addTo(infographicLayer));

// ---------------------------------------------------------------------------
// REAL WATERWAYS — OpenStreetMap / Overpass
// ---------------------------------------------------------------------------
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const WATER_CACHE_TTL = 24 * 60 * 60 * 1000;
const seenWaterWays = new Set();
const waterStats = { river: 0, canal: 0, other: 0 };

// Curated major canals. Names are kept intentionally short to avoid minor/local canal clutter.
// The list is based on major named canals visible in common map references and relevant to the Mae Klong/Tha Chin connection.
const MAJOR_CANAL_KEYWORDS = [
  'ดำเนินสะดวก','damnoen saduak',
  'ภาษีเจริญ','phasi charoen',
  'มหาชัย','mahachai',
  'สุนัขหอน','sunak hon','sunakhon',
  'บางนกแขวก','bang nok khwaek','bang nok kwaek',
  'จินดา','jinda'
];

function waterStatus(text){
  const el = document.getElementById('waterStatus');
  if(el) el.textContent = text;
}

function requestedWaterTypes(){
  return ['river','canal'];
}

function waterStyle(type){
  const z = map.getZoom();
  const styles = {
    river:  { weight: z >= 11 ? 4.8 : 3.6, opacity: .86 },
    canal:  { weight: z >= 12 ? 3.4 : 2.6, opacity: .78 }
  };
  return styles[type] || { weight: 1.8, opacity: .55 };
}

function normalizedName(name=''){
  return String(name).trim().toLowerCase().replace(/คลอง/g,'').replace(/\s+/g,' ');
}

function isMajorCanal(name=''){
  const n=normalizedName(name);
  return !!n && MAJOR_CANAL_KEYWORDS.some(k=>n.includes(k.toLowerCase().replace(/คลอง/g,'')));
}

function escapeHtml(s=''){
  return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function wayName(tags={}){
  return tags['name:th'] || tags.name || tags['name:en'] || '';
}

function buildOverpassQuery(bounds){
  const s=bounds.getSouth().toFixed(5), w=bounds.getWest().toFixed(5),
        n=bounds.getNorth().toFixed(5), e=bounds.getEast().toFixed(5);
  // Rivers: named only. Canals: named only, then client-side curated major-name filter.
  return `[out:json][timeout:35];(way["waterway"="river"]["name"](${s},${w},${n},${e});way["waterway"="canal"]["name"](${s},${w},${n},${e}););out tags geom;`;
}

function normalizedBounds(){
  // Clip current viewport to the study envelope and slightly pad to avoid visible seams.
  const b = map.getBounds().pad(0.12);
  const south = Math.max(b.getSouth(), BASIN_VIEW.getSouth());
  const west  = Math.max(b.getWest(),  BASIN_VIEW.getWest());
  const north = Math.min(b.getNorth(), BASIN_VIEW.getNorth());
  const east  = Math.min(b.getEast(),  BASIN_VIEW.getEast());
  if(south >= north || west >= east) return null;
  return L.latLngBounds([south,west],[north,east]);
}

function cacheKey(bounds, types){
  // Coarse rounding means nearby pans can reuse the same prototype cache.
  const r=x=>(Math.round(x*10)/10).toFixed(1);
  return `water-v04-major:${types.join(',')}:${r(bounds.getSouth())},${r(bounds.getWest())},${r(bounds.getNorth())},${r(bounds.getEast())}`;
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

async function overpassFetch(query){
  let lastErr;
  for(const endpoint of OVERPASS_ENDPOINTS){
    try{
      const controller = new AbortController();
      const timer=setTimeout(()=>controller.abort(),45000);
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

function addWaterWays(data){
  let added=0;
  for(const el of (data.elements||[])){
    if(el.type!=='way' || !Array.isArray(el.geometry) || el.geometry.length<2) continue;
    const unique=`way/${el.id}`;
    if(seenWaterWays.has(unique)) continue;
    seenWaterWays.add(unique);
    const tags=el.tags||{};
    const type=tags.waterway||'other';
    const name=wayName(tags);
    if(type==='canal' && !isMajorCanal(name)) continue;
    if(type==='river' && !name) continue;
    const coords=el.geometry.map(p=>[p.lat,p.lon]);
    const line=L.polyline(coords,waterStyle(type));
    const typeTh={river:'แม่น้ำหลัก',canal:'คลองหลัก'}[type]||type;
    const label=name ? `${escapeHtml(name)} • ${typeTh}` : typeTh;
    line.bindTooltip(label,{sticky:true});
    line.bindPopup(`<b>${label}</b><br><small>OpenStreetMap way ${el.id}</small>`);
    line.addTo(waterLayer);
    waterStats[type]=(waterStats[type]||0)+1;
    added++;
  }
  return added;
}

async function loadRealWaterways(){
  if(waterLoading || !document.getElementById('waterToggle').checked || !map.hasLayer(waterLayer)) return;
  const bounds=normalizedBounds(); if(!bounds) return;
  const types=requestedWaterTypes();
  const key=cacheKey(bounds,types);
  waterLoading=true;
  waterStatus('กำลังโหลดแม่น้ำหลัก / คลองหลักที่มีชื่อ…');
  try{
    let data=cacheGet(key);
    let source='cache';
    if(!data){
      data=await overpassFetch(buildOverpassQuery(bounds));
      cachePut(key,data); source='OSM สด';
    }
    const added=addWaterWays(data);
    const total=Object.values(waterStats).reduce((a,b)=>a+b,0);
    waterStatus(`${source} • ${total.toLocaleString('th-TH')} เส้น`+(added?` (+${added})`:''));
  }catch(err){
    console.error('Real waterways load failed',err);
    waterStatus('โหลด OSM ไม่สำเร็จ — ฐานแผนที่ยังใช้งานได้');
  }finally{ waterLoading=false; }
}

function scheduleWaterLoad(delay=450){
  clearTimeout(waterFetchTimer);
  waterFetchTimer=setTimeout(loadRealWaterways,delay);
}

map.on('moveend zoomend',()=>{scheduleWaterLoad();setTimeout(loadNamedControls,850);});

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
  const info = mode==='infographic';

  document.getElementById('liveCard').hidden = !live;
  document.getElementById('basinCard').hidden = !basin;
  document.getElementById('infographicCard').hidden = !info;
  document.getElementById('reportBtn').disabled = !live;
  document.getElementById('helpBtn').disabled = !live;

  [basinLayer, infographicLayer].forEach(layer=>{ if(map.hasLayer(layer)) map.removeLayer(layer); });
  if(heat && map.hasLayer(heat)) map.removeLayer(heat);

  if(live){
    document.getElementById('modeBadge').textContent='LIVE • รายงานประชาชน';
    map.setView([13.62,99.95],9);
    if(document.querySelector('#heatToggle').checked) heat.addTo(map);
    if(document.querySelector('#basinToggle').checked) basinLayer.addTo(map);
  }
  if(basin){
    document.getElementById('modeBadge').textContent='BASIN • ภาพรวมลุ่มน้ำ';
    basinLayer.addTo(map);
    map.fitBounds(BASIN_VIEW);
  }
  if(info){
    document.getElementById('modeBadge').textContent='INFOGRAPHIC • อธิบายภาพรวม';
    basinLayer.addTo(map);
    infographicLayer.addTo(map);
    map.fitBounds(BASIN_VIEW);
  }
  scheduleWaterLoad(700);
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
document.querySelector('#waterToggle').onchange=e=>{
  if(e.target.checked){ waterLayer.addTo(map); scheduleWaterLoad(50); }
  else map.removeLayer(waterLayer);
};
document.querySelector('#basinToggle').onchange=e=>e.target.checked?basinLayer.addTo(map):map.removeLayer(basinLayer);
document.querySelector('#controlToggle').onchange=e=>{if(e.target.checked){controlLayer.addTo(map);loadNamedControls();}else map.removeLayer(controlLayer);};
document.querySelector('#helpToggle').onchange=e=>e.target.checked?helpLayer.addTo(map):map.removeLayer(helpLayer);

setMode('live');
scheduleWaterLoad(900);
setTimeout(loadNamedControls,1400);
