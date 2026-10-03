const BOUNDS=L.latLngBounds([13.18,99.82],[13.78,100.45]);
const map=L.map('map',{maxBounds:BOUNDS.pad(.08),minZoom:9,maxZoom:17}).fitBounds(BOUNDS);
// OSM standard tiles require normal web requests with a valid Referer.
// Run this project via HTTP (START_LOCAL_SERVER.bat) or GitHub Pages; do not open index.html as file://.
const baseMap=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,
  attribution:'© OpenStreetMap contributors',
  crossOrigin:true
}).addTo(map);
let tileErrors=0;
baseMap.on('tileerror',()=>{
  tileErrors++;
  if(tileErrors===3){
    const msg=document.getElementById('mapStatus');
    if(msg){ msg.hidden=false; msg.textContent='แผนที่พื้นหลังโหลดไม่ได้ — ถ้าเปิดไฟล์ด้วยการดับเบิลคลิก ให้ปิดแล้วใช้ START_LOCAL_SERVER.bat แทน'; }
  }
});
const reports=[
 {id:1,type:'flood',lat:13.548,lng:100.274,level:.25,car:'ผ่านได้',walk:'ผ่านได้',note:'ตัวอย่างข้อมูลสาธิต',time:Date.now()-18*60000},
 {id:2,type:'flood',lat:13.409,lng:100.001,level:.55,car:'ผ่านลำบาก',walk:'ไม่ควรผ่าน',note:'ตัวอย่างข้อมูลสาธิต',time:Date.now()-42*60000},
 {id:3,type:'help',lat:13.521,lng:100.184,level:.9,car:'ผ่านไม่ได้',walk:'ไม่ควรผ่าน',note:'ต้องการน้ำดื่ม (ข้อมูลสาธิต)',time:Date.now()-12*60000}
];
let picked=null; const floodLayer=L.layerGroup().addTo(map),helpLayer=L.layerGroup().addTo(map),waterLayer=L.layerGroup().addTo(map); let heat=null;
// schematic waterways for MVP only; replace with verified GeoJSON in production
[['แม่น้ำท่าจีน',[[13.73,100.18],[13.62,100.22],[13.54,100.27],[13.48,100.28]]],['แม่น้ำแม่กลอง',[[13.56,99.93],[13.47,99.97],[13.40,100.00],[13.36,100.01]]]].forEach(([n,p])=>L.polyline(p,{weight:4,opacity:.55}).bindTooltip(n).addTo(waterLayer));
function age(t){const m=Math.round((Date.now()-t)/60000);return m<60?`${m} นาทีที่แล้ว`:`${Math.round(m/60)} ชม.ที่แล้ว`}
function render(){floodLayer.clearLayers();helpLayer.clearLayers();const heatPts=[];let f=0,h=0;reports.forEach(r=>{const fresh=Math.max(.2,1-(Date.now()-r.time)/(6*3600000));if(r.type==='flood'){f++;heatPts.push([r.lat,r.lng,Math.min(1,r.level*fresh)]);L.circleMarker([r.lat,r.lng],{radius:7,weight:2,fillOpacity:.9}).bindPopup(`<b>รายงานน้ำท่วม</b><br>ระดับประมาณ ${r.level} ม.<br>รถเล็ก: ${r.car}<br>คนเดิน: ${r.walk}<br>${r.note||''}<br><small>${age(r.time)}</small>`).addTo(floodLayer)}else{h++;L.marker([r.lat,r.lng]).bindPopup(`<b>🆘 ขอความช่วยเหลือ</b><br>${r.note}<br><small>${age(r.time)}</small>`).addTo(helpLayer)}});if(heat)map.removeLayer(heat);heat=L.heatLayer(heatPts,{radius:38,blur:28,maxZoom:15,minOpacity:.25});if(document.querySelector('#heatToggle').checked)heat.addTo(map);document.querySelector('#floodCount').textContent=f;document.querySelector('#helpCount').textContent=h}
render();
map.on('click',e=>{picked=e.latlng;document.querySelector('#picked').textContent=`จุดที่เลือก: ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`});
const dlg=document.querySelector('#reportDialog');function openForm(type){document.querySelector('#reportType').value=type;document.querySelector('#formTitle').textContent=type==='help'?'ขอความช่วยเหลือ':'ส่งรายงานน้ำท่วม';document.querySelector('#helpFields').hidden=type!=='help';picked=null;document.querySelector('#picked').textContent='ยังไม่ได้เลือกตำแหน่ง';dlg.showModal()}
document.querySelector('#reportBtn').onclick=()=>openForm('flood');document.querySelector('#helpBtn').onclick=()=>openForm('help');
document.querySelector('#locateBtn').onclick=()=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>{const ll=L.latLng(p.coords.latitude,p.coords.longitude);if(!BOUNDS.contains(ll)){document.querySelector('#picked').textContent='ตำแหน่งอยู่นอกพื้นที่สองจังหวัด กรุณาจิ้มแผนที่';return}picked=ll;map.setView(ll,15);document.querySelector('#picked').textContent=`ตำแหน่ง: ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`},()=>document.querySelector('#picked').textContent='อ่าน GPS ไม่สำเร็จ กรุณาจิ้มแผนที่'):null;
document.querySelector('#reportForm').addEventListener('submit',e=>{e.preventDefault();if(!picked){alert('กรุณาเลือกตำแหน่งบนแผนที่ก่อน');return}const type=document.querySelector('#reportType').value;reports.push({id:Date.now(),type,lat:picked.lat,lng:picked.lng,level:+document.querySelector('#level').value,car:document.querySelector('#car').value,walk:document.querySelector('#walk').value,note:type==='help'?`${document.querySelector('#need').value} • ${document.querySelector('#people').value} คน • ${document.querySelector('#note').value}`:document.querySelector('#note').value,time:Date.now()});render();dlg.close()});
document.querySelector('#heatToggle').onchange=e=>e.target.checked?heat.addTo(map):map.removeLayer(heat);document.querySelector('#waterToggle').onchange=e=>e.target.checked?waterLayer.addTo(map):map.removeLayer(waterLayer);document.querySelector('#helpToggle').onchange=e=>e.target.checked?helpLayer.addTo(map):map.removeLayer(helpLayer);
