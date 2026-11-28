const mark = /\p{Mark}/u;
const latin = /^\p{Script=Latin}$/u;
const letter = /^\p{Letter}$/u;

function lowerOne(text) {
  return Array.from(text.normalize('NFC'), char => {
    const lowered = char.toLowerCase();
    return [...lowered].length === 1 ? lowered : char;
  }).join('');
}

function groups(text) {
  const result = [];
  for (const char of text) {
    if (mark.test(char) && result.length) result[result.length - 1] += char;
    else result.push(char);
  }
  return result;
}

function compatible(input, standard, policy) {
  const normalize = text => (policy.case_insensitive ? lowerOne(text) : text.normalize('NFC')).normalize('NFD');
  const a = groups(normalize(input));
  const b = groups(normalize(standard));
  return a.length === b.length && a.every((segment, i) => {
    if (segment === b[i]) return true;
    if (!policy.accent_omission_allowed) return false;
    const [base, ...marks] = segment;
    const [standardBase, ...standardMarks] = b[i];
    if (base !== standardBase || !latin.test(base) || !letter.test(base)) return false;
    return marks.every(mark => {
      const idx = standardMarks.indexOf(mark);
      if (idx < 0) return false;
      standardMarks.splice(idx, 1);
      return true;
    });
  });
}

export function spellingMatches(input, canonical, policy) {
  const typography = policy.typographic_equivalents ?? {};
  const forms = [canonical, ...(policy.punctuation_aliases ?? [])];
  let prepared = input.trim();
  for (const variants of Object.values(typography)) {
    const [preferred, ...equivalents] = variants;
    if (!forms.some(form => form.includes(preferred))) continue;
    for (const char of equivalents) prepared = prepared.replaceAll(char, preferred);
  }
  return forms.some(form => compatible(prepared, form, policy));
}

// Align the actual input and the original spelling, keeping combining marks with their base.
// This lets the canonical side show omitted characters, including a missing hyphen.
export function answerDiff(input, canonical) {
  const a = groups(input), b = groups(canonical);
  const cost = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length; i >= 0; i--) {
    for (let j = b.length; j >= 0; j--) {
      if (i === a.length || j === b.length) cost[i][j] = a.length - i + b.length - j;
      else if (a[i] === b[j]) cost[i][j] = cost[i + 1][j + 1];
      else cost[i][j] = 1 + Math.min(cost[i + 1][j], cost[i][j + 1], cost[i + 1][j + 1]);
    }
  }
  const parts = [];
  let i = 0, j = 0;
  const add = (typed, standard, changed) => {
    const previous = parts.at(-1);
    if (previous?.changed === changed) {
      previous.input += typed;
      previous.canonical += standard;
    } else parts.push({ input: typed, canonical: standard, changed });
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) add(a[i++], b[j++], false);
    else if (i < a.length && j < b.length && cost[i][j] === 1 + cost[i + 1][j + 1]) add(a[i++], b[j++], true);
    else if (j < b.length && cost[i][j] === 1 + cost[i][j + 1]) add('', b[j++], true);
    else add(a[i++], '', true);
  }
  return parts;
}

export function grade(word, originalInput) {
  const input = originalInput.trim();
  const accepted = Boolean(input) && spellingMatches(input, word.lemma, word.answerPolicy);
  return {
    wordId: word.id, canonical: word.lemma, originalInput, input, accepted,
    empty: !input, differences: accepted ? answerDiff(input, word.lemma) : [],
  };
}
