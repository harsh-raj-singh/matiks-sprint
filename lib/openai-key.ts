import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

let cachedOpenAiKey: string | null | undefined;

function getEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseOpenAiKey(contents: string) {
  const direct = contents.trim();
  if (direct.startsWith("sk-")) {
    return direct;
  }

  const match = contents.match(/^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/m);
  if (!match) {
    return undefined;
  }

  const value = match[1].replace(/^['"]|['"]$/g, "").trim();
  return value.startsWith("sk-") ? value : undefined;
}

export async function getOpenAiApiKey() {
  if (cachedOpenAiKey !== undefined) {
    return cachedOpenAiKey;
  }

  const envKey = getEnv("OPENAI_API_KEY");
  if (envKey) {
    cachedOpenAiKey = envKey;
    return cachedOpenAiKey;
  }

  const home = homedir();
  const candidates = [
    getEnv("OPENAI_API_KEY_FILE"),
    getEnv("MATIKS_OPENAI_KEY_FILE"),
    getEnv("SAARTHI_OPENAI_KEY_FILE"),
    path.join(home, "Desktop/files/orange/openai_api_key.txt"),
    path.join(home, "Desktop/files/orange/.env"),
    path.join(home, "Desktop/files/.env"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const key = parseOpenAiKey(await readFile(candidate, "utf8"));
      if (key) {
        cachedOpenAiKey = key;
        return cachedOpenAiKey;
      }
    } catch {
      // Optional local key files are expected to be absent in production.
    }
  }

  cachedOpenAiKey = null;
  return cachedOpenAiKey;
}
