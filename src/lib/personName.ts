/**
 * How a person's name is written: first letter of each word capital, the rest small.
 *
 * The list had "JOAO SPINELLI" and "KAMILLA ZAPELINI" next to "Juliano Santos" — the
 * same list, typed by different people, some with caps lock on. Sorting, matching and
 * reading all suffer for it, and a name in capitals reads as a shout on the board.
 *
 * The rule is Postgres's `initcap`, deliberately, because the database applies the same
 * rule on every write (`person_name_case`, 20261012180000) and the two must agree: a
 * word starts after anything that is not a letter or a digit, so "o'brien" is
 * "O'Brien" and "ana-maria" is "Ana-Maria". "De" in "Pedro De Assis" is capitalised
 * like any other word, which is how the payroll list already spells it.
 *
 * Spaces are trimmed and runs of them collapsed: "Ana  Silva" and "Ana Silva" are one
 * person, and the unique index on `lower(full_name)` should see them as one.
 */
export function personNameCase(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt")
    .replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, before: string, letter: string) =>
      before + letter.toLocaleUpperCase("pt"));
}
