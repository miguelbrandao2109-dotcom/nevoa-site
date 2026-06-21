const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
} = require('@whiskeysockets/baileys')
const fs   = require('fs')
const path = require('path')
const pino = require('pino')
const readline = require('readline')

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const config       = JSON.parse(fs.readFileSync('./config.json'))
const prefix       = config.prefix
const dono         = config.dono
const canal        = config.link
const numeroDono   = config.numero_dono
const nomeBot      = config.nomeBot
const portal       = config.makiapis
const API_BASE     = 'http://localhost:3000'
const API_KEY      = '396125'
const API_USER     = 'GUMBALLbot'

// ─── HELPERS DE ARQUIVO ────────────────────────────────────────────────────────
const DB_PATH  = './db'
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH)

function readDB(name) {
  const file = path.join(DB_PATH, `${name}.json`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}')
  return JSON.parse(fs.readFileSync(file))
}

function writeDB(name, data) {
  fs.writeFileSync(path.join(DB_PATH, `${name}.json`), JSON.stringify(data, null, 2))
}

// ─── SISTEMAS ──────────────────────────────────────────────────────────────────
// Anti-link: grupos salvos no DB
function isAntiLink(groupId) {
  const db = readDB('antilink')
  return !!db[groupId]
}

// Boas-vindas
function isWelcome(groupId) {
  const db = readDB('welcome')
  return !!db[groupId]
}

function isGoodbye(groupId) {
  const db = readDB('adeus')
  return !!db[groupId]
}

// Economia
function getUser(id) {
  const db = readDB('economia')
  if (!db[id]) db[id] = { coins: 0, bank: 0, lastDaily: 0, lastWork: 0, lastRob: 0, vip: false }
  writeDB('economia', db)
  return db[id]
}
function saveUser(id, data) {
  const db = readDB('economia')
  db[id] = data
  writeDB('economia', db)
}

// Warn
function getWarns(groupId, userId) {
  const db = readDB('warns')
  if (!db[groupId]) db[groupId] = {}
  return db[groupId][userId] || 0
}
function addWarn(groupId, userId) {
  const db = readDB('warns')
  if (!db[groupId]) db[groupId] = {}
  db[groupId][userId] = (db[groupId][userId] || 0) + 1
  writeDB('warns', db)
  return db[groupId][userId]
}
function resetWarns(groupId, userId) {
  const db = readDB('warns')
  if (!db[groupId]) db[groupId] = {}
  db[groupId][userId] = 0
  writeDB('warns', db)
}

// ─── UTILS ─────────────────────────────────────────────────────────────────────
const esperar = (ms) => new Promise(r => setTimeout(r, ms))
const api = (route) => fetch(`${API_BASE}${route}&key=${API_KEY}&username=${API_USER}`).then(r => r.json())
const apiGet = (route) => fetch(`${API_BASE}${route}?key=${API_KEY}&username=${API_USER}`).then(r => r.json())

function formatCoins(n) { return `💰 ${Number(n).toLocaleString('pt-BR')} moedas` }
function tempoAgora() { return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }
function sortear(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function formatMs(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

const COOLDOWNS = {}
function checkCooldown(key, ms) {
  const now = Date.now()
  if (COOLDOWNS[key] && now - COOLDOWNS[key] < ms) {
    return ms - (now - COOLDOWNS[key])
  }
  COOLDOWNS[key] = now
  return 0
}

// ─── STARTUP ───────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (t) => new Promise(r => rl.question(t, r))

async function StartMakibase() {
  const { state, saveCreds } = await useMultiFileAuthState('./sessao')
  const { version }          = await fetchLatestBaileysVersion()

  const client = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  })

  client.ev.on('creds.update', saveCreds)

  // ── BOAS-VINDAS / SAÍDA ──────────────────────────────────────────────────────
  client.ev.on('group-participants.update', async ({ id, participants, action }) => {
  try {
    const meta = await client.groupMetadata(id)

    for (const p of participants) {
      if (action === 'add') {
        if (!isWelcome(id)) continue

        await client.sendMessage(id, {
          text: `👋 Bem-vindo(a) ao *${meta.subject}*, @${p.split('@')[0]}!`,
          mentions: [p]
        })
      }

      if (action === 'remove') {
        if (!isGoodbye(id)) continue

        await client.sendMessage(id, {
          text: `😢 @${p.split('@')[0]} saiu do grupo. Até mais!`,
          mentions: [p]
        })
      }
    }
  } catch {}
})

  // ── CONEXÃO ──────────────────────────────────────────────────────────────────
  let conectado = false
  client.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !client.authState.creds.registered && !conectado) {
      conectado = true
      const numero = (await question('Digite seu número:\n')).replace(/\D/g, '')
      rl.close()
      let codigo = await client.requestPairingCode(numero)
      codigo = codigo?.match(/.{1,4}/g)?.join('-') || codigo
      console.log(`🔑 Código de Pareamento: ${codigo}\n`)
    }
    if (connection === 'open') console.log(`✅ ${nomeBot} conectado!`)
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) { console.log('🔄 Reconectando...'); StartMakibase() }
      else console.log('🚪 Deslogado. Apague a pasta sessao para parear novamente.')
    }
  })

  // ── MENSAGENS ────────────────────────────────────────────────────────────────
  client.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const info = messages[0]
      if (!info.message) return
      if (info.key.remoteJid === 'status@broadcast') return

      const type = getContentType(info.message)
      const from = info.key.remoteJid
      const isGroup = from.endsWith('@g.us')
      const sender = isGroup ? info.key.participant : from
      const pushname = info.pushName || 'Usuário'
      const isDono = sender === numeroDono

      // Extrai texto
      const body =
        info.message?.conversation ||
        info.message?.extendedTextMessage?.text ||
        info.message?.imageMessage?.caption ||
        info.message?.videoMessage?.caption ||
        info.message?.buttonsResponseMessage?.selectedButtonId ||
        info.message?.listResponseMessage?.singleSelectReply?.selectedRowId || ''

      const isCmd = body.startsWith(prefix)
      const comando = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : null
      const args = body.trim().split(/\s+/).slice(1)
      const q = args.join(' ')

      // Mencionado / quoted
      const quoted = info.message?.extendedTextMessage?.contextInfo?.quotedMessage
      const mentioned = info.message?.extendedTextMessage?.contextInfo?.mentionedJid || []

      const reply = (texto) => client.sendMessage(
    from,
    {
        text: String(texto),
        contextInfo: {
            externalAdReply: {
                title: "👻",
                body: "A Melhor BOT do momento! 👻",
                thumbnailUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQqfTzKKN9Fpp6FTuioyxaK6vzPiOz2hhvnv3gLRFdCPA&s=10",
                sourceUrl: "https://miguelbrandao2109-dotcom.github.io/nevoa-site/",
                mediaType: 1,
                renderLargerThumbnail: false
            }
        }
    },
    { quoted: info }
);
      const react = (emoji) => client.sendMessage(from, { react: { text: emoji, key: info.key } })

      // ── ANTI-LINK ──────────────────────────────────────────────────────────────
      if (isGroup && isAntiLink(from) && !isDono) {
        const linkRegex = /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/)/i
        if (linkRegex.test(body)) {
          try {
            await client.sendMessage(from, { delete: info.key })
            await reply(`⛔ @${sender.split('@')[0]} links são proibidos aqui!`)
          } catch {}
          return
        }
      }

      if (!isCmd) return

      // Metadados do grupo (quando necessário)
      let groupMeta = null
      let admins     = []
      let isBotAdmin = false
      let isAdmin    = false
      if (isGroup) {
        groupMeta  = await client.groupMetadata(from)
        admins     = groupMeta.participants.filter(p => p.admin).map(p => p.id)
        isBotAdmin = admins.includes(client.user.id.replace(':0', '') + ':0') ||
                     admins.includes(client.user.id)
        isAdmin    = admins.includes(sender) || isDono
      }

      // ────────────────────────────────────────────────────────────────────────────
      // S W I T C H  D E  C O M A N D O S
      // ────────────────────────────────────────────────────────────────────────────
      switch (comando) {

        // ── GERAIS ───────────────────────────────────────────────────────────────
        case 'ping':
          await react('🏓')
          await reply(`🏓 *Pong!*\n⏱ ${Date.now() - (info.messageTimestamp * 1000)}ms`)
          break

        case 'menu': {
  const txt = `  
╔══════════════════════╗  
║   🤖 *${nomeBot}*     
╚══════════════════════╝  
  
📌 *GERAIS*  
▸ ${prefix}ping  
▸ ${prefix}info  
▸ ${prefix}dono  
▸ ${prefix}menu  
  
🖼 *MÍDIA*  
▸ ${prefix}wallpaper  
▸ ${prefix}ytmp3 <nome>  
▸ ${prefix}ytmp4 <nome>  
▸ ${prefix}sticker  
  
💰 *ECONOMIA*  
▸ ${prefix}saldo  
▸ ${prefix}daily  
▸ ${prefix}trabalhar  
▸ ${prefix}depositar <val>  
▸ ${prefix}sacar <val>  
▸ ${prefix}transferir @user <val>  
▸ ${prefix}roubar @user  
▸ ${prefix}top  
  
🛡 *ADMIN (grupos)*  
▸ ${prefix}ban @user  
▸ ${prefix}add <número>  
▸ ${prefix}kick @user  
▸ ${prefix}hidemute / ${prefix}hideunmute  
▸ ${prefix}warn @user  
▸ ${prefix}resetwarn @user  
▸ ${prefix}warns @user  
▸ ${prefix}antilink on/off  
▸ ${prefix}bemvindo on/off  
▸ ${prefix}adeus  on/off  
▸ ${prefix}fechar / ${prefix}abrir  
▸ ${prefix}tagall  
  
🎮 *DIVERSÃO*  
▸ ${prefix}coinflip  
▸ ${prefix}dado  
▸ ${prefix}8ball <pergunta>  
▸ ${prefix}piada  
▸ ${prefix}fato  
  
─────────────────────────  
Prefixo: *${prefix}*  |  Dono: *${dono}*  
Canal: ${canal}  
`  

  await client.sendMessage(
    from,
    {
      image: { url: './assets/menu.jpg' }, // ou um Buffer
      caption: txt
    },
    { quoted: info }
  )
  break
}

        case 'info':
          await reply(`🤖 *${nomeBot}*\n\n🔗 Portal: ${portal}\n🕐 ${tempoAgora()}`)
          break

        case 'dono':
          await reply(`👑 Dono: *${dono}*\n📞 Contato: wa.me/${numeroDono.replace(/\D/, '')}`)
          break

        // ── MÍDIA ────────────────────────────────────────────────────────────────
        case 'wallpaper': {
          await react('🕚')
          try {
            const res = await fetch(`${API_BASE}/api/wallpaper?key=${API_KEY}&username=${API_USER}`)
            const buf = Buffer.from(await res.arrayBuffer())
            await client.sendMessage(from, { image: buf, caption: `🏕 Wallpaper para você, *${pushname}*! 🎲` }, { quoted: info })
          } catch { reply('❌ Não achei wallpaper agora, tente mais tarde.') }
          break
        }

        case 'play':
        case 'ytmp3': {
          if (!q) return reply(`❌ Use: *${prefix}ytmp3 <nome da música>*`)
          await react('🎧')
          try {
            const search = await fetch(`${API_BASE}/yt/yt-search?q=${encodeURIComponent(q)}&key=${API_KEY}&username=${API_USER}`).then(r => r.json())
            if (!search.success || !search.results.length) return reply('❌ Não encontrei essa música.')
            const video    = search.results[0]
            const audioRes = await fetch(`${API_BASE}/ytmp3?url=${encodeURIComponent(video.url)}&key=${API_KEY}&username=${API_USER}`).then(r => r.json())
            if (!audioRes.sucesso) return reply('❌ Erro ao baixar áudio.')
            const buf = Buffer.from(await (await fetch(audioRes.data.url)).arrayBuffer())
            await client.sendMessage(from, { image: { url: video.thumbnail }, caption: `🎶 *${audioRes.data.title}*\n⏱ ${audioRes.data.duracao}\n👤 ${audioRes.data.canal}` }, { quoted: info })
            await client.sendMessage(from, { audio: buf, mimetype: 'audio/mp4', fileName: `${audioRes.data.title}.mp3` }, { quoted: info })
          } catch (e) { console.log(e); reply('❌ Erro ao baixar a música.') }
          break
        }

        case 'playvid':
        case 'ytmp4': {
          if (!q) return reply(`❌ Use: *${prefix}ytmp4 <nome do vídeo>*`)
          await react('🎬')
          try {
            const search = await fetch(`${API_BASE}/yt/yt-search?q=${encodeURIComponent(q)}&key=${API_KEY}&username=${API_USER}`).then(r => r.json())
            if (!search.success || !search.results.length) return reply('❌ Não encontrei esse vídeo.')
            const video    = search.results[0]
            const videoRes = await fetch(`${API_BASE}/ytmp4?url=${encodeURIComponent(video.url)}&key=${API_KEY}&username=${API_USER}`).then(r => r.json())
            if (!videoRes.sucesso) return reply('❌ Erro ao baixar vídeo.')
            const buf = Buffer.from(await (await fetch(videoRes.data.url)).arrayBuffer())
            await client.sendMessage(from, { image: { url: video.thumbnail }, caption: `🎬 *${video.title}*\n⏱ ${video.duration}\n👤 ${video.author}` }, { quoted: info })
            await client.sendMessage(from, { video: buf, mimetype: 'video/mp4', fileName: `${video.title}.mp4` }, { quoted: info })
          } catch (e) { console.log(e); reply('❌ Erro ao baixar o vídeo.') }
          break
        }

        case 'sticker': {
          // Transforma imagem/vídeo quotado ou enviado junto em sticker
          try {
            const msg = info.message?.imageMessage || quoted?.imageMessage
            if (!msg) return reply(`❌ Envie ou quote uma imagem com *${prefix}sticker*`)
            await react('🎨')
            const media = await downloadMediaMessage({ key: info.key, message: info.message }, 'buffer', {})
            const { exec } = require('child_process')
            const tmpIn  = `/tmp/stk_in_${Date.now()}.jpg`
            const tmpOut = `/tmp/stk_out_${Date.now()}.webp`
            fs.writeFileSync(tmpIn, media)
            await new Promise((res, rej) => exec(`ffmpeg -i ${tmpIn} -vf scale=512:512:force_original_aspect_ratio=decrease ${tmpOut}`, (e) => e ? rej(e) : res()))
            await client.sendMessage(from, { sticker: fs.readFileSync(tmpOut) }, { quoted: info })
            fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut)
          } catch (e) { console.log(e); reply('❌ Erro ao criar sticker. Certifique-se que o ffmpeg está instalado.') }
          break
        }

        // ── ECONOMIA ─────────────────────────────────────────────────────────────
        case 'saldo': {
          const u = getUser(sender)
          await reply(`💼 *Carteira de ${pushname}*\n\n👛 Carteira: ${formatCoins(u.coins)}\n🏦 Banco: ${formatCoins(u.bank)}\n💎 Total: ${formatCoins(u.coins + u.bank)}`)
          break
        }

        case 'daily': {
          const u = getUser(sender)
          const agora = Date.now()
          const TEMPO = 20 * 60 * 60 * 1000 // 20h
          const rest = u.lastDaily + TEMPO - agora
          if (rest > 0) return reply(`⏳ Volte em *${formatMs(rest)}* para pegar seu daily.`)
          const ganho = sortear(500, 1500)
          u.coins += ganho
          u.lastDaily = agora
          saveUser(sender, u)
          await reply(`✅ Você coletou o daily!\n+${formatCoins(ganho)}\n\n👛 Carteira: ${formatCoins(u.coins)}`)
          break
        }

        case 'trabalhar': {
          const u = getUser(sender)
          const agora = Date.now()
          const TEMPO = 2 * 60 * 60 * 1000 // 2h
          const rest = u.lastWork + TEMPO - agora
          if (rest > 0) return reply(`⏳ Você está cansado! Descanse por *${formatMs(rest)}*.`)
          const empregos = [
            ['programador', 300, 800],
            ['motorista', 200, 600],
            ['médico', 400, 1000],
            ['chef', 250, 700],
            ['policial', 300, 750],
          ]
          const [cargo, min, max] = empregos[sortear(0, empregos.length - 1)]
          const ganho = sortear(min, max)
          u.coins += ganho
          u.lastWork = agora
          saveUser(sender, u)
          await reply(`💼 Você trabalhou como *${cargo}* e ganhou ${formatCoins(ganho)}!\n\n👛 Carteira: ${formatCoins(u.coins)}`)
          break
        }

        case 'depositar': {
          const val = parseInt(q)
          if (!val || val <= 0) return reply(`❌ Use: *${prefix}depositar <valor>*`)
          const u = getUser(sender)
          if (u.coins < val) return reply('❌ Você não tem moedas suficientes na carteira.')
          u.coins -= val; u.bank += val
          saveUser(sender, u)
          await reply(`🏦 Depositado ${formatCoins(val)}!\n👛 Carteira: ${formatCoins(u.coins)}\n🏦 Banco: ${formatCoins(u.bank)}`)
          break
        }

        case 'sacar': {
          const val = parseInt(q)
          if (!val || val <= 0) return reply(`❌ Use: *${prefix}sacar <valor>*`)
          const u = getUser(sender)
          if (u.bank < val) return reply('❌ Você não tem esse valor no banco.')
          u.bank -= val; u.coins += val
          saveUser(sender, u)
          await reply(`💸 Sacado ${formatCoins(val)}!\n👛 Carteira: ${formatCoins(u.coins)}\n🏦 Banco: ${formatCoins(u.bank)}`)
          break
        }

        case 'transferir': {
          const alvo = mentioned[0] || (args[0]?.includes('@') ? args[0].replace('@', '') + '@s.whatsapp.net' : null)
          const val  = parseInt(args[1] || args[0])
          if (!alvo || !val || val <= 0) return reply(`❌ Use: *${prefix}transferir @user <valor>*`)
          const u = getUser(sender)
          if (u.coins < val) return reply('❌ Sem moedas suficientes.')
          const alvoUser = getUser(alvo)
          u.coins -= val; alvoUser.coins += val
          saveUser(sender, u); saveUser(alvo, alvoUser)
          await reply(`✅ Você transferiu ${formatCoins(val)} para @${alvo.split('@')[0]}!`)
          break
        }

        case 'roubar': {
          const alvo = mentioned[0]
          if (!alvo) return reply(`❌ Use: *${prefix}roubar @user*`)
          if (alvo === sender) return reply('❌ Você não pode roubar a si mesmo.')
          const u = getUser(sender)
          const agora = Date.now()
          const TEMPO = 3 * 60 * 60 * 1000
          const rest = u.lastRob + TEMPO - agora
          if (rest > 0) return reply(`⏳ Aguarde *${formatMs(rest)}* para roubar novamente.`)
          const alvoUser = getUser(alvo)
          if (alvoUser.coins < 100) return reply('❌ Alvo sem dinheiro suficiente para roubar.')
          const chance = sortear(1, 100)
          u.lastRob = agora
          if (chance <= 50) {
            const roubado = sortear(50, Math.min(alvoUser.coins, 500))
            u.coins += roubado; alvoUser.coins -= roubado
            saveUser(sender, u); saveUser(alvo, alvoUser)
            await reply(`🥷 Roubo bem-sucedido! Você pegou ${formatCoins(roubado)} de @${alvo.split('@')[0]}!`)
          } else {
            const multa = sortear(100, 300)
            u.coins = Math.max(0, u.coins - multa)
            saveUser(sender, u)
            await reply(`👮 Você foi pego tentando roubar e pagou uma multa de ${formatCoins(multa)}!`)
          }
          break
        }

        case 'top': {
          const db = readDB('economia')
          const lista = Object.entries(db)
            .map(([id, u]) => ({ id, total: u.coins + u.bank }))
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)
          const medalhas = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟']
          const txt = lista.map((u, i) => `${medalhas[i]} @${u.id.split('@')[0]} — ${formatCoins(u.total)}`).join('\n')
          await client.sendMessage(from, { text: `🏆 *TOP 10 MAIS RICOS*\n\n${txt}`, mentions: lista.map(u => u.id) }, { quoted: info })
          break
        }

        // ── ADMIN ─────────────────────────────────────────────────────────────────
        case 'ban':
        case 'kick': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          if (!isBotAdmin) return reply('❌ Me torne admin primeiro.')
          const alvo = mentioned[0] || (quoted ? (info.message.extendedTextMessage?.contextInfo?.participant) : null)
          if (!alvo) return reply(`❌ Marque alguém ou quote a mensagem. Ex: *${prefix}ban @user*`)
          await client.groupParticipantsUpdate(from, [alvo], 'remove')
          await reply(`✅ @${alvo.split('@')[0]} foi removido(a).`)
          break
        }

        case 'add': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          if (!isBotAdmin) return reply('❌ Me torne admin primeiro.')
          if (!q) return reply(`❌ Use: *${prefix}add <número com DDI>*`)
          const numero = q.replace(/\D/g, '') + '@s.whatsapp.net'
          await client.groupParticipantsUpdate(from, [numero], 'add')
          await reply(`✅ ${q} adicionado(a).`)
          break
        }

        case 'hidemute': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          if (!isBotAdmin) return reply('❌ Me torne admin primeiro.')
          await client.groupSettingUpdate(from, 'announcement')
          await reply('🔒 Grupo fechado! Apenas admins podem enviar mensagens.')
          break
        }

        case 'hideunmute':
        case 'abrir': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          if (!isBotAdmin) return reply('❌ Me torne admin primeiro.')
          await client.groupSettingUpdate(from, 'not_announcement')
          await reply('🔓 Grupo aberto! Todos podem enviar mensagens.')
          break
        }

        case 'fechar': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          await client.groupSettingUpdate(from, 'announcement')
          await reply('🔒 Grupo fechado.')
          break
        }

        case 'warn': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          const alvo = mentioned[0] || (info.message.extendedTextMessage?.contextInfo?.participant)
          if (!alvo) return reply(`❌ Marque alguém. Ex: *${prefix}warn @user*`)
          const total = addWarn(from, alvo)
          await client.sendMessage(from, { text: `⚠️ @${alvo.split('@')[0]} recebeu um aviso!\nTotal: *${total}/3*`, mentions: [alvo] }, { quoted: info })
          if (total >= 3) {
            await client.groupParticipantsUpdate(from, [alvo], 'remove')
            resetWarns(from, alvo)
            await reply(`🚫 @${alvo.split('@')[0]} foi removido(a) por atingir 3 warns.`)
          }
          break
        }

        case 'resetwarn': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          const alvo = mentioned[0]
          if (!alvo) return reply(`❌ Marque alguém. Ex: *${prefix}resetwarn @user*`)
          resetWarns(from, alvo)
          await reply(`✅ Warns de @${alvo.split('@')[0]} resetados.`)
          break
        }

        case 'warns': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          const alvo = mentioned[0] || sender
          const total = getWarns(from, alvo)
          await reply(`⚠️ @${alvo.split('@')[0]} tem *${total}/3* warns.`)
          break
        }

        case 'antilink': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          const db = readDB('antilink')
          if (q === 'on') {
            db[from] = true
            writeDB('antilink', db)
            await reply('✅ Anti-link *ativado*! Links serão deletados.')
          } else if (q === 'off') {
            delete db[from]
            writeDB('antilink', db)
            await reply('❌ Anti-link *desativado*.')
          } else {
            await reply(`❓ Use: *${prefix}antilink on/off*`)
          }
          break
        }

        case 'bemvindo':
        case 'welcome': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          const db = readDB('welcome')
          if (q === 'on') {
            db[from] = true
            writeDB('welcome', db)
            await reply('✅ Boas-vindas *ativado*!')
          } else if (q === 'off') {
            delete db[from]
            writeDB('welcome', db)
            await reply('❌ Boas-vindas *desativado*.')
          } else {
            await reply(`❓ Use: *${prefix}bemvindo on/off*`)
          }
          break
        }
  
        case 'Adeus':
        case 'goodbye': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          const db = readDB('adeus')
          if (q === 'on') {
            db[from] = true
            writeDB('adeus', db)
            await reply('✅ Adeus *ativado*!')
          } else if (q === 'off') {
            delete db[from]
            writeDB('adeus', db)
            await reply('❌ Adeus *desativado*.')
          } else {
            await reply(`❓ Use: *${prefix}bemvindo on/off*`)
          }
          break
        }

        case 'tagall': {
          if (!isGroup) return reply('❌ Apenas em grupos.')
          if (!isAdmin) return reply('❌ Apenas admins.')
          const todos = groupMeta.participants.map(p => p.id)
          const lista = todos.map(p => `@${p.split('@')[0]}`).join('\n')
          await client.sendMessage(from, { text: `📢 *${q || 'Atenção pessoal!'}*\n\n${lista}`, mentions: todos }, { quoted: info })
          break
        }

        // ── DIVERSÃO ─────────────────────────────────────────────────────────────
        case 'coinflip': {
          await react('🪙')
          const resultado = Math.random() < 0.5 ? '🦅 Cara!' : '🌟 Coroa!'
          await reply(`🪙 Lançando moeda...\n\n${resultado}`)
          break
        }

        case 'dado': {
          await react('🎲')
          const faces = parseInt(q) || 6
          const resultado = sortear(1, faces)
          await reply(`🎲 Dado de ${faces} faces: *${resultado}*`)
          break
        }

        case '8ball': {
          if (!q) return reply(`❌ Use: *${prefix}8ball <sua pergunta>*`)
          const respostas = [
            '✅ Sim, com certeza!', '✅ É muito provável.', '✅ Sem dúvidas.',
            '🔮 As perspectivas são boas.', '🔮 Pergunte novamente mais tarde.',
            '🔮 Não consigo prever agora.', '❌ Não conte com isso.', '❌ A resposta é não.',
            '❌ Muito improvável.', '🔮 Concentre-se e pergunte novamente.'
          ]
          await react('🎱')
          await reply(`🎱 *${q}*\n\n${respostas[sortear(0, respostas.length - 1)]}`)
          break
        }

        case 'piada': {
          const piadas = [
            'Por que o computador foi ao médico? Porque tinha vírus! 🤧',
            'O que o zero disse para o oito? Bonito cinto! 😂',
            'Por que o livro de matemática ficou triste? Tinha muitos problemas! 📚',
            'O que o pato disse para a pata? Vem cá, pata! 🦆',
            'Por que o espantalho ganhou um prêmio? Porque era outstanding in his field! 🌾',
          ]
          await react('😂')
          await reply(`😂 *Piada do dia:*\n\n${piadas[sortear(0, piadas.length - 1)]}`)
          break
        }

        case 'fato': {
          const fatos = [
            '🐙 Polvos têm três corações.',
            '🍯 O mel nunca estraga — arqueólogos encontraram mel comestível com 3.000 anos.',
            '🦴 Bebês humanos nascem com 270 ossos; adultos têm 206.',
            '🌊 O oceano produz mais de 50% do oxigênio que respiramos.',
            '🐘 Elefantes são os únicos animais que não conseguem pular.',
            '⚡ Um raio é 5x mais quente que a superfície do Sol.',
          ]
          await react('🤓')
          await reply(`🤓 *Fato curioso:*\n\n${fatos[sortear(0, fatos.length - 1)]}`)
          break
        }

        default:
          // Comando desconhecido — silencioso para não poluir o chat
          break
      }
    } catch (err) {
      console.error('Erro no handler:', err)
    }
  })
}

StartMakibase()