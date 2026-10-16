// A light Portuguese stemmer for BM25: folds plurals and strips the commonest verb and noun endings,
// so "trabalha", "trabalho" and "trabalhar" meet at "trabalh". It works on tokens already lowercased
// and without accents (see tokenize), and only touches plain words: "node.js", "c#" and "s3" stay as they are.

// Only cut when this much is left, so short words ("usa", "api") survive and stems stay distinctive.
const MIN_STEM = 3;

// Longest first: "acao" must win over "ao", "ando" over "o".
const SUFFIXES = [
  "amente",
  "mente",
  "acao",
  "icao",
  "ando",
  "endo",
  "indo",
  "aram",
  "eram",
  "iram",
  "ava",
  "ao",
  "ou",
  "ei",
  "ar",
  "er",
  "ir",
  "a",
  "e",
  "o",
];

function singular(word: string): string {
  if (word.length <= 3) return word; // "aws", "sqs", "dns" are names, not plurals
  if (/(oes|aes)$/.test(word)) return `${word.slice(0, -3)}ao`; // decisões → decisao
  if (word.endsWith("ais")) return `${word.slice(0, -3)}al`; // digitais → digital
  if (word.endsWith("eis")) return `${word.slice(0, -3)}el`; // papeis → papel
  if (word.endsWith("ns")) return `${word.slice(0, -2)}m`; // linguagens → linguagem
  if (/[^siu]s$/.test(word)) return word.slice(0, -1); // times → time; "redis", "status" and "express" stay
  return word;
}

export function stemPortuguese(token: string): string {
  if (!/^[a-z]+$/.test(token)) return token;
  const word = singular(token);
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) return word.slice(0, -suffix.length);
  }
  return word;
}
