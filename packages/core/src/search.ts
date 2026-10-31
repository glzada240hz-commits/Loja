/**
 * Busca tolerante para o PDV, app do atendente e cardápio: ignora acentos e maiúsculas,
 * aceita palavras em qualquer ordem, prefixos ("bat ched") e um erro de digitação por palavra
 * a partir de 4 letras ("xtudp", "batat"). Código exato do produto tem prioridade.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Distância de edição com transposição (Damerau-Levenshtein restrita), interrompe acima de `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length]!;
}

function tokenScore(q: string, words: string[]): number {
  let best = 0;
  for (const w of words) {
    if (w === q) return 3;
    if (w.startsWith(q)) best = Math.max(best, 2);
    else if (q.length >= 3 && w.includes(q)) best = Math.max(best, 1.5);
    else if (q.length >= 4) {
      // compara com o começo da palavra do mesmo tamanho (permite digitar só parte) e com a palavra inteira
      const d = Math.min(editDistance(q, w.slice(0, q.length), 1), editDistance(q, w, 1));
      if (d <= 1) best = Math.max(best, 1);
    }
  }
  return best;
}

/** Pontuação (0 = não corresponde). Maior é melhor. */
export function searchScore(query: string, name: string, code?: string | null): number {
  const q = normalizeText(query);
  if (!q) return 1;
  if (code && normalizeText(code) === q) return 100;
  const n = normalizeText(name);
  // "xbacon" encontra "X-Bacon": compara também sem espaços
  const compact = n.replace(/ /g, '');
  if (compact.startsWith(q.replace(/ /g, ''))) return 50 - n.length / 100;
  const words = n.split(' ');
  let total = 0;
  for (const t of q.split(' ')) {
    const s = tokenScore(t, [...words, compact]);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/** Filtra e ordena por relevância, mantendo a ordem original entre empates. */
export function searchFilter<T>(items: T[], query: string, get: (t: T) => { name: string; code?: string | null }): T[] {
  if (!normalizeText(query)) return items;
  return items
    .map((it, i) => ({ it, i, s: searchScore(query, get(it).name, get(it).code) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.it);
}
