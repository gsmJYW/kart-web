import express from 'express'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
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

function getTrackList(mode, trackType) {
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
      const result = await pool.query(`SELECT * FROM track WHERE ${conditionList.join(' AND ')}`)
      resolve(result[0])
    }
    catch (error) {
      reject(new Error(error))
    }
  })
}

app.post('/game', async (req, res) => {
  try {
    if (!req.session.access_token) {
      throw new Error('not authorized')
    }

    const userId = decrypt(req.session.user_id)
    const result = await pool.query(`SELECT * FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`)
    const game = result[0][0]

    res.json({
      result: 'OK',
      game: game ? game : {},
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

    const conditionList = [`'${userId}' IN (host_id, opponent_id)`]

    if (req.session.player_id) {
      conditionList.push(`'${decrypt(req.session.player_id)}' IN (host_id, opponent_id)`)
    }

    let result = await pool.query(`SELECT * FROM game WHERE (${conditionList.join(' OR ')}) AND closed_at IS NULL`)

    if (result[0][0]) {
      throw new Error('이미 진행 중이신 게임이 있습니다.')
    }

    result[0].affectedRows = 0
    let gameId

    req.session.player_id = req.session.user_id
    req.session.save()

    while (result[0].affectedRows == 0) {
      gameId = Crypto.randomUUID().slice(0, 6)
      result = await pool.query(`INSERT IGNORE INTO game (id, host_id, host_rider_id, mode, track_type, banpick_amount) VALUES ('${gameId}', '${userId}', (SELECT rider_id FROM user WHERE id = '${userId}'), '${mode}', '${trackType}', ${banpickAmount})`)
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

    const conditionList = [`'${userId}' IN (host_id, opponent_id)`]

    if (req.session.player_id) {
      conditionList.push(`'${decrypt(req.session.player_id)}' IN (host_id, opponent_id)`)
    }

    let result = await pool.query(`SELECT * FROM game WHERE (${conditionList.join(' OR ')}) AND closed_at IS NULL`)

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

    if (game.host_rider_id == result[0][0].rider_id) {
      throw new Error('호스트와 라이더명이 같습니다. <br> 라이더명을 변경해주세요.')
    }

    req.session.player_id = req.session.user_id
    req.session.save()

    await pool.query(`UPDATE game SET opponent_id = ${userId} WHERE id = ${gameId}`)

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
    await pool.query(`DELETE FROM game WHERE '${userId}' IN (host_id, opponent_id) AND closed_at IS NULL`)

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