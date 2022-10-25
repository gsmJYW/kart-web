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

    await pool.query(`INSERT INTO user (id, name, discriminator, avatar, rider_id) VALUES (${user.id}, '${user.username}', ${user.discriminator}, ${user.avatar ? `'${user.avatar}'` : 'NULL'}, '${rider.accessId}')`)

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

    const user = (await pool.query(`SELECT * FROM user WHERE id = ${decrypt(req.session.user_id)}`))[0][0]

    res.json({
      result: 'OK',
      user: user,
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

    const trackList = await getTrackList(req.body.match_type, req.body.track_type)

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
    const game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND banpick_started_at IS NOT NULL AND closed_at IS NULL`))[0][0]

    if (!game) {
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
    const game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]

    const gameEvent = {
      id: req.id,
      userId: userId,
      res: res,
    }

    const data = {}

    if (game) {
      data.game = game
      data.user_id = userId

      if (game.banpick_started_at) {
        data.banpick = (await pool.query(`SELECT b.*, t.name AS track_name FROM banpick AS b INNER JOIN track AS t WHERE b.track_id = t.id AND game_id='${game.id}'`))[0]
      }

      if (game.round_started_at) {
        data.round = (await pool.query(`SELECT r.*, b.track_id, t.name AS track_name FROM round AS r INNER JOIN banpick AS b INNER JOIN track AS t WHERE r.game_id = b.game_id AND b.track_id = t.id AND r.number = b.round AND r.game_id='${game.id}'`))[0]
      }
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })

    res.flushHeaders()

    if (game) {
      res.write(`event: game_update\ndata: ${JSON.stringify(data)}\n\n`)
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
    const matchType = req.body.match_type
    const trackType = req.body.track_type
    const banpickAmount = req.body.banpick_amount
    const userId = decrypt(req.session.user_id)

    const trackList = await getTrackList(matchType, trackType)

    if (banpickAmount < 9 || banpickAmount > trackList.length) {
      throw new Error(`banpick amount can't be less than 9 or more than track amount`)
    }

    const game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]

    if (game) {
      throw new Error('이미 진행 중이신 게임이 있습니다.')
    }

    let gameId
    let result = { affectedRows: 0 }

    while (!result.affectedRows) {
      gameId = Crypto.randomUUID().slice(0, 6)
      result = (await pool.query(`INSERT IGNORE INTO game (id, host_id, host_rider_id, opened_at, match_type, track_type, banpick_amount) VALUES ('${gameId}', '${userId}', (SELECT rider_id FROM user WHERE id = '${userId}'), UNIX_TIMESTAMP(NOW()), '${matchType}', '${trackType}', ${banpickAmount})`))[0]
    }

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == userId)) {
      const game = (await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`))[0][0]

      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        user_id: gameEvent.userId,
        game: game,
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

app.post('/game/join', async (req, res) => {
  try {
    const gameId = req.body.game_id
    const userId = decrypt(req.session.user_id)

    let game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`))[0][0]

    if (game) {
      throw new Error('이미 진행 중이신 게임이 있습니다.')
    }

    game = (await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`))[0][0]

    if (!game) {
      throw new Error('존재하지 않는 초대 코드입니다.')
    }
    else if (game.opponent_id || game.closed_at) {
      throw new Error('만료된 초대 코드입니다.')
    }

    const user = (await pool.query(`SELECT * FROM user WHERE id = ${userId}`))[0][0]
    const riderId = user.rider_id

    if (game.host_rider_id == riderId) {
      throw new Error('호스트와 라이더명이 같습니다. <br> 라이더명을 변경해주세요.')
    }

    const trackList = await getTrackList(game.match_type, game.track_type, game.banpick_amount)
    const valueList = [`('${game.id}', '${trackList.pop().id}', 1, true, 1, UNIX_TIMESTAMP(NOW()))`]

    for (const track of trackList) {
      valueList.push(`('${game.id}', '${track.id}', NULL, false, NULL, NULL)`)
    }

    await pool.query(`INSERT INTO banpick (game_id, track_id, \`order\`, picked, round, banpicked_at) VALUES ${valueList.join(',')}`)

    req.session.player_id = req.session.user_id
    req.session.save()

    await pool.query(`UPDATE game SET opponent_id = ${userId}, opponent_rider_id = ${riderId}, banpick_started_at = UNIX_TIMESTAMP(NOW()) WHERE id = '${gameId}'`)

    game = (await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`))[0][0]
    setRandomBanpickTimer(game, 2)

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == userId)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        user_id: gameEvent.userId,
        game: game,
      })}\n\n`)
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

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == userId)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        user_id: gameEvent.userId,
      })}\n\n`)
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

app.get('/images/tracks/:track', async (req, res) => {
  res.sendFile(`${__dirname}/images/tracks/${req.params.track}.png`)
})

app.post('/banpick', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    const trackId = req.body.track_id

    const game = (await pool.query(`SELECT * FROM game WHERE'${decrypt(req.session.user_id)}' in (host_id, opponent_id) AND banpick_started_at IS NOT NULL AND round_started_at IS NULL AND closed_at IS NULL`))[0][0]

    if (!game) {
      throw new Error('진행 중인 밴픽이 없습니다.')
    }

    const banpickList = (await pool.query(`SELECT * FROM banpick WHERE game_id = '${game.id}' ORDER BY \`order\` DESC`))[0]

    if (!banpickList[0]) {
      throw new Error('진행 중인 밴픽이 없습니다.')
    }

    const order = banpickList[0].order + 1
    const turn = getBanpickTurn(order)

    if ((turn.host && userId != game.host_id) || (!turn.host && userId != game.opponent_id)) {
      throw new Error('현재 차례가 아닙니다.')
    }

    let banpick = banpickList.find((banpick) => banpick.track_id == trackId && !banpick.order)

    if (!banpick) {
      throw new Error('밴픽 트랙이 아니거나 이미 선정된 트랙입니다.')
    }

    await pool.query(`UPDATE banpick SET \`order\` = ${order}, picked = ${turn.pick}, banned = ${!turn.pick}, round = ${turn.round}, user_id = ${userId}, banpicked_at = UNIX_TIMESTAMP(NOW()) WHERE game_id = '${game.id}' AND track_id = '${trackId}'`)

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

    banpick = (await pool.query(`SELECT b.*, t.name AS track_name FROM banpick AS b INNER JOIN track AS t WHERE b.track_id = t.id AND game_id='${game.id}'`))[0]

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == game.opponent_id)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        user_id: gameEvent.userId,
        game: game,
        banpick: banpick,
      })}\n\n`)
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

app.get('/round', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    const game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND round_started_at IS NOT NULL AND closed_at IS NULL`))[0][0]

    if (!game) {
      throw new Error()
    }

    res.sendFile(__dirname + '/views/round.html')
  }
  catch (error) {
    res.redirect('/')
  }
})

app.post('/round/finish', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    const round = (await pool.query(`SELECT r.*, g.host_id, g.opponent_id FROM round AS r INNER JOIN game AS g WHERE r.game_id = g.id AND '${userId}' IN (g.host_id, g.opponent_id) AND g.round_started_at IS NOT NULL AND g.closed_at IS NULL ORDER BY number DESC LIMIT 1`))[0][0]

    if (!round) {
      throw new Error('진행 중인 라운드가 없습니다.')
    }

    let ready

    if (round.host_id == userId) {
      ready = 'host_ready'
    }
    else {
      ready = 'opponent_ready'
    }

    if (round[ready]) {
      throw new Error('이미 라운드 완료를 하셨습니다.')
    }

    await pool.query(`UPDATE round SET ${ready} = true WHERE game_id = '${round.game_id}' AND number = ${round.number}`)

    const game = (await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND banpick_started_at IS NOT NULL AND closed_at IS NULL`))[0][0]
    const banpickList = (await pool.query(`SELECT b.*, t.name AS track_name FROM banpick AS b INNER JOIN track AS t WHERE b.track_id = t.id AND game_id='${game.id}'`))[0]
    const roundList = (await pool.query(`SELECT r.*, b.track_id, t.name AS track_name FROM round AS r INNER JOIN banpick AS b INNER JOIN track AS t WHERE r.game_id = b.game_id AND b.track_id = t.id AND r.number = b.round AND r.game_id='${game.id}'`))[0]

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == game.opponent_id)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        user_id: gameEvent.userId,
        game: game,
        banpick: banpickList,
        round: roundList,
      })}\n\n`)
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

function encrypt(str) {
  return Crypto.publicEncrypt(key, Buffer.from(str)).toString('base64')
}

function decrypt(str) {
  return Crypto.privateDecrypt(key, Buffer.from(str, 'base64')).toString()
}

function getTrackList(matchType, trackType, amount = NaN) {
  return new Promise(async (resolve, reject) => {
    if (!matchType || !trackType) {
      reject(new Error('parameters required'))
    }

    let mode

    if (matchType.includes('speed')) {
      mode = 'speed'
    }
    else if (matchType.includes('item')) {
      mode = 'item'
    }
    else {
      reject(new Error('invalid match type'))
    }

    if (!['very_easy', 'easy', 'normal', 'hard', 'very_hard', 'all', 'league', 'new', 'reverse', 'crazy'].some((element) => trackType == element)) {
      reject(new Error('invalid trackType'))
    }

    const conditionList = []

    if (mode = 'speed') {
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

      const trackList = (await pool.query(query))[0]
      resolve(trackList)
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

let banpickTimerList = []

async function setRandomBanpickTimer(game, order) {
  const turn = getBanpickTurn(order)

  const timerId = setTimeout(async () => {
    banpickTimerList = banpickTimerList.filter((banpickTimer) => banpickTimer.gameId != game.id)
    await pool.query(`UPDATE banpick SET \`order\` = ${order}, picked = ${turn.pick}, banned = ${!turn.pick}, round = ${turn.round}, banpicked_at = UNIX_TIMESTAMP(NOW()) WHERE game_id = '${game.id}' AND track_id = (SELECT track_id FROM (SELECT track_id FROM banpick WHERE game_id = '${game.id}' AND \`order\` IS NULL ORDER BY RAND() LIMIT 1) random_track)`)

    if (order < 9) {
      setRandomBanpickTimer(game, order + 1)
    }
    else {
      startGame(game.id)
    }

    const banpickList = (await pool.query(`SELECT b.game_id, g.host_id, g.opponent_id, b.track_id, t.name AS track_name, b.order, b.picked, b.banned, b.banpicked_at FROM banpick AS b INNER JOIN game AS g INNER JOIN track as t WHERE b.game_id = g.id AND b.track_id = t.id AND b.game_id = '${game.id}'`))[0]

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == game.opponent_id)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        user_id: gameEvent.userId,
        game: game,
        banpick: banpickList,
      })}\n\n`)
    }
  }, 1000 * 60)

  banpickTimerList.push({
    id: timerId,
    gameId: game.id,
  })
}

async function startGame(gameId) {
  await pool.query(`UPDATE game SET round_started_at = UNIX_TIMESTAMP(NOW()) WHERE id = '${gameId}'`)
  await pool.query(`INSERT INTO round (game_id, number) VALUES ('${gameId}', 1)`)

  const game = (await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`))[0][0]
  const banpickList = (await pool.query(`SELECT * FROM banpick WHERE game_id = '${gameId}'`))[0]
  const roundList = (await pool.query(`SELECT r.*, b.track_id, t.name AS track_name FROM round AS r INNER JOIN banpick AS b INNER JOIN track as t WHERE r.game_id = b.game_id AND r.number = b.round AND b.track_id = t.id AND r.game_id='${game.id}'`))[0]

  setRecordToRetire(game, 1)

  for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == game.opponent_id)) {
    gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
      user_id: gameEvent.userId,
      game: game,
      banpick: banpickList,
      round: roundList,
    })}\n\n`)
  }
}

let roundTimerList = []

function setRecordToRetire(game, round) {
  const timerId = setTimeout(async () => {
    roundTimerList = roundTimerList.filter((roundTimer) => roundTimer.gameId != game.id)
    await pool.query(`UPDATE round SET host_record = '999.999', opponent_record = '999.999', finished_at = UNIX_TIMESTAMP(NOW()) WHERE game_id = '${game.id}' AND number = ${round}`)

    if (round < 7) {
      await pool.query(`INSERT INTO round (game_id, number) VALUES ('${game.id}', ${round + 1})`)
      setRecordToRetire(game, round + 1)
    }
    else {
      await closeGame(game.id)
    }

    const roundList = (await pool.query(`SELECT r.*, b.track_id, t.name AS track_name FROM round AS r INNER JOIN banpick AS b INNER JOIN track as t WHERE r.game_id = b.game_id AND r.number = b.round AND b.track_id = t.id AND r.game_id='${game.id}'`))[0]

    for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == game.opponent_id)) {
      gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
        user_id: gameEvent.userId,
        game: game,
        round: roundList,
      })}\n\n`)
    }
  }, 1000 * 60 * 7)

  roundTimerList.push({
    id: timerId,
    gameId: game.id,
  })
}

async function closeGame(gameId) {
  await pool.query(`UPDATE game SET closed_at = UNIX_TIMESTAMP(NOW()) WHERE id = '${gameId}'`)

  const game = (await pool.query(`SELECT * FROM game WHERE id = '${gameId}'`))[0][0]
  const banpickList = (await pool.query(`SELECT b.*, t.name AS track_name FROM banpick AS b INNER JOIN track AS t WHERE b.track_id = t.id AND game_id='${game.id}'`))[0]
  const roundList = (await pool.query(`SELECT r.*, b.track_id, t.name AS track_name FROM round AS r INNER JOIN banpick AS b INNER JOIN track AS t WHERE r.game_id = b.game_id AND r.number = b.round AND b.track_id = t.id AND r.game_id='${game.id}'`))[0]

  for (const gameEvent of gameEventList.filter((gameEvent) => gameEvent.userId == game.host_id || gameEvent.userId == game.opponent_id)) {
    gameEvent.res.write(`event: game_update\ndata: ${JSON.stringify({
      user_id: gameEvent.userId,
      game: game,
      banpick: banpickList,
      round: roundList,
    })}\n\n`)
  }
}