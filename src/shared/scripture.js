// Bible references: "John 3:16-18", "1 Cor 13:4–7", "Ps 23", "jn 3 16". Pure functions.

export const BOOKS = [
  ["Genesis", "gen ge gn"], ["Exodus", "exod exo ex"], ["Leviticus", "lev le lv"], ["Numbers", "num nu nm nb"], ["Deuteronomy", "deut de dt"],
  ["Joshua", "josh jos jsh"], ["Judges", "judg jdg jg jdgs"], ["Ruth", "ruth rth ru"], ["1 Samuel", "1sam 1sa 1sm"], ["2 Samuel", "2sam 2sa 2sm"],
  ["1 Kings", "1kgs 1ki 1kin"], ["2 Kings", "2kgs 2ki 2kin"], ["1 Chronicles", "1chr 1ch 1chron"], ["2 Chronicles", "2chr 2ch 2chron"], ["Ezra", "ezra ezr"],
  ["Nehemiah", "neh ne"], ["Esther", "esth est es"], ["Job", "job jb"], ["Psalms", "ps psa psalm pss psm"], ["Proverbs", "prov pro prv pr"],
  ["Ecclesiastes", "eccl ecc ec qoh"], ["Song of Solomon", "song sos so canticles songofsongs"], ["Isaiah", "isa is"], ["Jeremiah", "jer je jr"], ["Lamentations", "lam la"],
  ["Ezekiel", "ezek eze ezk"], ["Daniel", "dan da dn"], ["Hosea", "hos ho"], ["Joel", "joel jl"], ["Amos", "amos am"], ["Obadiah", "obad ob"], ["Jonah", "jonah jnh jon"],
  ["Micah", "mic mc"], ["Nahum", "nah na"], ["Habakkuk", "hab hb"], ["Zephaniah", "zeph zep zp"], ["Haggai", "hag hg"], ["Zechariah", "zech zec zc"], ["Malachi", "mal ml"],
  ["Matthew", "matt mat mt"], ["Mark", "mark mrk mk mr"], ["Luke", "luke luk lk"], ["John", "john joh jhn jn"], ["Acts", "acts act ac"], ["Romans", "rom ro rm"],
  ["1 Corinthians", "1cor 1co"], ["2 Corinthians", "2cor 2co"], ["Galatians", "gal ga"], ["Ephesians", "eph ephes"], ["Philippians", "phil php pp"], ["Colossians", "col co"],
  ["1 Thessalonians", "1thess 1th 1thes"], ["2 Thessalonians", "2thess 2th 2thes"], ["1 Timothy", "1tim 1ti 1tm"], ["2 Timothy", "2tim 2ti 2tm"], ["Titus", "titus tit ti"],
  ["Philemon", "phlm phm philem"], ["Hebrews", "heb"], ["James", "jas jm"], ["1 Peter", "1pet 1pe 1pt 1p"], ["2 Peter", "2pet 2pe 2pt 2p"], ["1 John", "1john 1jn 1jo 1jhn"],
  ["2 John", "2john 2jn 2jo 2jhn"], ["3 John", "3john 3jn 3jo 3jhn"], ["Jude", "jude jud jd"], ["Revelation", "rev re revelations"],
];

/** Chapters in each book (Protestant canon, same order as BOOKS). */
export const CHAPTERS = [50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3,
  3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22];
/** Short names for buttons: "Gen", "1 Sam", "Ps"… */
export const SHORT = BOOKS.map(([, abbr]) => abbr.split(" ")[0].replace(/^(\d)/, "$1 ").replace(/(^|\s)([a-z])/, (_m, a, b) => a + b.toUpperCase()));

const key = (s) => s.toLowerCase().replace(/^(i{1,3})\s+(?=[a-z])/, (_m, r) => String(r.length)).replace(/^(first|second|third)\s+/, (_m, w) => ({ first: "1", second: "2", third: "3" }[w])).replace(/[^a-z0-9]/g, "");
const LOOKUP = new Map();
BOOKS.forEach(([name, abbr], i) => { LOOKUP.set(key(name), i); for (const a of abbr.split(" ")) LOOKUP.set(a, i); });

/** Find a book by full name, abbreviation or unique prefix. */
export function findBook(text) {
  const k = key(text);
  if (!k) return null;
  if (LOOKUP.has(k)) return LOOKUP.get(k);
  const hits = BOOKS.map(([n], i) => [key(n), i]).filter(([n]) => n.startsWith(k));
  return hits.length === 1 || (hits.length && k.length >= 3) ? hits[0][1] : null;
}

/** "John 3:16-18" → { book: 42, name: "John", chapter: 3, from: 16, to: 18 }. Verse range optional (whole chapter). */
export function parseReference(input) {
  const s = String(input || "").trim().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const m = /^((?:[1-3]|i{1,3}|first|second|third)?\s*[a-z][a-z .]*?)\s*(\d{1,3})(?:\s*[:. ]\s*(\d{1,3}))?(?:\s*-\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?)?\s*$/i.exec(s);
  if (!m) return null;
  const book = findBook(m[1]);
  if (book == null) return null;
  const chapter = Number(m[2]);
  if (chapter < 1 || chapter > CHAPTERS[book]) return null;   // never ask for a chapter that doesn't exist
  let from = m[3] ? Number(m[3]) : null, to = from;
  if (m[4] && m[5]) return { book, name: BOOKS[book][0], chapter, from, to: Number(m[5]), toChapter: Number(m[4]) };   // John 3:16-4:2
  if (m[4]) { if (from == null) return { book, name: BOOKS[book][0], chapter, from: null, to: null, toChapter: Number(m[4]) }; to = Number(m[4]); }
  if (from != null && to < from) [from, to] = [to, from];
  return { book, name: BOOKS[book][0], chapter, from, to };
}

export const formatReference = (r) => !r ? "" : `${r.name} ${r.chapter}${r.from != null ? `:${r.from}${r.to != null && r.to !== r.from ? `-${r.toChapter ? `${r.toChapter}:` : ""}${r.to}` : ""}` : ""}`;

/** Verses → slides. Long verses are split at sentence breaks so text stays readable on screen. */
export function scriptureSlides(ref, verses, { maxChars = 260, translation = "KJV" } = {}) {
  const slides = [];
  for (const v of verses) {
    const parts = splitLong(v.text.trim(), maxChars);
    parts.forEach((t, i) => slides.push({ kind: "scripture", label: `${ref.name} ${v.chapter ?? ref.chapter}:${v.verse}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}`, text: t, reference: `${ref.name} ${v.chapter ?? ref.chapter}:${v.verse} ${translation}` }));
  }
  return slides;
}
function splitLong(text, max) {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.;:!?]+[.;:!?]+["'”’)]*\s*|[^.;:!?]+$/g) || [text];
  const out = []; let cur = "";
  for (const s of sentences) { if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ""; } cur += s; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
