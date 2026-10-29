// Bienvenida en bucle (29 oct 2026, un fundador en Windows 11 con Node 24.14 y v0.2.10): con el primer arranque ya
// completado, el servidor encendido por la app de escritorio, el arranque automático (VBS) o PowerShell responde
// /api/primer-arranque con falta:true y nombre:null; encendido desde Git Bash con entorno.sh, no. Este script mide una
// etapa: (opcional) completa la bienvenida por la API real, la lee y deja evidencia (proceso de la web, programa usado,
// primeros bytes del archivo, logs). Salida: «ETAPA <nombre> …» y código 1 si la lectura no ve la bienvenida completa.
//
//   node bienvenida-diag.mjs <etapa> [--completar]
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const etapa = process.argv[2] ?? 'sin-nombre'
const completar = process.argv.includes('--completar')
const home = homedir()
const datos = process.env.DATOS || (process.platform === 'win32'
  ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'ai.arbrain.servidor')
  : join(home, 'Library', 'Application Support', 'ai.arbrain.servidor'))
const config = join(datos, 'daemon', 'config')
const salida = process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'resultados.txt') : null
const decir = (l) => { console.log(l); if (salida) appendFileSync(salida, l + '\n') }

// Espera a que la web de ESTE arranque conteste (el control nace antes que la web; «estado» no basta).
const t0 = Date.now()
let proceso = null
for (;;) {
  try {
    proceso = JSON.parse(readFileSync(join(config, 'servidor.json'), 'utf8'))
    const v = await fetch(`http://127.0.0.1:${proceso.puertoWeb}/api/version`, { signal: AbortSignal.timeout(3000) })
    if (v.status === 200) break
  } catch { /* todavía no */ }
  if (Date.now() - t0 > Number(process.env.PLAZO_S || 1800) * 1000) {
    decir(`ETAPA ${etapa} la web no contestó en ${process.env.PLAZO_S || 1800} s`)
    for (const p of [process.env.ARRANQUE_LOG, join(datos, 'logs', 'servidor.log'), join(datos, 'logs', 'web.log'), join(datos, 'logs', 'daemon.log')].filter(Boolean)) {
      if (!existsSync(p)) { decir(`ETAPA ${etapa} sin ${p}`); continue }
      for (const l of readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).slice(-40)) decir(`ETAPA ${etapa} ${p.split(/[\\/]/).pop()}: ${l.slice(0, 400)}`)
    }
    decir(`ETAPA ${etapa} MAL`); process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 1000))
}
decir(`ETAPA ${etapa} web lista en ${Math.round((Date.now() - t0) / 1000)} s (pid supervisor ${proceso.pid}, puerto ${proceso.puertoWeb})`)
const base = `http://127.0.0.1:${proceso.puertoWeb}`
const acceso = JSON.parse(readFileSync(join(config, 'acceso.json'), 'utf8'))
const g = Number.isSafeInteger(Number(acceso.generacion)) ? Number(acceso.generacion) : 0
const cookie = `arbrain_escritorio=s1.${createHmac('sha256', acceso.contrasena).update(`arbrain-sesion-servidor:${g}`).digest('hex')}`
const pedir = async (ruta, cuerpo) => {
  const r = await fetch(`${base}${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { cookie, Origin: base, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  let j = null; try { j = await r.json() } catch { /* */ }
  return { status: r.status, j }
}

if (completar) {
  const g0 = await pedir('/api/primer-arranque')
  const v = g0.j?.versionTextos
  for (const c of [{ accion: 'aceptar', version: v }, { accion: 'nombre', nombre: 'Iván' }, { accion: 'completar' }]) {
    const r = await pedir('/api/primer-arranque', c)
    decir(`ETAPA ${etapa} POST ${c.accion} → ${r.status}${r.j?.error ? ` (${r.j.error})` : ''}`)
  }
}

const r = await pedir('/api/primer-arranque')
const s = await pedir('/api/chat/sessions')
const sesiones = Array.isArray(s.j?.sessions) ? s.j.sessions.length : (Array.isArray(s.j) ? s.j.length : '?')
decir(`ETAPA ${etapa} GET /api/primer-arranque → ${r.status} falta=${r.j?.falta} nombre=${JSON.stringify(r.j?.estado?.nombre ?? null)} completado=${r.j?.estado?.completado ? 'si' : 'no'}${r.j?.error ? ` error=«${r.j.error}»` : ''} · /api/chat/sessions → ${s.status} (${sesiones})`)

const archivo = join(datos, 'web', 'primer-arranque.json')
if (existsSync(archivo)) {
  const b = readFileSync(archivo)
  let parse = 'ok'; try { JSON.parse(b.toString('utf8')) } catch (e) { parse = e.message }
  decir(`ETAPA ${etapa} archivo ${statSync(archivo).size} bytes, inicio ${b.subarray(0, 4).toString('hex')}, JSON.parse desde el runner: ${parse}`)
} else decir(`ETAPA ${etapa} archivo: no existe ${archivo}`)

if (process.platform === 'win32') {
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)\" }"], { encoding: 'utf8' })
  for (const l of (ps.stdout || '').split(/\r?\n/).filter(Boolean)) decir(`ETAPA ${etapa} proceso ${l.slice(0, 400)}`)
}
for (const n of ['servidor.log', 'web.log']) {
  const p = join(datos, 'logs', n)
  if (!existsSync(p)) continue
  const lineas = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)
  for (const l of lineas.slice(-15)) decir(`ETAPA ${etapa} ${n}: ${l.slice(0, 300)}`)
}
const bien = r.status === 200 && r.j?.falta === false && r.j?.estado?.nombre === 'Iván'
decir(`ETAPA ${etapa} ${bien ? 'BIEN' : 'MAL'}`)
process.exit(bien ? 0 : 1)
