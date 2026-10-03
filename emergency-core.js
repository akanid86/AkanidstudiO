'use strict';
/* น้ำท่วมบ้านเรา — port of GERARAI Emergency Discovery v0.1 core
 * Pure logic, no DOM: labels, freshness, safe wording, conflict detection, draft validation.
 * The server (emergency_rules / emergency_settings) is authoritative; the values below are only the
 * fallback mirror used before the rules load or when the migration has not been run.
 * Wording rule: never say a road/area is "safe" (ปลอดภัย / safe) — only "มีผู้รายงานว่า… เมื่อ HH:MM".
 */
(function (root) {
  const FALLBACK_RULES = [
    ['flood', '🌊', 'น้ำท่วม / ระดับน้ำ', 'Flood / water level', 360, 120, ['exact', 'approximate']],
    ['road_passable', '🚗', 'มีผู้รายงานว่ารถผ่านได้', 'Road reported passable', 360, 120, ['exact', 'approximate']],
    ['road_blocked', '⛔', 'ถนนผ่านไม่ได้ / ปิด', 'Road blocked / closed', 360, 120, ['exact', 'approximate']],
    ['shelter', '🏠', 'ที่พักพิง / ศูนย์พักพิง', 'Shelter', 1440, 480, ['exact', 'approximate']],
    ['food_water', '💧', 'อาหาร / น้ำดื่ม', 'Food / drinking water', 720, 240, ['exact', 'approximate']],
    ['medical', '🏥', 'การแพทย์ / ยา', 'Medical / medicine', 720, 240, ['exact', 'approximate']],
    ['power_charging', '🔋', 'ไฟฟ้า / จุดชาร์จ', 'Power / charging', 720, 240, ['exact', 'approximate']],
    ['toilet', '🚻', 'ห้องน้ำ', 'Toilet', 720, 240, ['exact', 'approximate']],
    ['shower', '🚿', 'จุดอาบน้ำ', 'Shower', 720, 240, ['exact', 'approximate']],
    ['help_request', '🆘', 'ขอความช่วยเหลือ', 'Help request', 360, 120, ['approximate', 'near']],
    ['recovered', '✅', 'พื้นที่กลับมาใช้งานได้ / น้ำลด', 'Recovered / water receded', 720, 240, ['exact', 'approximate']]
  ].map(([type_code, icon, label_th, label_en, ttl_minutes, aging_minutes, allowed_precisions], i) =>
    ({ type_code, icon, label_th, label_en, ttl_minutes, aging_minutes, allowed_precisions, sort_order: (i + 1) * 10 }));

  const FALLBACK_SETTINGS = {
    hotlines: [{ number: '1669', label_th: 'การแพทย์ฉุกเฉิน' }, { number: '1784', label_th: 'สาธารณภัย (ปภ.)' }],
    help_disclaimer_th: 'การโพสต์ขอความช่วยเหลือบนเว็บไซต์นี้ไม่ใช่การแจ้งเหตุไปยังหน่วยงานฉุกเฉินโดยอัตโนมัติ',
    banner_th: 'ข้อมูลสถานการณ์อาจมาจากรายงานของชุมชนและเปลี่ยนแปลงได้รวดเร็ว โปรดตรวจสอบเวลาและแหล่งข้อมูลก่อนตัดสินใจ'
  };

  const DEPTHS = [['wet', 'พื้นเปียก / น้ำเริ่มขัง'], ['ankle', 'ข้อเท้า'], ['shin', 'หน้าแข้ง'], ['knee', 'เข่า'], ['waist', 'เอว'], ['above_waist', 'สูงกว่าเอว'], ['unknown', 'ไม่ทราบ']];
  // Vehicle wording is always attributed to a report, never a system judgement.
  const VEHICLES = [
    ['general_passable', 'รถทั่วไปผ่านได้ตามรายงาน'],
    ['small_not_recommended', 'รถเล็กไม่ควรผ่าน'],
    ['general_impassable', 'รถทั่วไปผ่านไม่ได้'],
    ['high_clearance_only', 'เฉพาะรถสูง / รถช่วยเหลือ'],
    ['unknown', 'ไม่ทราบ']
  ];
  const NEEDS = [['water', 'น้ำดื่ม'], ['food', 'อาหาร'], ['medicine', 'ยา / การรักษา'], ['evacuation', 'อพยพ / เคลื่อนย้าย'], ['elderly_care', 'ผู้สูงอายุ / ผู้ป่วย'], ['pets', 'สัตว์เลี้ยง'], ['other', 'อื่น ๆ']];
  const PRECISION_LABEL = { exact: 'ตำแหน่งแม่นยำ', approximate: 'ตำแหน่งโดยประมาณ (~1 กม.)', near: 'ตำแหน่งค่อนข้างแม่น (~300 ม.)' };
  const SOURCE_LABEL = { community: 'รายงานจากชุมชน', official: 'ข้อมูลจากแหล่งทางการ' };
  const FRESH_LABEL = { fresh: 'สด', aging: 'เริ่มเก่า', expired: 'หมดอายุ', resolved: 'คลี่คลายแล้ว' };
  const label = (list, code) => (list.find(([c]) => c === code) || [code, code])[1];
  const BANNED = /ปลอดภัย|\bsafe\b|safe route/i;

  function ruleMap(rules) {
    const list = Array.isArray(rules) && rules.length ? rules : FALLBACK_RULES;
    return new Map(list.map(r => [r.type_code, r]));
  }

  const clockTime = (iso, tz) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, ...(tz ? { timeZone: tz } : {}) });
  function ageText(ms) {
    const m = Math.max(0, Math.floor(ms / 60000));
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 24) return r ? `${h} ชั่วโมง ${r} นาทีที่แล้ว` : `${h} ชั่วโมงที่แล้ว`;
    return `${Math.floor(h / 24)} วันที่แล้ว`;
  }
  const reportedAgo = ms => (ms < 60000 ? 'รายงานเมื่อสักครู่' : `รายงานเมื่อ ${ageText(ms)}`);
  function durationText(ms) {
    const m = Math.max(0, Math.floor(ms / 60000));
    if (m < 60) return `${Math.max(1, m)} นาที`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} ชั่วโมง ${r} นาที` : `${h} ชั่วโมง`;
  }

  /* Freshness from server times. now = server_now of the query (ms) or Date.now() fallback. */
  function freshness(report, rules, now) {
    const rule = ruleMap(rules).get(report.type_code) || { aging_minutes: 120 };
    const t = typeof now === 'number' ? now : Date.now();
    const reported = new Date(report.reported_at).getTime(), expires = new Date(report.expires_at).getTime();
    const ageMs = t - reported;
    let state;
    if (report.emergency_status === 'resolved') state = 'resolved';
    else if (t >= expires) state = 'expired';
    else if (ageMs >= rule.aging_minutes * 60000) state = 'aging';
    else state = 'fresh';
    return { state, label: FRESH_LABEL[state], ageMs, ageText: ageText(ageMs), reportedAgo: reportedAgo(ageMs), current: state === 'fresh' || state === 'aging' };
  }

  /* One-line, attributed status text. Always contains the report time. */
  function headline(report, tz) {
    const at = clockTime(report.reported_at, tz);
    const parts = [];
    switch (report.type_code) {
      case 'road_passable': return `มีผู้รายงานว่ารถผ่านได้เมื่อ ${at}`;
      case 'road_blocked': return `มีผู้รายงานว่าถนนผ่านไม่ได้ / ปิด · ${at}`;
      case 'recovered': return `มีผู้รายงานว่าพื้นที่กลับมาใช้งานได้ · ${at}`;
      case 'flood':
        if (report.water_depth) parts.push(report.water_depth === 'unknown' ? 'ระดับน้ำ: ไม่ทราบ' : `ระดับน้ำ ${label(DEPTHS, report.water_depth)}`);
        if (report.vehicle_access) parts.push(report.vehicle_access === 'unknown' ? 'การผ่านของรถ: ไม่ทราบ' : label(VEHICLES, report.vehicle_access));
        return `รายงานล่าสุด: ${parts.length ? parts.join(' · ') : 'น้ำท่วม'} · ${at}`;
      case 'help_request':
        return `ขอความช่วยเหลือ: ${report.need_code ? label(NEEDS, report.need_code) : 'ไม่ระบุ'}${report.people_count ? ` · ประมาณ ${report.people_count} คน` : ''} · ${at}`;
      default:
        return `${(ruleMap().get(report.type_code) || {}).label_th || report.type_code} · รายงานเวลา ${at}`;
    }
  }
  function staleWarning(report, rules, now) {
    const f = freshness(report, rules, now);
    if (f.state === 'fresh' || f.state === 'resolved') return '';
    return `ข้อมูลนี้รายงานเมื่อ ${f.ageText} สถานการณ์อาจเปลี่ยนแปลงแล้ว`;
  }
  function timeLines(report, rules, now, tz) {
    const f = freshness(report, rules, now);
    const lines = [`${reportedAgo(f.ageMs)} · เวลา ${clockTime(report.reported_at, tz)}`, `ข้อมูลนี้มีอายุ ${durationText(f.ageMs)}`];
    if (report.created_at && Math.abs(new Date(report.created_at) - new Date(report.reported_at)) > 5 * 60000) lines.push(`โพสต์เข้าเว็บไซต์เวลา ${clockTime(report.created_at, tz)}`);
    return lines;
  }

  /* ---------- conflicting reports: GERARAI never picks a winner ---------- */
  const EARTH = 6371000, rad = d => d * Math.PI / 180;
  function distanceM(a, b) {
    const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.sqrt(h));
  }
  // Signal: +1 = someone says you can get through / it is usable, −1 = someone says you cannot.
  function passSignal(r) {
    if (r.type_code === 'road_passable' || r.type_code === 'recovered') return 1;
    if (r.type_code === 'road_blocked') return -1;
    if (r.type_code === 'flood') {
      if (r.vehicle_access === 'general_passable') return 1;
      if (['general_impassable', 'high_clearance_only', 'small_not_recommended'].includes(r.vehicle_access)) return -1;
      return 0;
    }
    return 0;
  }
  function conflicts(report, others, rules, now, radiusM = 300) {
    const mine = passSignal(report);
    if (!mine || !freshness(report, rules, now).current) return [];
    return (others || []).filter(o => o.id !== report.id && freshness(o, rules, now).current)
      .map(o => ({ report: o, signal: passSignal(o), distanceM: Math.round(distanceM(report, o)) }))
      .filter(x => x.signal && x.signal !== mine && x.distanceM <= radiusM)
      .sort((a, b) => new Date(b.report.reported_at) - new Date(a.report.reported_at));
  }
  const CONFLICT_TEXT = 'มีรายงานล่าสุดที่แตกต่างกันในบริเวณนี้';

  /* ---------- client-side draft check (server re-validates everything) ---------- */
  function validateDraft(d, rules) {
    const rule = ruleMap(rules).get(d?.type_code);
    if (!rule) return 'เลือกว่าเกิดอะไรขึ้น';
    if (!rule.allowed_precisions.includes(d.location_precision)) return d.type_code === 'help_request' ? 'ขอความช่วยเหลือเลือกได้เฉพาะตำแหน่งโดยประมาณหรือค่อนข้างแม่น' : 'เลือกความละเอียดตำแหน่ง';
    const lat = Number(d.latitude), lng = Number(d.longitude);
    if (d.latitude === '' || d.latitude == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return 'ระบุตำแหน่งบนแผนที่หรือใช้ GPS';
    if (d.water_depth && d.type_code !== 'flood') return 'ระดับน้ำใช้กับน้ำท่วมเท่านั้น';
    if (d.vehicle_access && !['flood', 'road_passable', 'road_blocked'].includes(d.type_code)) return 'สถานะรถใช้กับน้ำท่วม/ถนนเท่านั้น';
    if ((d.need_code || d.people_count) && d.type_code !== 'help_request') return 'ข้อมูลนี้ใช้กับขอความช่วยเหลือเท่านั้น';
    if (d.people_count != null && d.people_count !== '' && !(Number.isInteger(Number(d.people_count)) && d.people_count >= 1 && d.people_count <= 999)) return 'จำนวนคน 1–999';
    if (d.note && String(d.note).length > 300) return 'รายละเอียดไม่เกิน 300 ตัวอักษร';
    return null;
  }
  // Story title/body generated from the structured report (the user never has to write a long post).
  function storyText(d, rules) {
    const rule = ruleMap(rules).get(d.type_code) || { icon: '📍', label_th: d.type_code };
    const bits = [];
    if (d.water_depth) bits.push(`ระดับน้ำ ${label(DEPTHS, d.water_depth)}`);
    if (d.vehicle_access) bits.push(label(VEHICLES, d.vehicle_access));
    if (d.need_code) bits.push(`ต้องการ ${label(NEEDS, d.need_code)}`);
    const title = `${rule.icon} ${rule.label_th}${bits.length ? ' · ' + bits[0] : ''}`.slice(0, 100);
    const body = (String(d.note || '').trim() || [rule.label_th, ...bits].join(' · ')).slice(0, 2000);
    return { title, body };
  }

  const api = Object.freeze({
    FALLBACK_RULES, FALLBACK_SETTINGS, DEPTHS, VEHICLES, NEEDS, PRECISION_LABEL, SOURCE_LABEL, FRESH_LABEL, BANNED, CONFLICT_TEXT,
    label, ruleMap, clockTime, ageText, reportedAgo, durationText, freshness, headline, staleWarning, timeLines,
    distanceM, passSignal, conflicts, validateDraft, storyText
  });
  root.GerarAIEmergency = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
