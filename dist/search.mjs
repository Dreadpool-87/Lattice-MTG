const fold = value => value.normalize("NFKD").replace(/\p{Mark}/gu,"").replace(/[’‘]/g,"'").toLowerCase().trim();
export function search(index, query, oracle) {
  const needle = fold(query);
  if (!needle) return [];
  const words = needle.split(/\s+/);
  const ranked = [];
  for (const row of index) {
    const name = fold(row[1]);
    const text = oracle ? fold(oracle.get(row[0]) ?? "") : row[4] ? name + " " + row[4] : name;
    const exact = needle === name || needle === row[2];
    if (exact || words.every(word => text.includes(word))) {
      ranked.push([exact ? 0 : text.startsWith(needle) ? 1 : text.includes(needle) ? 2 : 3, row]);
    }
  }
  return ranked.sort((a,b)=>a[0]-b[0] || a[1][1].localeCompare(b[1][1]) || a[1][0]-b[1][0]).map(item=>item[1]);
}
