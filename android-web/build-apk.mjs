// Builds the Pulse Med phone shell (a WebView that shows the PC server's phone mode) into a signed APK.
// Uses only the local Android SDK and JDK, no Gradle. Usage: node android-web/build-apk.mjs [outputPath]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SDK = 'C:/ad/sdk';
const BT = `${SDK}/build-tools/35.0.0`;
const JAR = `${SDK}/platforms/android-35/android.jar`;
const JDK = 'C:/ad/jdk21/bin';
const KEYSTORE = path.join(os.homedir(), '.android', 'debug.keystore');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const root = path.resolve(here, '..');
const out = path.resolve(process.argv[2] || 'C:/Users/Abhijeet Sharma/Downloads/PulseMed-Phone-1.0.0.apk');
if (fs.existsSync(out)) throw new Error('Refusing to overwrite ' + out);
for (const p of [BT, JAR, KEYSTORE, `${root}/public/icons/icon-192.png`]) if (!fs.existsSync(p)) throw new Error('Missing ' + p);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsemed-web-'));
// .bat tools need a shell, and paths such as "Abhijeet Sharma" contain spaces, so every part is quoted for that case.
const run = (cmd, args) => (/\.(bat|cmd)$/i.test(cmd)
  ? execFileSync([cmd, ...args].map((a) => `"${a}"`).join(' '), { stdio: 'inherit', shell: true })
  : execFileSync(cmd, args, { stdio: 'inherit' }));
const res = path.join(work, 'res');
fs.cpSync(path.join(here, 'res'), res, { recursive: true });
fs.mkdirSync(path.join(res, 'mipmap-xxxhdpi'), { recursive: true });
fs.copyFileSync(`${root}/public/icons/icon-192.png`, path.join(res, 'mipmap-xxxhdpi', 'ic_launcher.png'));

run(`${BT}/aapt2.exe`, ['compile', '--dir', res, '-o', `${work}/res.zip`]);
fs.mkdirSync(`${work}/gen`);
run(`${BT}/aapt2.exe`, ['link', '-o', `${work}/base.apk`, '-I', JAR, '--manifest', `${here}/AndroidManifest.xml`, '--java', `${work}/gen`, `${work}/res.zip`]);
fs.mkdirSync(`${work}/classes`);
const javaFiles = [`${here}/src/com/abhijeet/pulsemed/web/MainActivity.java`, ...fs.readdirSync(`${work}/gen`, { recursive: true }).filter((f) => f.endsWith('.java')).map((f) => path.join(work, 'gen', f))];
run(`${JDK}/javac.exe`, ['-source', '8', '-target', '8', '-encoding', 'UTF-8', '-classpath', JAR, '-d', `${work}/classes`, ...javaFiles]);
run(`${JDK}/jar.exe`, ['cf', `${work}/classes.jar`, '-C', `${work}/classes`, '.']);
fs.mkdirSync(`${work}/dex`);
run(`${BT}/d8.bat`, ['--min-api', '24', '--lib', JAR, '--output', `${work}/dex`, `${work}/classes.jar`]);
run(`${JDK}/jar.exe`, ['uf', `${work}/base.apk`, '-C', `${work}/dex`, 'classes.dex']);
run(`${BT}/zipalign.exe`, ['-f', '-p', '4', `${work}/base.apk`, `${work}/aligned.apk`]);
run(`${BT}/apksigner.bat`, ['sign', '--ks', KEYSTORE, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--out', `${work}/signed.apk`, `${work}/aligned.apk`]);
run(`${BT}/apksigner.bat`, ['verify', `${work}/signed.apk`]);
fs.copyFileSync(`${work}/signed.apk`, out);
fs.rmSync(work, { recursive: true, force: true });
console.log('Built', out);
