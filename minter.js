"use strict";
/* minter.js -- pure-JS pandemic_hash_m2 collision minter (no GPU, runs in Node or a browser).
 * Mint a string that hashes to a target: either the SHORTEST first collision, or one under a fixed prefix/suffix.
 *
 * The hash: FNV-1a 32-bit, every byte OR'd 0x20 (case-insensitive), finalize (h ^ 0x2A) * PRIME.
 * The speed trick (same as the CUDA kernels): the final multiply is invertible mod 2^32, so the LAST character is
 * not searched but SOLVED -- given the running state before it, exactly one char can complete the string to the
 * target. We enumerate the first L-1 wild chars with a rolling FNV state (odometer) and solve the L-th. With a
 * fixed suffix, we fold the suffix+finalize backwards into NEED so the same one-XOR solve still applies.
 *
 * CLI:  node minter.js 0x457C869D                       shortest collision
 *       node minter.js 0x125C0227 --prefix hp_fx_        collision under a prefix
 *       node minter.js 0xE54047D5 --prefix bone_ --suffix _l --count 5 --maxlen 8
 *       node minter.js --selftest
 */
const P = 0x01000193, OFFSET = 0x811C9DC5, PINV = 0x359C449B; // PINV = P^-1 mod 2^32
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789_.";     // the 38-char name alphabet ('.' is real)

function m2(str) {
  let h = OFFSET;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ ((str.charCodeAt(i) | 0x20) & 0xFF), P);
  return (Math.imul(h ^ 0x2A, P)) >>> 0;
}
function foldStr(h, str) {
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ ((str.charCodeAt(i) | 0x20) & 0xFF), P);
  return h >>> 0;
}
// NEED folds (suffix + finalize) backwards from the target so that: lastByte = state_before_last ^ NEED
function computeNEED(target, suffix) {
  let Z = ((Math.imul(target, PINV) >>> 0) ^ 0x2A) >>> 0;                 // undo finalize
  for (let i = suffix.length - 1; i >= 0; i--)
    Z = ((Math.imul(Z, PINV) >>> 0) ^ ((suffix.charCodeAt(i) | 0x20) & 0xFF)) >>> 0; // undo each suffix byte
  return Math.imul(Z, PINV) >>> 0;
}

/* mint(target, {prefix, suffix, alphabet, maxLen, count, onProgress})
 *   target : number or "0x..."/"hex"      count : how many collisions to return (default 1 = shortest first)
 *   returns { found: [strings], ops }     onProgress(ops, wildLen) called periodically for UIs                    */
function mint(target, opts = {}) {
  const prefix = (opts.prefix || "").toLowerCase();
  const suffix = (opts.suffix || "").toLowerCase();
  const alphabet = opts.alphabet || ALPHABET;
  const maxLen = opts.maxLen != null ? opts.maxLen : 7;
  const count = opts.count != null ? opts.count : 1;
  const onProgress = opts.onProgress || null;
  const t = (typeof target === "string") ? (parseInt(target.replace(/^0x/i, ""), 16) >>> 0) : (target >>> 0);

  const chars = [...alphabet];
  const eff = chars.map(c => (c.charCodeAt(0) | 0x20) & 0xFF);
  const base = eff.length;
  const effSet = new Set(eff);
  const eff2char = {};
  chars.forEach((c, i) => { if (!(eff[i] in eff2char)) eff2char[eff[i]] = c; }); // first char wins a shared eff byte
  const SP = foldStr(OFFSET, prefix);
  const NEED = computeNEED(t, suffix);

  const out = [];
  let ops = 0;
  const PROG = (1 << 22) - 1;
  const push = (wild) => { out.push(prefix + wild + suffix); return out.length >= count; };

  const startLen = (prefix.length || suffix.length) ? 0 : 1;              // wildLen 0 = affixes alone
  for (let L = startLen; L <= maxLen; L++) {
    if (L === 0) { if (m2(prefix + suffix) === t && push("")) return { found: out, ops }; continue; }
    const H = L - 1;                                                       // enumerate H chars, solve the last
    const d = new Int32Array(H);
    const st = new Uint32Array(H + 1);
    st[0] = SP;
    for (let p = 0; p < H; p++) st[p + 1] = Math.imul(st[p] ^ eff[d[p]], P) >>> 0;
    for (;;) {
      const B = (st[H] ^ NEED) >>> 0;                                     // solve the last char
      if (effSet.has(B)) {
        let wild = ""; for (let p = 0; p < H; p++) wild += chars[d[p]]; wild += eff2char[B];
        if (push(wild)) return { found: out, ops };
      }
      if ((++ops & PROG) === 0 && onProgress) onProgress(ops, L);
      let p = H - 1;                                                       // odometer increment (rolling state)
      while (p >= 0) { if (++d[p] < base) { st[p + 1] = Math.imul(st[p] ^ eff[d[p]], P) >>> 0; break; } d[p] = 0; p--; }
      if (p < 0) break;                                                    // length L exhausted
      for (let q = p + 1; q < H; q++) st[q + 1] = Math.imul(st[q] ^ eff[d[q]], P) >>> 0;
    }
  }
  return { found: out, ops };
}

function selftest() {
  const ref = { "a": 0x05249472, "bone": 0x4A1336BF, "bone_chest": 0x4C7733ED, "hp_fx_light": 0x125C0227,
                "globalsrt": 0xCBC1EB51, "test.piece1e": 0xDD66AC07, "al_veh_boat_destroyer": 0xE54047D5,
                "_": 0x855B77EC, ".": 0x9FD4A0C1 };
  let ok = true;
  for (const s in ref) if (m2(s) !== (ref[s] >>> 0)) { ok = false; console.log(`  FAIL m2(${s})=0x${m2(s).toString(16)} != 0x${ref[s].toString(16)}`); }
  console.log("m2 vs Python fnv.m2 reference:", ok ? "OK (byte-exact)" : "FAIL");
  for (const target of [0x457C869D, 0xE54047D5, 0x125C0227, 0x9FD4A0C1]) {
    const s = mint(target, { maxLen: 7 }).found[0];
    console.log(`  shortest mint(0x${(target >>> 0).toString(16).toUpperCase()}) -> ${JSON.stringify(s)} : ` +
                (s && m2(s) === (target >>> 0) ? `OK (len ${s.length})` : "FAIL"));
  }
  const r = mint(0x125C0227, { prefix: "hp_fx_", suffix: "_a", maxLen: 8 }).found[0];
  console.log(`  prefix/suffix mint -> ${JSON.stringify(r)} : ` + (r && m2(r) === 0x125C0227 ? "OK" : "FAIL"));
}

if (typeof module !== "undefined" && module.exports) module.exports = { m2, mint, ALPHABET };
if (typeof require !== "undefined" && require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest") || args.length === 0) { selftest(); }
  else {
    const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
    const t0 = Date.now();
    const { found, ops } = mint(args[0], {
      prefix: opt("--prefix", ""), suffix: opt("--suffix", ""), alphabet: opt("--alphabet", ALPHABET),
      maxLen: +opt("--maxlen", 7), count: +opt("--count", 1),
      onProgress: (o, L) => process.stderr.write(`\r  searching L=${L}  ${(o / 1e6).toFixed(0)}M ops`)
    });
    process.stderr.write("\r".padEnd(40) + "\r");
    for (const s of found) console.log(`${s}\t(m2=0x${m2(s).toString(16).toUpperCase().padStart(8, "0")}, len=${s.length})`);
    console.error(`${found.length} collision(s) in ${(ops / 1e6).toFixed(1)}M ops, ${Date.now() - t0}ms`);
  }
}
