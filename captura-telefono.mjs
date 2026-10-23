// Capturas de «Tu cerebro en el teléfono» (23 oct 2026, e2e-telefono.yml): Arbrain ya corre con el teléfono encendido
// (prueba-telefono.mjs --mantener, con el tailscale falso). Uso: node captura-telefono.mjs <datos> <carpeta de salida>
//   1. ajustes-telefono.png        Ajustes › Tu cerebro en el teléfono en la computadora (estado, QR, código).
//   2. telefono-entrada.png        La entrada en un iPhone, por un proxy local que hace lo de `tailscale serve`
//                                  (Host maquina.ejemplo.ts.net + X-Forwarded-Proto https).
//   3. telefono-chat.png           Tu Arbrain en el iPhone ya con sesión.
// Nunca imprime la contraseña. Playwright viene de PW_DIR (npm i playwright en una carpeta aparte).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import http from 'node:http'

const [datos, salida] = process.argv.slice(2)
const require = createRequire(join(process.env.PW_DIR, 'package.json'))
const { chromium, devices } = require('playwright')
const { puerto, host } = JSON.parse(readFileSync(join(datos, 'prueba-telefono.json'), 'utf8'))
const acceso = JSON.parse(readFileSync(join(datos, 'daemon', 'config', 'acceso.json'), 'utf8'))
const g = Number.isSafeInteger(Number(acceso.generacion)) ? Number(acceso.generacion) : 0
const valor = `s1.${createHmac('sha256', acceso.contrasena).update(`arbrain-sesion-servidor:${g}`).digest('hex')}`

// Primer arranque ya hecho (como una persona que ya instaló): si no, toda página lleva a /bienvenida.
const legales = readFileSync(join(process.env.COPIA, 'arbrain', 'src', 'features', 'primer-arranque', 'textos', 'legales.ts'), 'utf8')
const versionTextos = /VERSION_TEXTOS = '([^']+)'/.exec(legales)[1]
const ahora = new Date().toISOString()
writeFileSync(join(datos, 'web', 'primer-arranque.json'), JSON.stringify({ version: 1, aceptado: { version: versionTextos, fecha: ahora }, nombre: 'Ana', completado: ahora, sesionBienvenida: null }))

// Proxy «tailscale serve» de mentira: conserva el Host del teléfono y avisa que el navegador habló HTTPS.
const proxy = http.createServer((req, res) => {
  const p = http.request({ host: '127.0.0.1', port: puerto, path: req.url, method: req.method,
    headers: { ...req.headers, host, 'x-forwarded-proto': 'https', 'x-forwarded-host': host } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res) })
  p.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(p)
})
await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok))
const pp = proxy.address().port

const nav = await chromium.launch()
try {
  // 1. Computadora.
  const pc = await nav.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  await pc.addCookies([{ name: 'arbrain_escritorio', value: valor, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const p1 = await pc.newPage()
  await p1.goto(`http://127.0.0.1:${puerto}/settings?seccion=telefono`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await p1.waitForSelector('[data-estado="encendido"]', { timeout: 120_000 })
  await p1.getByRole('button', { name: 'Código para entrar' }).click()
  await p1.waitForSelector('[data-codigo]', { timeout: 30_000 })
  await p1.waitForTimeout(800)
  await p1.screenshot({ path: join(salida, 'ajustes-telefono.png') })
  const url = await p1.textContent('[data-url-telefono]')
  console.log(`OK Ajustes › Tu cerebro en el teléfono: encendido, dirección ${url}, QR y código visibles`)

  // 2 y 3. iPhone por el «tailscale serve» de mentira.
  const tel = await nav.newContext({ ...devices['iPhone 15 Pro'] })
  const p2 = await tel.newPage()
  await p2.goto(`http://127.0.0.1:${pp}/chat`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await p2.waitForSelector('[data-telefono="1"]', { timeout: 60_000 })
  await p2.screenshot({ path: join(salida, 'telefono-entrada.png') })
  console.log('OK iPhone sin sesión: la entrada pide «Código o contraseña»')
  // La cookie real lleva Secure (HTTPS de Tailscale); este proxy es HTTP, así que se pone a mano para el mismo origen.
  await tel.addCookies([{ name: 'arbrain_escritorio', value: valor, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  await p2.goto(`http://127.0.0.1:${pp}/chat`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await p2.waitForTimeout(6000)
  await p2.screenshot({ path: join(salida, 'telefono-chat.png') })
  const titulo = await p2.title()
  const manifiesto = await p2.getAttribute('link[rel="manifest"]', 'href')
  const apple = await p2.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content')
  console.log(`OK iPhone con sesión: /chat (${titulo}); manifest ${manifiesto}; título en pantalla de inicio «${apple}»`)
  if (manifiesto !== '/manifest-cliente.json' || apple !== 'Tu Arbrain') { console.log('FALLA la PWA no se llama «Tu Arbrain»'); process.exitCode = 1 }
} finally {
  await nav.close()
  proxy.close()
}
