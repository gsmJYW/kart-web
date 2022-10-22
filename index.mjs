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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const args = process.argv.slice(2)

if (args.length < 6) {
  console.error('Parameters not provided: [mysql_host] [mysql_user] [mysql_password] [mysql_database] [session_secret] [discord_oauth_client_secret] [discord_oauth_redirect_uri] [kart_api_key]')
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

const kartApiKey = args[7]

app.use((req, res, next) => {
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
    const user = await oauth.getUser(accessToken)

    const result = await pool.query(`SELECT * FROM user WHERE id = ${user.id}`)

    if (result[0][0]) {
      await pool.query(`UPDATE user SET name = '${user.username}', avatar = '${user.avatar}'`)
      res.sendFile(__dirname + '/views/lobby.html')
    }
    else {
      res.sendFile(__dirname + '/views/signup.html')
    }
  }
  catch (error) {
    res.sendFile(__dirname + '/views/signin.html')
  }
})

app.post('/timestamp', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    res.json({
      result: 'OK',
      timestamp: Math.floor(new Date().getTime() / 1000),
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.post('/signup', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const result = await fetch(`https://api.nexon.co.kr/kart/v1.0/users/nickname/${req.body.rider_name}`, {
      headers: {
        Authorization: kartApiKey,
      },
    })

    const rider = await result.json()

    if (!rider.accessId) {
      throw new Error('라이더를 찾지 못했습니다.')
    }

    const accessToken = decrypt(req.session.access_token)
    const user = await oauth.getUser(accessToken)

    await pool.query(`INSERT INTO user (id, name, avatar, rider_id) VALUES (${user.id}, '${user.username}', '${user.avatar}', '${rider.accessId}')`)

    res.json({
      result: 'OK',
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.get('/user', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const result = await pool.query(`SELECT * FROM user WHERE id = ${decrypt(req.session.user_id)}`)

    res.json({
      result: 'OK',
      user: result[0][0],
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.get('/discord/oauth', async (req, res) => {
  try {
    const code = req.query.code

    if (!code) {
      throw new Error('authorization code not provided')
    }

    let resp = await oauth.tokenRequest({
      code: code,
      scope: 'identify',
      grantType: 'authorization_code',
    })

    if (!resp.access_token) {
      throw new Error('invalid authorization code')
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
      throw new Error('not authorized')
    }

    const result = await fetch(`https://api.nexon.co.kr/kart/v1.0/users/${req.body.rider_id}`, {
      headers: {
        Authorization: kartApiKey,
      },
    })

    const rider = await result.json()

    if (!rider.name) {
      throw new Error('라이더를 찾지 못했습니다.')
    }

    res.json({
      result: 'OK',
      rider_name: rider.name,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
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
      throw new Error('not authorized')
    }

    const trackList = await getTrackList(req.body.mode, req.body.track_type)

    res.json({
      result: 'OK',
      tracks: trackList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.get('/banpick', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    const result = await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND banpick_started_at IS NOT NULL AND closed_at IS NULL`)

    if (!result[0][0]) {
      throw new Error()
    }

    res.sendFile(__dirname + '/views/banpick.html')
  }
  catch (error) {
    res.redirect('/')
  }
})

let gameEventList = []

app.get('/game/event', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    const result = await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`)
    const game = result[0][0]

    const gameEvent = {
      id: req.id,
      userId: userId,
      res: res,
    }

    if (game) {
      gameEvent.gameId = game.id

      if (game.opponent_id) {
        const result = await pool.query(`SELECT b.track_name, b.order, b.picked, b.banned, b.user_id, b.banpicked_at FROM banpick as b INNER JOIN game as g WHERE b.game_id = g.id AND b.game_id='${game.id}'`)
        game.banpick = result[0]
      }
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })

    res.flushHeaders()

    if (game) {
      res.write(`event: game_update\ndata: ${JSON.stringify(game)}\n\n`)
    }

    gameEventList.push(gameEvent)

    res.on('close', () => {
      gameEventList = gameEventList.filter((gameEvent) => gameEvent.id != req.id)
      res.end()
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.post('/game/create', async (req, res) => {
  try {
    const mode = req.body.mode
    const trackType = req.body.track_type
    const banpickAmount = req.body.banpick_amount
    const userId = decrypt(req.session.user_id)

    const trackList = await getTrackList(mode, trackType)

    if (banpickAmount < 9 || banpickAmount > trackList.length) {
      throw new Error(`banpick amount can't be less than 9 or more than track amount`)
    }

    let result = await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`)

    if (result[0][0]) {
      throw new Error('이미 진행 중이신 게임이 있습니다.')
    }

    result[0].affectedRows = 0
    let gameId

    while (result[0].affectedRows == 0) {
      gameId = Crypto.randomUUID().slice(0, 6)
      result = await pool.query(`INSERT IGNORE INTO game (id, host_id, host_rider_id, opened_at, mode, track_type, banpick_amount) VALUES ('${gameId}', '${userId}', (SELECT rider_id FROM user WHERE id = '${userId}'), UNIX_TIMESTAMP(NOW()), '${mode}', '${trackType}', ${banpickAmount})`)
    }

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == userId)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        id: gameId,
        mode: mode,
        track_type: trackType,
        banpick_amount: banpickAmount,
      })}\n\n`)
    }

    res.json({
      result: 'OK',
      game_id: gameId,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

let banpickTimerList = []

app.post('/game/join', async (req, res) => {
  try {
    const gameId = req.body.game_id
    const userId = decrypt(req.session.user_id)

    let result = await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`)

    if (result[0][0]) {
      throw new Error('이미 진행 중이신 게임이 있습니다.')
    }

    result = await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`)
    const game = result[0][0]

    if (!game) {
      throw new Error('존재하지 않는 초대 코드입니다.')
    }
    else if (game.opponent_id || game.closed_at) {
      throw new Error('만료된 초대 코드입니다.')
    }

    result = await pool.query(`SELECT * FROM user WHERE id = ${userId}`)
    const riderId = result[0][0].rider_id

    if (game.host_rider_id == riderId) {
      throw new Error('호스트와 라이더명이 같습니다. <br> 라이더명을 변경해주세요.')
    }

    const trackList = await getTrackList(game.mode, game.track_type, game.banpick_amount)
    const valueList = [`('${game.id}', '${trackList.pop().name}', 1, true, 1, UNIX_TIMESTAMP(NOW()))`]

    for (const track of trackList) {
      valueList.push(`('${game.id}', '${track.name}', NULL, false, NULL, NULL)`)
    }

    await pool.query(`INSERT INTO banpick (game_id, track_name, \`order\`, picked, round, banpicked_at) VALUES ${valueList.join(',')}`)

    req.session.player_id = req.session.user_id
    req.session.save()

    await pool.query(`UPDATE game SET opponent_id = ${userId}, opponent_rider_id = ${riderId}, banpick_started_at = UNIX_TIMESTAMP(NOW()) WHERE id = '${gameId}'`)

    setRandomBanpickTimer(game, 2)

    game.opponent_id = userId

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == userId)) {
      game.opponent_rider_id = riderId
      gameEvent.gameId = game.id
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify(game)}\n\n`)
    }

    res.json({
      result: 'OK',
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.post('/game/close', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    await pool.query(`DELETE FROM game WHERE '${userId}' IN (host_id, opponent_id) AND opponent_id IS NULL`)

    res.json({
      result: 'OK',
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.get('/images/tracks/:track', async (req, res) => {
  res.sendFile(`${__dirname}/images/tracks/${req.params.track}.png`)
})

app.post('/banpick', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    const trackName = req.body.track_name

    let result = await pool.query(`SELECT * FROM game WHERE'${decrypt(req.session.user_id)}' in (host_id, opponent_id) AND banpick_started_at IS NOT NULL AND game_started_at IS NULL AND closed_at IS NULL`)
    const game = result[0][0]

    if (!game) {
      throw new Error('진행 중인 밴픽이 없습니다.')
    }

    result = await pool.query(`SELECT b.game_id, g.host_id, g.opponent_id, b.track_name, b.order, b.picked, b.banned, b.banpicked_at FROM banpick as b INNER JOIN game as g WHERE b.game_id = g.id AND b.game_id = '${game.id}' ORDER BY b.order DESC`)
    const banpickList = result[0]

    if (!banpickList[0]) {
      throw new Error('진행 중인 밴픽이 없습니다.')
    }

    const order = banpickList[0].order + 1
    const turn = getBanpickTurn(order)

    if ((turn.host && userId != banpickList[0].host_id) || (!turn.host && userId != banpickList[0].opponent_id)) {
      throw new Error('현재 차례가 아닙니다.')
    }

    const banpick = banpickList.find((banpick) => banpick.track_name == trackName && !banpick.order)

    if (!banpick) {
      throw new Error('밴픽 트랙이 아니거나 이미 선택된 트랙입니다.')
    }

    await pool.query(`UPDATE banpick SET \`order\` = ${order}, picked = ${turn.pick}, banned = ${!turn.pick}, round = ${turn.round}, user_id = ${userId}, banpicked_at = UNIX_TIMESTAMP(NOW()) WHERE game_id = '${game.id}' AND track_name = '${trackName}'`)

    for (const banpickTimerIndex in banpickTimerList) {
      if (banpickTimerList[banpickTimerIndex].gameId == game.id) {
        clearTimeout(banpickTimerList[banpickTimerIndex].id)
      }
      else {
        banpickTimerList.splice(banpickTimerIndex, 1)
      }
    }

    if (order < 9) {
      setRandomBanpickTimer(game, order + 1)
    }
    else {
      startGame(game.id)
    }

    result = await pool.query(`SELECT b.track_name, b.order, b.picked, b.banned, b.user_id, b.banpicked_at FROM banpick as b INNER JOIN game as g WHERE b.game_id = g.id AND b.game_id='${game.id}'`)
    game.banpick = result[0]

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.gameId == game.id)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify(game)}\n\n`)
    }

    res.json({
      result: 'OK'
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

function encrypt(str) {
  return Crypto.publicEncrypt(key, Buffer.from(str)).toString('base64')
}

function decrypt(str) {
  return Crypto.privateDecrypt(key, Buffer.from(str, 'base64')).toString()
}

function getTrackList(mode, trackType, amount = NaN) {
  return new Promise(async (resolve, reject) => {
    if (!mode || !trackType) {
      reject(new Error('parameters required'))
    }

    if (!['speed', 'item'].some((element) => mode == element)) {
      reject(new Error('invalid mode'))
    }

    if (!['very_easy', 'easy', 'normal', 'hard', 'very_hard', 'all', 'league', 'new', 'reverse', 'crazy'].some((element) => trackType == element)) {
      reject(new Error('invalid trackType'))
    }

    const conditionList = []

    if (mode == 'speed') {
      if (trackType == 'crazy') {
        reject(new Error('speed mode is not available on crazy random'))
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

    try {
      let query = `SELECT * FROM track WHERE ${conditionList.join(' AND ')}`

      if (amount) {
        query += ` ORDER BY RAND() LIMIT ${amount}`
      }

      const result = await pool.query(query)
      resolve(result[0])
    }
    catch (error) {
      reject(new Error(error))
    }
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

async function setRandomBanpickTimer(game, order) {
  const turn = getBanpickTurn(order)

  const timerId = setTimeout(async () => {
    banpickTimerList = banpickTimerList.filter((banpickTimer) => banpickTimer.gameId != game.id)
    await pool.query(`UPDATE banpick SET \`order\` = ${order}, picked = ${turn.pick}, banned = ${!turn.pick}, round = ${turn.round}, banpicked_at = UNIX_TIMESTAMP(NOW()) WHERE game_id = '${game.id}' AND track_name = (SELECT track_name FROM (SELECT track_name FROM banpick WHERE game_id = '${game.id}' AND \`order\` IS NULL ORDER BY RAND() LIMIT 1) random_track)`)

    if (order < 9) {
      setRandomBanpickTimer(game, order + 1)
    }
    else {
      startGame(game.id)
    }

    const result = await pool.query(`SELECT b.game_id, g.host_id, g.opponent_id, b.track_name, b.order, b.picked, b.banned, b.banpicked_at FROM banpick as b INNER JOIN game as g WHERE b.game_id = g.id AND b.game_id = '${game.id}'`)
    game.banpick = result[0]

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.gameId == game.id)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify(game)}\n\n`)
    }
  }, 1000 * 60)

  banpickTimerList.push({
    id: timerId,
    gameId: game.id,
  })
}

async function startGame(id) {
  // 임시 코드 (밴픽 끝나면 게임 종료)
  await pool.query(`UPDATE game SET closed_at = UNIX_TIMESTAMP(NOW()) WHERE id = '${id}'`)
}