/** 业务术语的确定性文本匹配；只解析语言，不生成查询。 */
export type MatchableBusinessTerm = {
  id: string;
  canonical_term: string;
  aliases: string[];
};

export type BusinessTermMatch = {
  input_term: string;
  status: "resolved" | "ambiguous";
  term_ids: string[];
};

/** 大小写、全半角与连续空白不构成不同术语；`+` 等业务符号必须保留。 */
export function normalizeBusinessTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

const labelsOf = (term: MatchableBusinessTerm): string[] => [term.canonical_term, ...term.aliases];

/**
 * 精确标签优先；否则只允许输入包含完整标签，并取最长标签。禁止反向包含，避免短标签命中扩展标签。
 * 单字标签只做精确匹配，防止在普通句子中泛滥命中。
 */
export function matchBusinessTerms(
  inputs: string[],
  terms: MatchableBusinessTerm[],
): BusinessTermMatch[] {
  const indexed = terms.map((term) => ({
    term,
    labels: [...new Set(labelsOf(term).map(normalizeBusinessTerm).filter(Boolean))],
  }));
  const out: BusinessTermMatch[] = [];

  for (const inputTerm of inputs) {
    const input = normalizeBusinessTerm(inputTerm);
    if (!input) continue;
    const exact = indexed.filter(({ labels }) => labels.includes(input));
    let matched = exact.map(({ term }) => term);

    if (!matched.length) {
      const embedded = indexed.flatMap(({ term, labels }) =>
        labels
          .filter((label) => label.length >= 2 && input.includes(label))
          .map((label) => ({ term, length: label.length })),
      );
      const longest = Math.max(0, ...embedded.map(({ length }) => length));
      matched = embedded.filter(({ length }) => length === longest).map(({ term }) => term);
    }

    const ids = [...new Set(matched.map(({ id }) => id))];
    if (!ids.length) continue;
    out.push({
      input_term: inputTerm,
      status: ids.length === 1 ? "resolved" : "ambiguous",
      term_ids: ids,
    });
  }
  return out;
}
