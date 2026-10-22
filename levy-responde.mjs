// Comprueba, después del prompt real, que Arbrain quedó usable como lo usaría la persona (22 oct 2026, v0.2.8):
// servidor corriendo, app de escritorio instalada y con su proceso vivo, y Levy respondiendo un «¿Quién eres?».
// La llave de OpenRouter se guarda por la misma ruta que usa Ajustes › Llaves (la web la pasa al supervisor); nunca
// se imprime. Salida: líneas «OK …» o «FALLA …»; código 1 si algo falla.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const home = homedir()
const plat = process.platform
const datos = plat === 'darwin' ? join(home, 'Library', 'Application Support', 'ai.arbrain.servidor')
  : plat === 'win32' ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'ai.arbrain.servidor')
  : join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'ai.arbrain.servidor')
const config = join(datos, 'daemon', 'config')
let fallas = 0
const ok = (m) => console.log(`OK ${m}`)
const falla = (m) => { fallas++; console.log(`FALLA ${m}`) }
const t0 = Date.now()
const seg = () => Math.round((Date.now() - t0) / 1000)

const proceso = JSON.parse(readFileSync(join(config, 'servidor.json'), 'utf8'))
const base = `http://127.0.0.1:${proceso.puertoWeb}`
const acceso = JSON.parse(readFileSync(join(config, 'acceso.json'), 'utf8'))
const g = Number.isSafeInteger(Number(acceso.generacion)) ? Number(acceso.generacion) : 0
const cookie = `arbrain_escritorio=s1.${createHmac('sha256', acceso.contrasena).update(`arbrain-sesion-servidor:${g}`).digest('hex')}`
ok(`servidor en ${base}`)

// App de escritorio: registro del instalador y proceso vivo.
const cfgApp = join(home, '.config', 'arbrain', 'escritorio.json')
if (existsSync(cfgApp)) ok(`app instalada: ${JSON.parse(readFileSync(cfgApp, 'utf8')).app}`)
else falla('no existe ~/.config/arbrain/escritorio.json (la app no se instaló)')
const ps = plat === 'win32'
  ? spawnSync('tasklist', ['/FI', 'IMAGENAME eq Arbrain.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
  : spawnSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).stdout ?? ''
const vivo = plat === 'win32' ? /Arbrain\.exe/i.test(ps) : ps.split('\n').some((l) => /Arbrain\.app\/Contents\/MacOS\/|arbrain-escritorio/.test(l))
vivo ? ok('proceso de la app vivo') : falla('la app no tiene proceso vivo')

// Llave de OpenRouter, como la pega la persona en Ajustes › Llaves.
const llave = process.env.OR_KEY?.trim()
if (!llave) { falla('falta OR_KEY'); process.exit(1) }
const guardar = await fetch(`${base}/api/llaves/servidor/guardar`, {
  method: 'POST', headers: { cookie, Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ nombre: 'OPENROUTER_API_KEY', valor: llave }),
})
guardar.ok ? ok('llave de OpenRouter guardada por Ajustes') : falla(`guardar llave: ${guardar.status}`)

// Espera a que el daemon reinicie con la llave.
let listo = false
await new Promise((r) => setTimeout(r, 3000))
for (let i = 0; i < 60 && !listo; i++) {
  const d = await fetch(`${base}/api/llaves/servidor/daemon`, { headers: { cookie } }).then((r) => r.json()).catch(() => ({}))
  listo = d.ready === true
  if (!listo) await new Promise((r) => setTimeout(r, 2000))
}
listo ? ok(`daemon listo con la llave (${seg()} s)`) : falla('el daemon no quedó listo tras guardar la llave')

// «¿Quién eres?» por el chat real.
const tChat = Date.now()
const turno = await fetch(`${base}/api/chat/stream`, {
  method: 'POST', headers: { cookie, Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '¿Quién eres? Responde en una línea.' }), signal: AbortSignal.timeout(240_000),
})
const cuerpo = await turno.text()
let texto = ''
for (const l of cuerpo.split('\n')) {
  if (!l.startsWith('data: ')) continue
  try { const j = JSON.parse(l.slice(6)); if (j.type === 'text_delta') texto += j.text } catch { /* */ }
}
const segChat = Math.round((Date.now() - tChat) / 1000)
if (turno.ok && texto.trim().length > 0) ok(`Levy respondió en ${segChat} s: «${texto.trim().replace(/\s+/g, ' ').slice(0, 200)}»`)
else falla(`Levy no respondió (${turno.status}): ${cuerpo.slice(0, 400)}`)
process.exit(fallas ? 1 : 0)
