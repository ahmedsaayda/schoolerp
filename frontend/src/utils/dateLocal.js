/**
 * Date locale au format YYYY-MM-DD (évite le décalage UTC de `toISOString().slice(0,10)`).
 * @param {Date} [d=new Date()]
 */
export function localISODate(d = new Date()) {
  const x = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
