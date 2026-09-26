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

/** 大小写、全半角与连续空白视为相同；`+` 等业务符号保留。 */
export function normalizeBusinessTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

const labelsOf = (term: MatchableBusinessTerm): string[] => [term.canonical_term, ...term.aliases];

/**
 * 优先精确匹配；否则取输入中包含的最长完整标签，输入只是标签一部分时不匹配。
 * 单字标签只做精确匹配。
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
