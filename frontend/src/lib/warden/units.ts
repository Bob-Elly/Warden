const YOCTO = 10n ** 24n;

/** "2.5" -> yoctoNEAR string. Throws on anything that is not a plain decimal. */
export function nearToYocto(amount: string): string {
  const s = String(amount).trim().replace(/_/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid NEAR amount: "${amount}"`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 24) throw new Error('Too many decimals (max 24)');
  return (BigInt(whole) * YOCTO + BigInt(frac.padEnd(24, '0'))).toString();
}

/** yoctoNEAR -> human string with up to `digits` decimals. */
export function yoctoToNear(yocto: string | bigint | undefined | null, digits = 3): string {
  if (yocto === undefined || yocto === null || yocto === '') return '0';
  const v = BigInt(yocto);
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, '0').slice(0, digits).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isValidAccountId(id: string): boolean {
  return typeof id === 'string' && id.length >= 2 && id.length <= 64 && ACCOUNT_RE.test(id);
}

/** "2.5" with 6 decimals -> "2500000". */
export function toBaseUnits(amount: string, decimals: number): string {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: "${amount}"`);
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) throw new Error(`Too many decimals (max ${decimals})`);
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0")).toString();
}

/** "2500000" with 6 decimals -> "2.5". */
export function fromBaseUnits(base: string | bigint | null | undefined, decimals: number, digits = decimals): string {
  if (base === null || base === undefined || base === "") return "0";
  const v = BigInt(base);
  const d = 10n ** BigInt(decimals);
  const frac = (v % d).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${v / d}.${frac}` : (v / d).toString();
}
