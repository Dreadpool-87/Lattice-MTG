const fold = value => value.normalize("NFKD").replace(/\p{Mark}/gu,"").replace(/[’‘]/g,"'").toLowerCase().trim();
export function search(index, query, oracle, commanderRanks, order = "relevance") {
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
  const rank = ([, row]) => commanderRanks?.get(row[0]) ?? Number.MAX_SAFE_INTEGER;
  const alphabetical = order === "name-asc" || order === "name-desc";
  const direction = order === "name-desc" ? -1 : 1;
  return ranked.sort((a, b) => {
    if ((a[0] === 0) !== (b[0] === 0)) return a[0] === 0 ? -1 : 1;
    const byName = a[1][1].localeCompare(b[1][1]);
    const comparison = alphabetical ? direction * byName : rank(a) - rank(b) || a[0] - b[0] || byName;
    return comparison || a[1][0] - b[1][0];
  }).map(item => item[1]);
}
