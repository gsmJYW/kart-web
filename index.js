const express = require('express')
const bodyParser = require('body-parser')
const mysql = require('mysql2/promise')

const args = process.argv.slice(2)

if (args.length < 4) {
  console.error('Parameters not provided: [host] [user] [password] [database]')
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
app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/track_select.html');
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

app.listen(80);