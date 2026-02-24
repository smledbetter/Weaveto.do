/**
 * Emoji key verification.
 * Derives a short, human-readable safety string from two identity keys so
 * that both parties in a room can confirm they share the same Megolm session
 * without transmitting any key material out-of-band.
 *
 * Both sides sort the keys lexicographically before hashing, guaranteeing an
 * identical result regardless of which key is "local" vs "remote".
 */

/**
 * 256 unique, visually distinct emoji covering a wide range of categories.
 * Each entry is used as a palette slot: byte value → emoji.
 */
export const EMOJI_PALETTE: string[] = [
  // Faces & people (0–19)
  "😀", "😂", "😍", "🤔", "😎", "🥳", "😴", "🤯", "😇", "🥺",
  "😡", "🤗", "🤩", "😬", "🥶", "🤠", "😈", "🤖", "👻", "💀",
  // Animals (20–59)
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
  "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🐔", "🐧", "🐦", "🦆",
  "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋",
  "🐌", "🐞", "🐜", "🦟", "🦗", "🐢", "🐍", "🦎", "🦖", "🐊",
  // Sea & aquatic (60–79)
  "🐳", "🐋", "🦈", "🐬", "🐟", "🐠", "🐡", "🦑", "🐙", "🦀",
  "🦞", "🦐", "🐚", "🦭", "🦦", "🦫", "🐣", "🦩", "🦚", "🦜",
  // Plants & nature (80–109)
  "🌵", "🌲", "🌳", "🌴", "🌱", "🌿", "🍀", "🎍", "🎋", "🍃",
  "🍂", "🍁", "🍄", "🌾", "💐", "🌷", "🌹", "🥀", "🌺", "🌸",
  "🌼", "🌻", "🌞", "🌝", "🌛", "🌚", "🌕", "🌖", "🌗", "🌘",
  // Food & drink (110–149)
  "🍎", "🍊", "🍋", "🍇", "🍓", "🍈", "🍒", "🍑", "🥭", "🍍",
  "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🌽",
  "🥕", "🧅", "🥔", "🍠", "🥜", "🍞", "🥐", "🥖", "🧀", "🍳",
  "🍔", "🍟", "🌮", "🌯", "🥗", "🍜", "🍣", "🍦", "🎂", "🍰",
  // Weather & sky (150–169)
  "☀️", "🌤️", "⛅", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️", "❄️", "🌊",
  "🌬️", "🌀", "🌈", "⚡", "🔥", "💧", "🌙", "⭐", "🌟", "✨",
  // Objects & tools (170–199)
  "📱", "💻", "🖥️", "⌨️", "🖱️", "🖨️", "📷", "📸", "📹", "🎥",
  "📡", "🔭", "🔬", "💡", "🔦", "🕯️", "📚", "📖", "🔑", "🗝️",
  "🔒", "🔓", "🔨", "⚙️", "🔧", "🔩", "⛏️", "🗡️", "🛡️", "🧲",
  // Symbols & signs (200–219)
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💯",
  "♻️", "🔮", "💎", "🏆", "🥇", "🎯", "🎲", "🃏", "🀄", "🎴",
  // Vehicles & transport (220–239)
  "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐",
  "✈️", "🚀", "🛸", "🚁", "⛵", "🚢", "🚂", "🚆", "🚇", "🏍️",
  // Sports & activities (240–249)
  "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🎱", "🏓", "🥊", "🎿",
  // Music & arts (250–255)
  "🎵", "🎶", "🎸", "🥁", "🎹", "🎺",
];

/**
 * Derive a 5-emoji safety string from two Curve25519 identity keys.
 *
 * Algorithm:
 *  1. Sort keys lexicographically so both peers produce the same input.
 *  2. Concatenate with ':' separator.
 *  3. Hash with SHA-256 via Web Crypto.
 *  4. Take the first 10 bytes; XOR each consecutive pair to select one of
 *     256 palette entries, yielding 5 emoji.
 *
 * Both parties call this with their own key and the remote peer's key.
 * The sort step guarantees the output is identical on both sides.
 */
export async function deriveEmojiString(
  keyA: string,
  keyB: string,
): Promise<string> {
  const sorted = [keyA, keyB].sort();
  const input = sorted.join(":");
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);

  const emoji: string[] = [];
  for (let i = 0; i < 5; i++) {
    // XOR two consecutive bytes for better distribution across the palette.
    const index = bytes[i * 2] ^ bytes[i * 2 + 1];
    emoji.push(EMOJI_PALETTE[index % EMOJI_PALETTE.length]);
  }
  return emoji.join(" ");
}
