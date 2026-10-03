// Flood Map — Mae Klong Basin prototype v0.2
// Important: basin boundary and waterways below are schematic prototype geometry only.
// Replace with verified/licensed GeoJSON before public release.

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

const floodLayer = L.layerGroup().addTo(map);
const helpLayer = L.layerGroup().addTo(map);
const waterLayer = L.layerGroup().addTo(map);
const basinLayer = L.layerGroup();
const infographicLayer = L.layerGroup();

// Prototype basin study envelope — NOT an official basin boundary.
L.rectangle(BASIN_VIEW, {
  weight: 2,
  dashArray: '8 8',
  fillOpacity: 0.03
}).bindTooltip('กรอบศึกษาลุ่มน้ำแม่กลอง — Prototype ไม่ใช่ขอบเขตทางการ').addTo(basinLayer);

// Schematic Mae Klong flow spine for concept testing only.
const maeKlongSpine = [
  [15.15, 98.45], [14.82, 98.60], [14.48, 98.86],
  [14.18, 99.10], [13.92, 99.44], [13.68, 99.70],
  [13.48, 99.92], [13.36, 100.00]
];
L.polyline(maeKlongSpine, {weight:5, opacity:.72})
  .bindTooltip('แนวการไหลแม่กลอง (เส้นสาธิต)').addTo(waterLayer);

// Simplified Tha Chin lower river context. It is shown only as nearby hydrologic context.
L.polyline([[14.25,100.13],[13.95,100.10],[13.72,100.16],[13.54,100.27],[13.48,100.28]], {weight:3, opacity:.48, dashArray:'6 6'})
  .bindTooltip('ท่าจีนตอนล่าง (Context สาธิต)').addTo(waterLayer);

// Infographic arrows / zones — conceptual presentation layer only.
[
  [[15.05,98.52],[14.45,98.90]],
  [[14.42,98.92],[13.95,99.40]],
  [[13.92,99.43],[13.48,99.90]],
  [[13.47,99.92],[13.34,100.03]]
].forEach(seg => L.polyline(seg,{weight:8,opacity:.28}).addTo(infographicLayer));

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
document.querySelector('#waterToggle').onchange=e=>e.target.checked?waterLayer.addTo(map):map.removeLayer(waterLayer);
document.querySelector('#basinToggle').onchange=e=>e.target.checked?basinLayer.addTo(map):map.removeLayer(basinLayer);
document.querySelector('#helpToggle').onchange=e=>e.target.checked?helpLayer.addTo(map):map.removeLayer(helpLayer);

setMode('live');
