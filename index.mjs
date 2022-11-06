import express from 'express'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import requestID from 'express-request-id'
import bodyParser from 'body-parser'
import mysql from 'mysql2/promise'
import DiscordOauth2 from 'discord-oauth2'
import Crypto from 'crypto'
import session from 'express-session'
import mysqlSession from 'express-mysql-session'
import fetch from 'node-fetch'
import { Client, GatewayIntentBits } from 'discord.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const args = process.argv.slice(2)

if (args.length < 6) {
  console.error('Parameters not provided: [mysql_host] [mysql_user] [mysql_password] [mysql_database] [session_secret] [discord_oauth_client_secret] [discord_oauth_redirect_uri] [discord_bot_token] [kart_api_key]')
  process.exit(1)
}

const options = {
  host: args[0],
  user: args[1],
  password: args[2],
  database: args[3],
  connectionLimit: 100,
}

const pool = mysql.createPool(options)
await pool.query('DELETE FROM game WHERE closed_at IS NULL')

const mysqlStore = mysqlSession(session)
const sessionStore = new mysqlStore(options)

const app = express()

app.use(requestID())
app.use(bodyParser.json())
app.use(express.static(`${__dirname}/public`))
app.use(session({
  secret: args[4],
  resave: false,
  saveUninitialized: true,
  store: sessionStore,
}))

const key = fs.readFileSync(`${__dirname}/ssl/${fs.readdirSync(`${__dirname}/ssl`).find((file) => file.endsWith('.key.pem'))}`)
const cert = fs.readFileSync(`${__dirname}/ssl/${fs.readdirSync(`${__dirname}/ssl`).find((file) => file.endsWith('.crt.pem'))}`)

http.createServer(app).listen(80)
https.createServer({ key: key, cert: cert }, app).listen(443)

const oauth = new DiscordOauth2({
  clientId: '1029472862765056010',
  clientSecret: args[5],
  redirectUri: args[6],
})

const kartApiKey = args[8]

app.use((req, res, next) => {
  if (!req.session.first_request_at || !req.session.request_amount) {
    req.session.first_request_at = new Date().getTime()
    req.session.request_amount = 0
  }
  else {
    if (new Date().getTime() - req.session.first_request_at > 1000) {
      req.session.first_request_at = new Date().getTime()
    }
    else {
      if (req.session.request_amount >= 10) {
        res.json({
          result: 'error',
          reason: '너무 요청이 많아요! <br> 1초에 10번까지만 요청하실 수 있습니다.'
        })
        return
      }
      else {
        req.session.request_amount++
      }
    }
  }

  req.session.save()

  const protocol = req.headers['x-forwarded-proto'] || req.protocol
  if (protocol == 'https') {
    next()
  }
  else {
    res.redirect(`https://${req.hostname}${req.url}`)
  }
})

app.get('/', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error()
    }

    const accessToken = decrypt(req.session.access_token)
    const discordUser = await oauth.getUser(accessToken)

    const user = (await pool.query(`SELECT * FROM user WHERE id = ${discordUser.id}`))[0][0]

    if (user) {
      await pool.query(`UPDATE user SET name = '${discordUser.username}', discriminator = ${discordUser.discriminator}, avatar = ${discordUser.avatar ? `'${discordUser.avatar}'` : 'NULL'} WHERE id = ${discordUser.id}`)
      res.sendFile(__dirname + '/views/lobby.html')
    }
    else {
      res.sendFile(__dirname + '/views/signup.html')
    }
  }
  catch {
    res.sendFile(__dirname + '/views/signin.html')
  }
})

app.post('/timestamp', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.'
      })
      return
    }

    res.json({
      result: 'ok',
      timestamp: Math.floor(new Date().getTime() / 1000),
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/signup', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.'
      })
      return
    }

    if (!req.body.rider_name) {
      res.json({
        result: 'error',
        reason: '라이더명이 제공되지 않았습니다.'
      })
      return
    }
    else if (!/[A-Za-z0-9가-힣]/g.test(req.body.rider_name)) {
      res.json({
        result: 'error',
        reason: '라이더명은 영문, 한글, 숫자만 포함할 수 있습니다.',
      })
      return
    }
    else {
      let byte = 0

      for (let i = 0; i < req.body.rider_name.length; i++) {
        req.body.rider_name.charCodeAt(i) > 127 ? byte += 2 : byte++
      }

      if (byte < 4 || byte > 12) {
        res.json({
          result: 'error',
          reason: '라이더명은 영문 및 숫자 기준 4 ~ 12자, <br> 한글 기준 2 ~ 6자여야 합니다.',
        })
        return
      }
    }

    const result = await fetch(`https://api.nexon.co.kr/kart/v1.0/users/nickname/${req.body.rider_name}`, {
      headers: {
        Authorization: kartApiKey,
      },
    })

    const rider = await result.json()

    if (!rider.accessId) {
      res.json({
        result: 'error',
        reason: '라이더를 찾지 못했습니다.',
      })
      return
    }

    const accessToken = decrypt(req.session.access_token)
    const user = await oauth.getUser(accessToken)

    await pool.query(`INSERT INTO user (id, name, discriminator, avatar, rider_id) VALUES (${user.id}, '${user.username}', ${user.discriminator}, ${user.avatar ? `'${user.avatar}'` : 'NULL'}, '${rider.accessId}')`)

    res.json({
      result: 'ok',
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/user', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const user = (await pool.query(`SELECT CAST(id AS CHAR) AS id, name, discriminator, avatar FROM user WHERE id = ${decrypt(req.session.user_id)}`))[0][0]

    res.json({
      result: 'ok',
      user: user,
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/notification', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const notificationList = (await pool.query(`SELECT * FROM notification WHERE id NOT IN (SELECT notification_id FROM hide_notification WHERE user_id = ${decrypt(req.session.user_id)}) ORDER BY created_at`))[0]

    res.json({
      result: 'ok',
      notification: notificationList,
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/notification/hide', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    if (!(Number(req.body.notification_id) > 0) || !(Number(req.body.notification_id) < Math.pow(2, 32) - 1)) {
      res.json({
        result: 'error',
        reason: '알림 id가 제공되지 않았거나 잘못된 타입입니다.',
      })
      return
    }

    await pool.query(`INSERT INTO hide_notification (user_id, notification_id) VALUES (${decrypt(req.session.user_id)}, ${req.body.notification_id})`)

    res.json({
      result: 'ok',
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.get('/discord/oauth', async (req, res) => {
  try {
    if (!req.query.code) {
      res.json({
        result: 'error',
        reason: 'Discord OAuth2 인증 코드가 제공되지 않았습니다.',
      })
      return
    }

    let resp = await oauth.tokenRequest({
      code: req.query.code,
      scope: 'identify',
      grantType: 'authorization_code',
    })

    if (!resp.access_token) {
      res.json({
        result: 'error',
        reason: '잘못된 Discord OAuth2 인증 코드입니다.',
      })
      return
    }

    const encryptedToken = encrypt(resp.access_token)

    const user = await oauth.getUser(resp.access_token)
    const encryptedId = encrypt(user.id)

    req.session.access_token = encryptedToken
    req.session.user_id = encryptedId
    req.session.save()
  }
  finally {
    res.redirect('/')
  }
})

app.post('/rider/name', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    if (!(Number(req.body.rider_id) > 0) || !(Number(req.body.rider_id) < Math.pow(2, 32) - 1)) {
      res.json({
        result: 'error',
        reason: '라이더 id가 제공되지 않았거나 잘못된 타입입니다.',
      })
      return
    }

    const result = await fetch(`https://api.nexon.co.kr/kart/v1.0/users/${req.body.rider_id}`, {
      headers: {
        Authorization: kartApiKey,
      },
    })

    const rider = await result.json()

    if (!rider.name) {
      res.json({
        result: 'error',
        reason: '라이더를 찾지 못했습니다.',
      })
      return
    }

    res.json({
      result: 'ok',
      rider_name: rider.name,
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/rider/name/update', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    if (!req.body.rider_name) {
      res.json({
        result: 'error',
        reason: '라이더명이 제공되지 않았습니다.'
      })
      return
    }
    else if (!/[A-Za-z0-9가-힣]/g.test(req.body.rider_name)) {
      res.json({
        result: 'error',
        reason: '라이더명은 영문, 한글, 숫자만 포함할 수 있습니다.',
      })
      return
    }
    else {
      let byte = 0

      for (let i = 0; i < req.body.rider_name.length; i++) {
        req.body.rider_name.charCodeAt(i) > 127 ? byte += 2 : byte++
      }

      if (byte < 4 || byte > 12) {
        res.json({
          result: 'error',
          reason: '라이더명은 영문 및 숫자 기준 4-12자, 한글 기준 2-6자여야 합니다.',
        })
        return
      }
    }

    const result = await fetch(`https://api.nexon.co.kr/kart/v1.0/users/nickname/${req.body.rider_name}`, {
      headers: {
        Authorization: kartApiKey,
      },
    })

    const rider = await result.json()

    if (!rider.accessId) {
      res.json({
        result: 'error',
        reason: '라이더를 찾지 못했습니다.',
      })
      return
    }

    await pool.query(`UPDATE user SET rider_id = ${rider.accessId} WHERE id = ${decrypt(req.session.user_id)}`)

    res.json({
      result: 'ok',
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.get('/signout', async (req, res) => {
  delete req.session.access_token
  delete req.session.user_id
  req.session.save()

  res.redirect('/')
})

app.post('/tracks', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const result = await getTrackList(req.body.channel, req.body.track_type)

    if (result.result == 'error') {
      res.json({
        result: 'error',
        reason: result.reason,
      })
      return
    }

    res.json({
      result: 'ok',
      tracks: result.trackList,
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.get('/banpick', async (req, res) => {
  res.sendFile(__dirname + '/views/banpick.html')
})

let gameEventList = []

app.get('/game/event', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  })

  res.flushHeaders()

  if (!req.session.access_token) {
    res.write(`event: error\ndata: 로그인이 필요한 기능입니다.\n\n`)
    res.end()
    return
  }

  if (!['lobby', 'banpick', 'round'].some((element) => element == req.query.path)) {
    res.write(`event: error\ndata: 비정상적인 경로입니다.\n\n`)
    res.end()
    return
  }

  try {
    const userId = decrypt(req.session.user_id)

    const gameEvent = {
      id: req.id,
      path: req.query.path,
      userId: userId,
      res: res,
    }

    gameEventList.push(gameEvent)

    await sendGameEvent([req.query.path], { eventId: req.id })

    res.on('close', () => {
      gameEventList = gameEventList.filter((gameEvent) => gameEvent.id != req.id)
      res.end()
    })
  }
  catch (error) {
    res.write(`event: server_side_error\n\n`)
    await sendError(error)
  }
})

app.post('/game/create', async (req, res) => {
  try {
    const channel = req.body.channel
    const trackType = req.body.track_type
    const banpickAmount = req.body.banpick_amount
    const userId = decrypt(req.session.user_id)

    let result = await getTrackList(channel, trackType)

    if (result.result == 'error') {
      res.json({
        result: 'error',
        reason: result.reason,
      })
      return
    }

    if (banpickAmount < 9 || banpickAmount > result.trackList.length) {
      res.json({
        result: 'error',
        reason: '밴픽 트랙 수는 9 이상이거나 전체 트랙 수 이하여야 합니다.',
      })
      return
    }

    const game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]

    if (game) {
      res.json({
        result: 'error',
        reason: '이미 대기 중이거나 진행 중인 게임이 있습니다.',
      })
      return
    }

    let gameId
    result = { affectedRows: 0 }

    while (!result.affectedRows) {
      gameId = Crypto.randomUUID().slice(0, 6)
      result = (await pool.query(`INSERT IGNORE INTO game (id, host_id, host_rider_id, opened_at, channel, track_type, banpick_amount) VALUES ('${gameId}', '${userId}', (SELECT rider_id FROM user WHERE id = '${userId}'), UNIX_TIMESTAMP(), '${channel}', '${trackType}', ${banpickAmount})`))[0]
    }

    await sendGameEvent(['lobby'], { userId: userId })

    res.json({
      result: 'ok',
      game_id: gameId,
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/game/join', async (req, res) => {
  try {
    const gameId = req.body.game_id
    const userId = decrypt(req.session.user_id)

    let game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]

    if (game) {
      res.json({
        result: 'error',
        reason: '이미 대기 중이거나 진행 중인 게임이 있습니다.',
      })
      return
    }

    game = (await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`))[0][0]

    if (!game) {
      res.json({
        result: 'error',
        reason: '게임을 찾지 못했습니다.',
      })
      return
    }
    else if (game.banpick_started_at) {
      res.json({
        result: 'error',
        reason: '만료된 초대 코드입니다.',
      })
      return
    }

    const user = (await pool.query(`SELECT * FROM user WHERE id = ${userId}`))[0][0]
    const riderId = user.rider_id

    if (game.host_rider_id == riderId) {
      res.json({
        result: 'error',
        reason: '호스트와 라이더명이 같습니다. <br> 라이더명을 변경해주세요.',
      })
      return
    }

    const result = await getTrackList(game.channel, game.track_type, game.banpick_amount)

    if (result.result == 'error') {
      res.json({
        result: 'error',
        reason: result.reason,
      })
      return
    }

    const valueList = [`('${game.id}', '${result.trackList.pop().id}', 1, true, 1, UNIX_TIMESTAMP())`]

    for (const track of result.trackList) {
      valueList.push(`('${game.id}', '${track.id}', NULL, false, NULL, NULL)`)
    }

    await pool.query(`INSERT INTO banpick (game_id, track_id, \`order\`, picked, round, banpicked_at) VALUES ${valueList.join(',')}`)

    req.session.player_id = req.session.user_id
    req.session.save()

    await pool.query(`UPDATE game SET opponent_id = ${userId}, opponent_rider_id = ${riderId}, banpick_started_at = UNIX_TIMESTAMP() WHERE id = '${gameId}'`)

    game = (await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`))[0][0]

    await setBanpickTimer(game.id, 2)
    await sendGameEvent(['lobby'], { gameId: gameId })

    res.json({
      result: 'ok',
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/game/close', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const userId = decrypt(req.session.user_id)
    const result = (await pool.query(`DELETE FROM game WHERE '${userId}' IN (host_id, opponent_id) AND banpick_started_at IS NULL`))[0]

    if (!result.affectedRows) {
      res.json({
        result: 'error',
        reason: '대기 중인 게임이 없거나 이미 시작 되었습니다.',
      })
      return
    }

    await sendGameEvent(['lobby'], { userId: userId, isThereGame: false })

    res.json({
      result: 'ok',
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/game/quit', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const userId = decrypt(req.session.user_id)
    const game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]

    if (!game) {
      res.json({
        result: 'error',
        reason: '진행 중인 게임이 없습니다.',
      })
      return
    }

    for (const banpickTimer of banpickTimerList.filter((banpickTimer) => banpickTimer.gameId == game.id)) {
      clearTimeout(banpickTimer.id)
    }

    banpickTimerList = banpickTimerList.filter((banpickTimer) => banpickTimer.gameId != game.id)

    for (const roundTimer of roundTimerList.filter((roundTimer) => roundTimer.gameId == game.id)) {
      clearTimeout(roundTimer.id)
    }

    await pool.query(`UPDATE game SET quit_user_id = ${userId} WHERE id = '${game.id}'`)
    await setRoundTimer(game.id, 8)

    res.json({
      result: 'ok',
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.get('/images/tracks/:track', async (req, res) => {
  res.sendFile(`${__dirname}/images/tracks/${req.params.track}.png`)
})

app.post('/banpick', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const userId = decrypt(req.session.user_id)
    const trackId = req.body.track_id

    const game = (await pool.query(`SELECT * FROM game WHERE'${decrypt(req.session.user_id)}' in (host_id, opponent_id) AND banpick_started_at IS NOT NULL AND round_started_at IS NULL AND closed_at IS NULL`))[0][0]

    if (!game) {
      res.json({
        result: 'error',
        reason: '진행 중인 밴픽이 없습니다.',
      })
      return
    }

    const banpickList = (await pool.query(`SELECT * FROM banpick WHERE game_id = '${game.id}' ORDER BY \`order\` DESC`))[0]

    if (!banpickList[0]) {
      res.json({
        result: 'error',
        reason: '진행 중인 밴픽이 없습니다.',
      })
      return
    }

    const order = banpickList[0].order + 1
    const turn = getBanpickTurn(order)

    if ((turn.host && userId != game.host_id) || (!turn.host && userId != game.opponent_id)) {
      res.json({
        result: 'error',
        reason: '현재 차례가 아닙니다.',
      })
      return
    }

    let banpick = banpickList.find((banpick) => banpick.track_id == trackId && !banpick.order)

    if (!banpick) {
      res.json({
        result: 'error',
        reason: '밴픽 트랙이 아니거나 이미 선정된 트랙입니다.',
      })
      return
    }

    await pool.query(`UPDATE banpick SET \`order\` = ${order}, picked = ${turn.pick}, banned = ${!turn.pick}, round = ${turn.round}, user_id = ${userId}, banpicked_at = UNIX_TIMESTAMP() WHERE game_id = '${game.id}' AND track_id = '${trackId}'`)

    for (const banpickTimer of banpickTimerList.filter((banpickTimer) => banpickTimer.gameId == game.id)) {
      clearTimeout(banpickTimer.id)
    }

    await setBanpickTimer(game.id, order + 1)

    res.json({
      result: 'ok'
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.post('/banpick/random', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const userId = decrypt(req.session.user_id)
    const game = (await pool.query(`SELECT * FROM game WHERE'${decrypt(req.session.user_id)}' in (host_id, opponent_id) AND banpick_started_at IS NOT NULL AND round_started_at IS NULL AND closed_at IS NULL`))[0][0]

    if (!game) {
      res.json({
        result: 'error',
        reason: '진행 중인 밴픽이 없습니다.',
      })
      return
    }

    const banpickList = (await pool.query(`SELECT * FROM banpick WHERE game_id = '${game.id}' ORDER BY \`order\` DESC`))[0]

    if (!banpickList[0]) {
      res.json({
        result: 'error',
        reason: '진행 중인 밴픽이 없습니다.',
      })
      return
    }

    const order = banpickList[0].order + 1
    const turn = getBanpickTurn(order)

    if ((turn.host && userId != game.host_id) || (!turn.host && userId != game.opponent_id)) {
      res.json({
        result: 'error',
        reason: '현재 차례가 아닙니다.',
      })
      return
    }

    await pool.query(`UPDATE banpick SET \`order\` = ${order}, picked = ${turn.pick}, banned = ${!turn.pick}, round = ${turn.round}, banpicked_at = UNIX_TIMESTAMP() WHERE game_id = '${game.id}' AND track_id = (SELECT track_id FROM (SELECT track_id FROM banpick WHERE game_id = '${game.id}' AND \`order\` IS NULL ORDER BY RAND() LIMIT 1) random_track)`)

    for (const banpickTimer of banpickTimerList.filter((banpickTimer) => banpickTimer.gameId == game.id)) {
      clearTimeout(banpickTimer.id)
    }

    await setBanpickTimer(game.id, order + 1)

    res.json({
      result: 'ok'
    })
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

app.get('/round', async (req, res) => {
  res.sendFile(__dirname + '/views/round.html')
})

app.post('/round/skip', async (req, res) => {
  try {
    if (!req.session.access_token) {
      res.json({
        result: 'error',
        reason: '로그인이 필요한 기능입니다.',
      })
      return
    }

    const userId = decrypt(req.session.user_id)
    const round = (await pool.query(`SELECT r.*, g.host_id, g.opponent_id FROM round AS r INNER JOIN game AS g WHERE r.game_id = g.id AND '${userId}' IN (g.host_id, g.opponent_id) AND g.round_started_at IS NOT NULL AND g.closed_at IS NULL ORDER BY number DESC LIMIT 1`))[0][0]

    if (!round) {
      res.json({
        result: 'error',
        reason: '진행 중인 라운드가 없습니다.',
      })
      return
    }

    let ready

    if (round.host_id == userId) {
      ready = 'host_skipped'
    }
    else {
      ready = 'opponent_skipped'
    }

    if (round[ready]) {
      res.json({
        result: 'error',
        reason: '이미 라운드 스킵을 요청 하셨습니다.',
      })
      return
    }

    await pool.query(`UPDATE round SET ${ready} = true WHERE game_id = '${round.game_id}' AND number = ${round.number}`)

    if (round.host_skipped || round.opponent_skipped) {
      await pool.query(`UPDATE round SET host_record = '9999.999', opponent_record = '9999.999', finished_at = UNIX_TIMESTAMP() WHERE game_id = '${round.game_id}' AND number = ${round.number}`)

      for (const roundTimer of roundTimerList.filter((roundTimer) => roundTimer.gameId == round.game_id)) {
        clearTimeout(roundTimer.id)
      }

      await setRoundTimer(round.game_id, round.number + 1)

      res.json({
        result: 'ok',
      })
    }
    else {
      await sendGameEvent(['round'], { gameId: round.game_id })

      res.json({
        result: 'waiting for the other',
      })
    }
  }
  catch (error) {
    res.json({
      result: 'server_side_error',
    })

    await sendError(error)
  }
})

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
  ],
})

client.login(args[7])

process.on('uncaughtException', async (error) => {
  await sendError(error)
})

async function sendError(error) {
  try {
    const user = await client.users.fetch('357527814603407371', false)
    await user.send(`\`\`\`#${error.stack}\`\`\``)
  }
  catch { }
}

function encrypt(str) {
  return Crypto.publicEncrypt(key, Buffer.from(str)).toString('base64')
}

function decrypt(str) {
  return Crypto.privateDecrypt(key, Buffer.from(str, 'base64')).toString()
}

async function sendGameEvent(path, args = { eventId: null, userId: null, gameId: null, isThereGame: true }) {
  if (!args.hasOwnProperty('isThereGame')) {
    args.isThereGame = true
  }

  let game
  let gameEvent
  let event

  const data = {}

  try {

    if (args.userId && args.isThereGame) {
      game = (await pool.query(`SELECT * FROM game WHERE '${args.userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]
    }
    else if (args.gameId) {
      game = (await pool.query(`SELECT * FROM game WHERE id = '${args.gameId}'`))[0][0]
    }
    else if (args.eventId) {
      gameEvent = gameEventList.find((gameEvent) => gameEvent.id == args.eventId)
      game = (await pool.query(`SELECT * FROM game WHERE '${gameEvent.userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]
    }
    else if (args.isThereGame) {
      throw new Error(`잘못된 args 조합입니다.`)
    }

    if (game) {
      data.game = game

      if (game.banpick_started_at) {
        data.banpick = (await pool.query(`SELECT b.*, t.name AS track_name FROM banpick AS b INNER JOIN track AS t WHERE b.track_id = t.id AND game_id = '${game.id}'`))[0]
      }

      if (game.round_started_at) {
        data.round = (await pool.query(`SELECT r.*, b.track_id, t.name AS track_name FROM round AS r INNER JOIN banpick AS b INNER JOIN track as t WHERE r.game_id = b.game_id AND r.number = b.round AND b.track_id = t.id AND r.game_id='${game.id}'`))[0]
      }
    }

    event = 'game_update'
  }
  catch (error) {
    dataString = 'server_side_error'
    sendError(error)
  }

  if (gameEvent) {
    data.user_id = gameEvent.userId
    gameEvent.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  else {
    let tempGameEventList

    if (args.isThereGame) {
      tempGameEventList = gameEventList.filter((gameEvent) => path.some((element) => element == gameEvent.path) && (gameEvent.userId == game.host_id || gameEvent.userId == game.opponent_id))
    }
    else {
      tempGameEventList = gameEventList.filter((gameEvent) => path.some((element) => element == gameEvent.path) && (gameEvent.userId == args.userId))
    }

    for (const gameEvent of tempGameEventList) {
      data.user_id = gameEvent.userId
      gameEvent.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  }
}

async function getTrackList(channel, trackType, amount = NaN) {
  if (!channel || !trackType) {
    return ({
      result: 'error',
      reason: '채널이나 트랙 타입이 제공되지 않았습니다.',
    })
  }

  let mode

  if (channel.includes('speed')) {
    mode = 'speed'
  }
  else if (channel.includes('item')) {
    mode = 'item'
  }
  else {
    return ({
      result: 'error',
      reason: '채널이 알맞지 않습니다.',
    })
  }

  if (!['very_easy', 'easy', 'normal', 'hard', 'very_hard', 'all', 'league', 'new', 'reverse', 'crazy'].some((element) => trackType == element)) {
    return ({
      result: 'error',
      reason: '트랙 타입이 알맞지 않습니다.',
    })
  }

  const conditionList = []

  if (mode == 'speed') {
    if (trackType == 'crazy') {
      return ({
        result: 'error',
        reason: '스피드전에서 크레이지 트랙을 사용할 수 없습니다.',
      })
    }

    conditionList.push('crazy = false')
  }
  else {
    conditionList.push('item = true')
  }

  if (['all', 'reverse', 'crazy'].some((element) => trackType == element) == 0) {
    conditionList.push(`${mode}_${trackType} = true`)
  }
  else if (trackType != 'all') {
    conditionList.push(`${trackType} = true`)
  }

  let query = `SELECT * FROM track WHERE ${conditionList.join(' AND ')}`

  if (amount) {
    query += ` ORDER BY RAND() LIMIT ${amount}`
  }

  const trackList = (await pool.query(query))[0]

  return ({
    result: 'ok',
    trackList: trackList,
  })
}

function getBanpickTurn(order) {
  let pick
  let host
  let round = 'NULL'

  switch (order) {
    case 5:
    case 7:
    case 9:
      pick = true
      host = true
      break

    case 2:
    case 6:
    case 8:
      pick = true
      host = false
      break

    case 3:
      pick = false
      host = true
      break

    case 4:
      pick = false
      host = false
      break
  }

  if (pick) {
    round = order

    if (order > 2) {
      round -= 2
    }
  }

  return {
    pick: pick,
    host: host,
    round: round,
  }
}

let banpickTimerList = []

async function setBanpickTimer(gameId, order) {
  banpickTimerList = banpickTimerList.filter((banpickTimer) => banpickTimer.gameId != gameId)

  if (order > 9) {
    await pool.query(`UPDATE game SET round_started_at = UNIX_TIMESTAMP() WHERE id = '${gameId}'`)
    await setRoundTimer(gameId, 1)
    await sendGameEvent(['lobby', 'banpick'], { gameId: gameId })

    return
  }

  await sendGameEvent(['banpick'], { gameId: gameId })

  const turn = getBanpickTurn(order)

  const timerId = setTimeout(async () => {
    await pool.query(`UPDATE banpick SET \`order\` = ${order}, picked = ${turn.pick}, banned = ${!turn.pick}, round = ${turn.round}, banpicked_at = UNIX_TIMESTAMP() WHERE game_id = '${gameId}' AND track_id = (SELECT track_id FROM (SELECT track_id FROM banpick WHERE game_id = '${gameId}' AND \`order\` IS NULL ORDER BY RAND() LIMIT 1) random_track)`)
    await setBanpickTimer(gameId, order + 1)
  }, 1000 * 60)

  banpickTimerList.push({
    id: timerId,
    gameId: gameId,
  })
}

let roundTimerList = []

async function setRoundTimer(gameId, roundNumber) {
  roundTimerList = roundTimerList.filter((roundTimer) => roundTimer.gameId != gameId)

  const result = (await pool.query(`SELECT GREATEST(SUM(CASE WHEN host_record > opponent_record THEN 1 ELSE 0 END), SUM(CASE WHEN host_record < opponent_record THEN 1 ELSE 0 END)) AS max_score FROM round WHERE game_id = '${gameId}'`))[0][0]

  if (roundNumber > 7 || result.max_score >= 4) {
    await pool.query(`UPDATE game SET closed_at = UNIX_TIMESTAMP() WHERE id = '${gameId}'`)

    await sendGameEvent(['lobby', 'banpick', 'round'], { gameId: gameId })

    await pool.query(`DELETE FROM banpick WHERE game_id = '${gameId}' AND picked = false AND banned = false`)
    await pool.query(`DELETE FROM round WHERE game_id = '${gameId}' AND host_record IS NULL AND opponent_record IS NULL`)

    return
  }

  await pool.query(`INSERT INTO round (game_id, number) VALUES ('${gameId}', ${roundNumber})`)
  await sendGameEvent(['round'], { gameId: gameId })

  let timerId = setTimeout(async () => {
    if (roundTimerList.find((roundTimer) => roundTimer.gameId == gameId && roundTimer.number == roundNumber)) {
      const round = (await pool.query(`SELECT r.game_id, r.number, g.host_id, g.opponent_id, g.host_rider_id, g.opponent_rider_id, g.round_started_at, g.channel, b.track_id FROM round AS r INNER JOIN game as g INNER JOIN banpick AS b WHERE r.game_id = g.id AND r.game_id = b.game_id AND r.number = b.round AND r.game_id = '${gameId}' AND r.number = ${roundNumber}`))[0][0]
      await getMatch(round, true)

      setTimeout(async () => {
        const roundTimerIndex = roundTimerList.findIndex((roundTimer) => roundTimer.gameId == gameId && roundTimer.number == roundNumber)

        if (roundTimerIndex >= 0) {
          roundTimerList[roundTimerIndex].getMatch = false

          setTimeout(async () => {
            await pool.query(`UPDATE round SET host_record = '9999.999', opponent_record = '9999.999', finished_at = UNIX_TIMESTAMP() WHERE game_id = '${gameId}' AND number = ${roundNumber}`)
            await setRoundTimer(gameId, roundNumber + 1)
          }, 1000 * 3)
        }
      }, 1000 * (60 * 7 - 50 - 3))
    }
  }, 1000 * 50)

  roundTimerList.push({
    id: timerId,
    gameId: gameId,
    number: roundNumber,
    getMatch: true,
  })
}

async function getMatch(round, getHostMatch) {
  const startTime = new Date().getTime()

  try {
    let riderId
    let hostRecord
    let opponentRecord

    if (getHostMatch) {
      riderId = round.host_rider_id
    }
    else {
      riderId = round.opponent_rider_id
    }

    const startDate = new Date(round.round_started_at * 1000)

    let res = await fetch(`https://api.nexon.co.kr/kart/v1.0/users/${riderId}/matches?start_date=${startDate.getUTCFullYear()}-${startDate.getUTCMonth()}-${startDate.getUTCDay()} ${startDate.getUTCHours()}:${startDate.getUTCMinutes()}:${startDate.getUTCSeconds()}&limit=1`, {
      headers: {
        Authorization: kartApiKey,
      },
    })

    let result = await res.json()
    const match = result.matches[0].matches[0]

    if (!match.channelName.includes(round.channel) || (!round.channel.includes('Infinit') && match.channelName.includes('Infinit')) || match.trackId != round.track_id) {
      throw new Error()
    }

    res = await fetch(`https://api.nexon.co.kr/kart/v1.0/matches/${match.matchId}`, {
      headers: {
        Authorization: kartApiKey,
      },
    })

    result = await res.json()

    let hostRider
    let opponentRider

    if (round.channel.includes('Indi')) {
      hostRider = result.players.find((player) => player.accountNo == round.host_rider_id)
      opponentRider = result.players.find((player) => player.accountNo == round.opponent_rider_id)
    }
    else {
      hostRider = result.teams.find((team) => team.players.find((player) => player.accountNo == round.host_rider_id)).players.find((player) => player.accountNo == round.host_rider_id)
      opponentRider = result.teams.find((team) => team.players.find((player) => player.accountNo == round.opponent_rider_id)).players.find((player) => player.accountNo == round.opponent_rider_id)
    }

    if (Number(hostRider.matchRetired)) {
      hostRecord = 9999.999
    }
    else {
      hostRecord = Number(hostRider.matchTime) / 1000
    }

    if (Number(opponentRider.matchRetired)) {
      opponentRecord = 9999.999
    }
    else {
      opponentRecord = Number(opponentRider.matchTime) / 1000
    }

    if (hostRecord && opponentRecord) {
      await pool.query(`UPDATE round SET host_record = ${hostRecord}, opponent_record = ${opponentRecord}, finished_at = UNIX_TIMESTAMP() WHERE game_id = '${round.game_id}' AND number = ${round.number}`)

      const roundTimer = roundTimerList.find((roundTimer) => roundTimer.gameId == round.game_id && roundTimer.getMatch && roundTimer.number == round.number)

      if (roundTimer) {
        clearTimeout(roundTimer.id)
        await setRoundTimer(round.game_id, round.number + 1)

        return
      }
    }
  }
  catch { }

  const roundTimer = roundTimerList.find((roundTimer) => roundTimer.gameId == round.game_id && roundTimer.getMatch && roundTimer.number == round.number)
  const endTime = new Date().getTime()

  if (roundTimer) {
    setTimeout(async () => {
      await getMatch(round, !getHostMatch)
    }, endTime - startTime >= 1000 ? 0 : 1000 - (endTime - startTime))
  }
}