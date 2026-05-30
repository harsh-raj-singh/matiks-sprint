const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export function parseSpokenInteger(transcript: string) {
  const directMatch = transcript.replace(/,/g, "").match(/-?\d+/);
  if (directMatch) {
    return Number(directMatch[0]);
  }

  const tokens = transcript
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/-/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  let sign = 1;
  let total = 0;
  let current = 0;
  let found = false;

  for (const token of tokens) {
    if (token === "minus" || token === "negative") {
      sign = -1;
      found = true;
      continue;
    }

    if (token === "and" || token === "answer" || token === "is" || token === "equals") {
      continue;
    }

    if (token in SMALL_NUMBERS) {
      current += SMALL_NUMBERS[token];
      found = true;
      continue;
    }

    if (token in TENS) {
      current += TENS[token];
      found = true;
      continue;
    }

    if (token === "hundred") {
      current = Math.max(1, current) * 100;
      found = true;
      continue;
    }

    if (token === "thousand") {
      total += Math.max(1, current) * 1000;
      current = 0;
      found = true;
    }
  }

  return found ? sign * (total + current) : null;
}
