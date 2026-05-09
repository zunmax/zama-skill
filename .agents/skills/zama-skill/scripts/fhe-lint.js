#!/usr/bin/env node
/**
 * @file fhe-lint.js
 * @description Regex linter for the highest-priority FHEVM v0.11 anti-patterns. Findings cite the matching anti-patterns.md entry. Exit: 0 clean, 1 DEFINITE, 2 LIKELY-only.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';
import { argv, exit, cwd, stdout, stderr } from 'node:process';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'artifacts', 'cache', 'coverage',
  '.next', '.turbo', '.vite', 'typechain-types', 'types', '.cache',
]);

const SOL_RE = /\.sol$/;
const TS_RE  = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/* Rule shape: { id, severity, title, pattern, fix }. Severity is 'definite' (compile / revert /
   silent-break), 'likely' (strong evidence, one verification step away), or 'warning' (style). */
const SOL_RULES = [
  { id: '#1',   severity: 'definite', title: 'SepoliaConfig used as Solidity base',                pattern: /\bcontract\s+\w+\s+is\s+[^;{]*\bSepoliaConfig\b/,                          fix: 'Use ZamaEthereumConfig from @fhevm/solidity/config/ZamaConfig.sol' },
  { id: '#3',   severity: 'definite', title: 'Removed FHE.requestDecryption call',                  pattern: /\bFHE\.requestDecryption\s*\(/,                                            fix: 'Use FHE.makePubliclyDecryptable + off-chain publicDecrypt + on-chain checkSignatures' },
  { id: '#5',   severity: 'definite', title: 'Non-existent FHE.allowForDecryption helper',          pattern: /\bFHE\.allowForDecryption\s*\(/,                                           fix: 'Use FHE.makePubliclyDecryptable(handle)' },
  { id: '#6',   severity: 'definite', title: 'Renamed comparison: FHE.neq',                         pattern: /\bFHE\.neq\s*\(/,                                                          fix: 'Rename to FHE.ne' },
  { id: '#7',   severity: 'definite', title: 'Renamed comparison: FHE.lte',                         pattern: /\bFHE\.lte\s*\(/,                                                          fix: 'Rename to FHE.le' },
  { id: '#7',   severity: 'definite', title: 'Renamed comparison: FHE.gte',                         pattern: /\bFHE\.gte\s*\(/,                                                          fix: 'Rename to FHE.ge' },
  { id: '#10',  severity: 'definite', title: 'TFHE.* library reference (renamed to FHE)',           pattern: /\bTFHE\s*\./,                                                              fix: 'Rename TFHE.<op> to FHE.<op>' },
  { id: '#10',  severity: 'definite', title: 'Legacy fhevm/lib/TFHE.sol import',                    pattern: /import\s+["'][^"']*fhevm\/lib\/TFHE\.sol["']/,                              fix: 'import { FHE, ... } from "@fhevm/solidity/lib/FHE.sol"' },
  { id: '#11',  severity: 'definite', title: 'Removed GatewayCaller base',                           pattern: /\bcontract\s+\w+\s+is\s+[^;{]*\bGatewayCaller\b/,                          fix: 'Use ZamaEthereumConfig; the v0.8 Oracle/Gateway is gone' },
  { id: '#14',  severity: 'definite', title: 'Renamed: FHE.verifySignatures (now checkSignatures)', pattern: /\bFHE\.verifySignatures\s*\(/,                                             fix: 'Rename to FHE.checkSignatures' },
  { id: '#9',   severity: 'definite', title: 'Signed encrypted type declared (no FHE overloads)',   pattern: /\beint(?:8|16|32|64|128|256)\s+\w+/,                                        fix: 'Use unsigned euint*; signed types compile but every FHE op fails with Member not found' },
  { id: '#13',  severity: 'definite', title: 'Branching on FHE comparison result (require)',        pattern: /\brequire\s*\(\s*FHE\.(?:eq|ne|lt|le|gt|ge)\b/,                             fix: 'Replace with ebool b = FHE.le(...); FHE.select(b, ifTrue, ifFalse)' },
  { id: '#13',  severity: 'definite', title: 'Branching on FHE comparison result (if)',             pattern: /\bif\s*\(\s*FHE\.(?:eq|ne|lt|le|gt|ge)\b/,                                  fix: 'Replace with ebool b = FHE.le(...); FHE.select(b, ifTrue, ifFalse)' },
  { id: '#13',  severity: 'definite', title: 'Unwrapping ebool to gate logic (always-true bug)',    pattern: /\bebool\.unwrap\s*\([^)]*\)\s*!=\s*bytes32\s*\(\s*0\s*\)/,                  fix: 'Handles are always non-zero; use FHE.select on the ebool itself' },
  { id: '#23',  severity: 'definite', title: 'v0.8 relayer URL (zama.cloud)',                        pattern: /relayer\.testnet\.zama\.cloud|zama\.cloud/,                                  fix: 'Use https://relayer.testnet.zama.org' },
];

const TS_RULES = [
  { id: '#16',  severity: 'definite', title: 'Wrong SDK init function (initFhevm)',                  pattern: /\binitFhevm\s*\(/,                                                          fix: 'Call initSDK() (browser only)' },
  { id: '#17',  severity: 'definite', title: 'Wrong public-decrypt result field (results.values)',   pattern: /\bresults\.values\s*\[/,                                                    fix: 'Use results.clearValues[handle]' },
  { id: '#18',  severity: 'definite', title: 'Non-existent SDK package (@fhevm/sdk)',                pattern: /from\s+["']@fhevm\/sdk["']/,                                                fix: 'Import from @zama-fhe/relayer-sdk/web | /bundle | /node' },
  { id: '#22d', severity: 'definite', title: 'Deprecated fhevmjs import',                            pattern: /from\s+["']fhevmjs["']/,                                                    fix: 'Use @zama-fhe/relayer-sdk/<subpath>' },
  { id: '#15',  severity: 'definite', title: 'Bare relayer-sdk import (missing /web | /bundle | /node)', pattern: /from\s+["']@zama-fhe\/relayer-sdk["']/,                                  fix: 'Append /web (browser), /bundle (UMD), or /node (Node.js)' },
  { id: '#20',  severity: 'definite', title: 'FhevmType passed to userDecryptEbool',                 pattern: /\buserDecryptEbool\s*\(\s*FhevmType\b/,                                     fix: 'Drop FhevmType: userDecryptEbool(handle, addr, signer)' },
  { id: '#21',  severity: 'definite', title: 'FhevmType passed to userDecryptEaddress',              pattern: /\buserDecryptEaddress\s*\(\s*FhevmType\b/,                                  fix: 'Drop FhevmType: userDecryptEaddress(handle, addr, signer)' },
  { id: '#22b', severity: 'likely',   title: 'contractAddress passed to publicDecryptE* (no such param)', pattern: /\bpublicDecryptE(?:bool|address|uint)\s*\([^)]*,[^)]*0x[0-9a-fA-F]{40}/,  fix: 'publicDecrypt* takes only handle (and optional options); no contractAddress' },
  { id: '#23',  severity: 'definite', title: 'v0.8 relayer URL (zama.cloud)',                        pattern: /zama\.cloud/,                                                              fix: 'Use https://relayer.testnet.zama.org' },
  { id: '#25a', severity: 'definite', title: 'Mainnet API key exposed via NEXT_PUBLIC_*',            pattern: /NEXT_PUBLIC_[A-Z_]*ZAMA[A-Z_]*API[A-Z_]*KEY|NEXT_PUBLIC_[A-Z_]*FHEVM[A-Z_]*KEY|NEXT_PUBLIC_[A-Z_]*RELAYER[A-Z_]*KEY/, fix: 'Route through a backend proxy; never expose the key to the browser' },
  { id: '#25a', severity: 'definite', title: 'Mainnet API key exposed via VITE_*',                    pattern: /VITE_[A-Z_]*ZAMA[A-Z_]*API[A-Z_]*KEY|VITE_[A-Z_]*FHEVM[A-Z_]*KEY|VITE_[A-Z_]*RELAYER[A-Z_]*KEY/,           fix: 'Route through a backend proxy; never expose the key to the browser' },
  /* New SDK (#33-#45) - @zama-fhe/sdk@^3 / @zama-fhe/react-sdk@^3 */
  { id: '#33',  severity: 'definite', title: 'RelayerNode imported from main entry (must be /node)',  pattern: /import\s*\{[^}]*\bRelayerNode\b[^}]*\}\s*from\s*["']@zama-fhe\/sdk["']/,   fix: 'Use import { RelayerNode } from "@zama-fhe/sdk/node"' },
  { id: '#33',  severity: 'definite', title: 'ViemSigner imported from main entry (must be /viem)',   pattern: /import\s*\{[^}]*\bViemSigner\b[^}]*\}\s*from\s*["']@zama-fhe\/sdk["']/,    fix: 'Use import { ViemSigner } from "@zama-fhe/sdk/viem"' },
  { id: '#33',  severity: 'definite', title: 'EthersSigner imported from main entry (must be /ethers)', pattern: /import\s*\{[^}]*\bEthersSigner\b[^}]*\}\s*from\s*["']@zama-fhe\/sdk["']/, fix: 'Use import { EthersSigner } from "@zama-fhe/sdk/ethers"' },
  { id: '#33',  severity: 'definite', title: 'WagmiSigner imported from core SDK (must be /react-sdk/wagmi)', pattern: /import\s*\{[^}]*\bWagmiSigner\b[^}]*\}\s*from\s*["']@zama-fhe\/sdk(?:\/wagmi)?["']/, fix: 'Use import { WagmiSigner } from "@zama-fhe/react-sdk/wagmi"' },
  { id: '#33',  severity: 'definite', title: 'RelayerCleartext imported without /cleartext sub-path', pattern: /import\s*\{[^}]*\bRelayerCleartext\b[^}]*\}\s*from\s*["']@zama-fhe\/sdk["']/, fix: 'Use import { RelayerCleartext } from "@zama-fhe/sdk/cleartext"' },
  { id: '#34',  severity: 'definite', title: 'RELAYER_API_KEY referenced via NEXT_PUBLIC_/VITE_',     pattern: /process\.env\.NEXT_PUBLIC_RELAYER_API_KEY|import\.meta\.env\.VITE_RELAYER_API_KEY/, fix: 'Move the key to a server-only env var; route browser requests through a backend proxy' },
  { id: '#36',  severity: 'definite', title: 'keypairTTL: 0 (rejected at construction)',              pattern: /\bkeypairTTL\s*:\s*0\b/,                                                   fix: 'keypairTTL must be > 0; default is 2592000 (30 days), max 31536000 (365 days)' },
  { id: '#39',  severity: 'definite', title: 'RelayerCleartext on Mainnet (chainId: 1)',              pattern: /new\s+RelayerCleartext\s*\(\s*\{[^}]*\bchainId\s*:\s*1\b/,                  fix: 'RelayerCleartext is dev-only; use RelayerWeb / RelayerNode on Mainnet' },
  { id: '#39',  severity: 'definite', title: 'RelayerCleartext on Sepolia (chainId: 11155111)',       pattern: /new\s+RelayerCleartext\s*\(\s*\{[^}]*\bchainId\s*:\s*11155111\b/,          fix: 'RelayerCleartext is dev-only; use RelayerWeb / RelayerNode on Sepolia' },
];

/* Multiline TS rules - tested against the full file source, not a single line.
   Use this list for patterns whose evidence spans multiple lines. */
const TS_MULTILINE_RULES = [
  { id: '#35', severity: 'likely', title: 'GenericStorage using DOM names (getItem/setItem/removeItem)', pattern: /:\s*GenericStorage\b[\s\S]{0,400}?\b(?:getItem|setItem|removeItem)\s*[:(]/, fix: 'GenericStorage uses get / set / delete (async key-value), NOT the DOM Storage shape' },
  { id: '#41', severity: 'likely', title: 'Auto-retry inside SigningRejectedError catch (popup loop)', pattern: /catch[\s\S]{0,400}?SigningRejectedError[\s\S]{0,400}?(?:balanceOf|userDecrypt|confidentialTransfer|shield|unshield)\s*\(/, fix: 'Never auto-retry on SigningRejectedError; require a fresh user gesture' },
];

/* ACL coverage. Flag storage writes of FHE results lacking a nearby FHE.allowThis on the same
   handle. Locals (`euint64 x = ...`) are skipped - they hold transient ACL for the tx. */
const TYPE_DECL_PREFIX_RE = /^\s*(?:euint(?:8|16|32|64|128|256)|ebool|eaddress|externalEuint(?:8|16|32|64|128|256)|externalEbool|externalEaddress|uint(?:8|16|32|64|128|256)?|int\d*|bool|address|bytes\d*|string|memory|calldata|storage)\b/;
const STORAGE_WRITE_RE  = /^\s*(_\w+|\w+\[[^\]]*\])\s*=\s*FHE\.(?:add|sub|mul|select|fromExternal|asEuint\d+|min|max|neg|and|or|xor|not|shl|shr|rotl|rotr|div|rem)\s*\(/;
function checkAclCoverage(lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    if (TYPE_DECL_PREFIX_RE.test(lines[i])) continue;
    const m = lines[i].match(STORAGE_WRITE_RE);
    if (!m) continue;
    const handleExpr = m[1];
    const handleRoot = handleExpr.replace(/\[.*$/, '');
    const end = Math.min(lines.length, i + 11);
    const window = lines.slice(i, end).join('\n');
    const allowThisRe = new RegExp(`\\bFHE\\.allowThis\\s*\\(\\s*${handleRoot}\\b`);
    if (!allowThisRe.test(window)) {
      findings.push({
        id: 'ACL', severity: 'likely',
        title: `Storage write of FHE handle "${handleExpr}" without nearby FHE.allowThis`,
        line: i + 1, snippet: lines[i].trim(),
        fix: `Add FHE.allowThis(${handleRoot}) within ~10 lines, plus FHE.allow(${handleRoot}, <user>) for any user the value should be decryptable by`,
      });
    }
  }
  return findings;
}

/* #22e: track variables assigned from userDecryptEuint/publicDecryptEuint, then flag any
   expect(<that-var>).to.(eq|equal)(<plain number>). Skips expects on unrelated variables
   like arr.length. */
const EUINT_DECRYPT_ASSIGN_RE = /\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:await\s+)?[\w.]*\b(?:userDecryptEuint|publicDecryptEuint)\b/;
function checkBigintAssertions(lines) {
  const findings = [];
  const tracked = new Set();
  for (const line of lines) {
    const m = line.match(EUINT_DECRYPT_ASSIGN_RE);
    if (m) tracked.add(m[1]);
  }
  if (tracked.size === 0) return findings;
  const varAlt = [...tracked].map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const expectRe = new RegExp(`\\bexpect\\s*\\(\\s*(?:${varAlt})\\s*\\)\\s*\\.to\\s*\\.(?:eq|equal|deep\\.eq|deep\\.equal)\\s*\\(\\s*-?[0-9_]+\\s*[,)]`);
  for (let i = 0; i < lines.length; i++) {
    if (expectRe.test(lines[i])) {
      findings.push({
        id: '#22e', severity: 'likely',
        title: 'Decrypted euint compared to a JS number (bigint mismatch)',
        line: i + 1, snippet: lines[i].trim(),
        fix: 'userDecryptEuint / publicDecryptEuint return bigint; compare with 1000n or BigInt(1000)',
      });
    }
  }
  return findings;
}

/* view/pure detector for #14b: flag a function declared `view` or `pure` whose body contains
   an FHE state-modifying call. */
function checkViewPure(lines) {
  const findings = [];
  const fnRe = /\bfunction\s+(\w+)\s*\([^)]*\)\s+(?:[a-zA-Z]+\s+)*?(view|pure)\b/;
  const stateOpRe = /\bFHE\.(?:add|sub|mul|div|rem|min|max|neg|and|or|xor|not|shl|shr|rotl|rotr|select|asEuint\d+|asEbool|asEaddress|fromExternal|allow|allowThis|allowTransient|makePubliclyDecryptable|checkSignatures|randEuint\d+|randEbool)\b/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnRe);
    if (!m) continue;
    const fnName = m[1];
    let depth = 0;
    let inBody = false;
    for (let j = i; j < lines.length && j < i + 60; j++) {
      const opens = (lines[j].match(/{/g) || []).length;
      const closes = (lines[j].match(/}/g) || []).length;
      depth += opens - closes;
      if (opens > 0) inBody = true;
      if (inBody && j > i && stateOpRe.test(lines[j])) {
        findings.push({
          id: '#14b', severity: 'definite',
          title: `view/pure function "${fnName}" calls a state-modifying FHE op`,
          line: j + 1, snippet: lines[j].trim(),
          fix: 'Drop the view/pure modifier; FHE math and ACL grants write coprocessor state',
        });
        break;
      }
      if (inBody && depth <= 0) break;
    }
  }
  return findings;
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && (SOL_RE.test(e.name) || TS_RE.test(e.name))) out.push(full);
    }
  }
  return out;
}

function lintFile(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const lines = src.split('\n');
  const ext = extname(absPath);
  const findings = [];
  const rules = ext === '.sol' ? SOL_RULES : TS_RULES;
  for (const r of rules) {
    for (let i = 0; i < lines.length; i++) {
      if (r.pattern.test(lines[i])) {
        findings.push({ id: r.id, severity: r.severity, title: r.title, line: i + 1, snippet: lines[i].trim(), fix: r.fix });
      }
    }
  }
  if (ext === '.sol') {
    findings.push(...checkAclCoverage(lines));
    findings.push(...checkViewPure(lines));
  } else {
    findings.push(...checkBigintAssertions(lines));
    for (const r of TS_MULTILINE_RULES) {
      const re = new RegExp(r.pattern.source, r.pattern.flags.includes('g') ? r.pattern.flags : r.pattern.flags + 'g');
      let m;
      while ((m = re.exec(src)) !== null) {
        const before = src.slice(0, m.index);
        const line = before.split('\n').length;
        const snippet = lines[line - 1] ? lines[line - 1].trim() : m[0].split('\n')[0].trim();
        findings.push({ id: r.id, severity: r.severity, title: r.title, line, snippet, fix: r.fix });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  return findings;
}

function formatFinding(file, f) {
  const tag = f.severity === 'definite' ? 'DEFINITE BUG'
            : f.severity === 'likely'   ? 'LIKELY ISSUE'
            : 'WARNING';
  return [
    `  [${tag}] ${file}:${f.line}  ${f.id}  ${f.title}`,
    `    code: ${f.snippet}`,
    `    fix:  ${f.fix}`,
  ].join('\n');
}

function main() {
  const target = resolve(argv[2] || cwd());
  if (!existsSync(target)) {
    stderr.write(`fhe-lint: path not found: ${target}\n`);
    exit(2);
  }
  const stat = statSync(target);
  const files = stat.isFile() ? [target] : walk(target);
  const sourceFiles = files.filter(f => SOL_RE.test(f) || TS_RE.test(f));
  if (sourceFiles.length === 0) {
    stdout.write(`fhe-lint: no .sol or .ts files under ${target}\n`);
    exit(0);
  }
  let definite = 0, likely = 0, warnings = 0, scanned = 0;
  const lines = [];
  for (const f of sourceFiles) {
    const src = readFileSync(f, 'utf8');
    if (!/(?:\b(?:FHE|TFHE|fhevm|ebool|eaddress|externalE(?:uint\d*|bool|address))\b|\beuint\d*\b|@zama-fhe\/|@fhevm\/)/.test(src)) continue;
    scanned++;
    const findings = lintFile(f);
    if (findings.length === 0) continue;
    lines.push(`\n${relative(cwd(), f)}`);
    for (const fnd of findings) {
      lines.push(formatFinding(relative(cwd(), f), fnd));
      if (fnd.severity === 'definite') definite++;
      else if (fnd.severity === 'likely') likely++;
      else warnings++;
    }
  }
  stdout.write(`fhe-lint: scanned ${scanned} FHEVM-touching file(s) under ${relative(cwd(), target) || '.'}\n`);
  if (lines.length === 0) {
    stdout.write(`fhe-lint: clean. 0 issues.\n`);
    exit(0);
  }
  stdout.write(lines.join('\n') + '\n\n');
  stdout.write(`fhe-lint: ${definite} definite, ${likely} likely, ${warnings} warning(s).\n`);
  stdout.write(`Anti-pattern catalog: references/anti-patterns.md\n`);
  exit(definite > 0 ? 1 : likely > 0 || warnings > 0 ? 2 : 0);
}

main();
