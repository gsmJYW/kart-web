import express from 'express'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs, { accessSync } from 'fs'
import http from 'http'
import https from 'https'
import bodyParser from 'body-parser'
import mysql from 'mysql2/promise'
import DiscordOauth2 from 'discord-oauth2'
import cookieParser from 'cookie-parser'
import Crypto from 'crypto'

const args = process.argv.slice(2)

if (args.length < 6) {
  console.error('Parameters not provided: [host] [user] [password] [database] [discord_oauth_client_secret] [discord_oauth_redirect_uri]')
  process.exit(1)
}

const pool = mysql.createPool({
  host: args[0],
  user: args[1],
  password: args[2],
  database: args[3],
  connectionLimit: 100,
})

const app = express();

app.use(bodyParser.json())
app.use(cookieParser())
app.use(express.static('public'))

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const key = fs.readFileSync(`${__dirname}/ssl/${fs.readdirSync('ssl').find((file) => file.endsWith('.key.pem'))}`)
const cert = fs.readFileSync(`${__dirname}/ssl/${fs.readdirSync('ssl').find((file) => file.endsWith('.crt.pem'))}`)

const oauth = new DiscordOauth2({
  clientId: '1029472862765056010',
  clientSecret: args[4],
  redirectUri: args[5],
})

app.use((req, res, next) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol
  if (protocol == 'https') {
    next()
  }
  else {
    res.redirect(`https://${req.hostname}${req.url}`)
  }
})

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/lobby.html')
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

    const encrypted = Crypto.publicEncrypt(key, Buffer.from(resp.access_token)).toString('base64')
    res.cookie('access_token', encrypted)
  }
  catch (error) {
    console.log(error)
  }
  finally {
    res.redirect('/')
  }
})

app.post('/discord/user', async (req, res) => {
  try {
    const accessToken = Crypto.privateDecrypt(key, Buffer.from(decodeURIComponent(req.body.access_token), 'base64'))
    const user = await oauth.getUser(accessToken)

    res.json({
      result: 'OK',
      user: user,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error,
    })
  }
})

app.post('/trackAmount', async (req, res) => {
  try {
    let trackType = req.body.track_type
    let mode = req.body.mode

    if (!trackType && !mode) {
      throw new Error('parameters required')
    }

    const conditionList = []

    if (mode == 'speed') {
      conditionList.push('crazy = false')

      if (trackType == 'league') {
        conditionList.push('speed = true')
      }
    }
    else {
      conditionList.push('item = true')
    }

    if (['very', 'easy', 'normal', 'hard', 'new'].some(element => trackType.includes(element)) > 0) {
      conditionList.push(`${mode}_${trackType} = true`)
    }
    else if (trackType != 'all') {
      conditionList.push(`${trackType} = true`)
    }

    const result = await pool.query(`SELECT COUNT(*) AS trackAmount FROM track WHERE ${conditionList.join(' AND ')}`)

    res.json({
      result: 'OK',
      trackAmount: result[0][0].trackAmount,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error,
    })
  }
})

http.createServer(app).listen(80)
https.createServer({ key: key, cert: cert }, app).listen(443)