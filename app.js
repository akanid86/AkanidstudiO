// Flood Map — Mae Klong Basin prototype v0.3
// REAL WATERWAYS: waterway geometries are loaded from OpenStreetMap via Overpass API.
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
const waterStats = { river: 0, canal: 0, stream: 0, drain: 0, other: 0 };

function waterStatus(text){
  const el = document.getElementById('waterStatus');
  if(el) el.textContent = text;
}

function requestedWaterTypes(zoom){
  if(zoom < 8) return ['river'];
  if(zoom < 11) return ['river','canal'];
  if(zoom < 13) return ['river','canal','stream'];
  return ['river','canal','stream','drain'];
}

function waterStyle(type){
  const z = map.getZoom();
  const styles = {
    river:  { weight: z >= 11 ? 4.2 : 3.2, opacity: .82 },
    canal:  { weight: z >= 12 ? 3.0 : 2.2, opacity: .72, dashArray: z >= 12 ? null : '7 4' },
    stream: { weight: 1.6, opacity: .58 },
    drain:  { weight: 1.1, opacity: .45, dashArray: '3 5' }
  };
  return styles[type] || { weight: 1.2, opacity: .45 };
}

function escapeHtml(s=''){
  return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function wayName(tags={}){
  return tags['name:th'] || tags.name || tags['name:en'] || '';
}

function buildOverpassQuery(bounds, types){
  const s=bounds.getSouth().toFixed(5), w=bounds.getWest().toFixed(5),
        n=bounds.getNorth().toFixed(5), e=bounds.getEast().toFixed(5);
  const typeRegex = types.join('|');
  return `[out:json][timeout:35];way["waterway"~"^(${typeRegex})$"](${s},${w},${n},${e});out tags geom;`;
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
  return `water-v03:${types.join(',')}:${r(bounds.getSouth())},${r(bounds.getWest())},${r(bounds.getNorth())},${r(bounds.getEast())}`;
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
    const coords=el.geometry.map(p=>[p.lat,p.lon]);
    const line=L.polyline(coords,waterStyle(type));
    const name=wayName(tags);
    const typeTh={river:'แม่น้ำ',canal:'คลอง',stream:'ลำห้วย/ลำธาร',drain:'ทางระบายน้ำ'}[type]||type;
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
  const zoom=map.getZoom();
  const types=requestedWaterTypes(zoom);
  const key=cacheKey(bounds,types);
  waterLoading=true;
  waterStatus(`กำลังโหลด ${types.join(' / ')}…`);
  try{
    let data=cacheGet(key);
    let source='cache';
    if(!data){
      data=await overpassFetch(buildOverpassQuery(bounds,types));
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

map.on('moveend zoomend',()=>scheduleWaterLoad());

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
document.querySelector('#helpToggle').onchange=e=>e.target.checked?helpLayer.addTo(map):map.removeLayer(helpLayer);

setMode('live');
scheduleWaterLoad(900);
