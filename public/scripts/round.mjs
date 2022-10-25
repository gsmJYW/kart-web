function postAsync(url, params = {}) {
    return new Promise((resolve, reject) => {
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
        }).then(async (res) => {
            resolve(await res.json())
        }).catch((error) => reject(error))
    })
}

let lastFinishedAt
let roundNumber
let interval

try {
    const eventSource = new EventSource('/game/event')
    eventSource.addEventListener('game_update', async (e) => {
        const data = JSON.parse(e.data)

        const hostRider = await postAsync('/rider/name', { rider_id: data.game.host_rider_id })
        const opponentRider = await postAsync('/rider/name', { rider_id: data.game.opponent_rider_id })

        roundNumber = Math.max(...data.round.map(round => round.number))

        for (const roundElement of document.querySelectorAll('.round-list > div > div, .round-list > div > p:nth-child(3), .round-list > div > img')) {
            roundElement.remove()
        }

        for (const roundDiv of document.querySelectorAll('.round-list > div')) {
            const div = document.createElement('div')
            roundDiv.appendChild(div)
        }

        document.querySelector('.host-score').textContent = data.round.filter((round) => round.host_record > round.opponent_record).length
        document.querySelector('.opponent-score').textContent = data.round.filter((round) => round.opponent_record > round.host_record).length

        const finishRound = document.querySelector('.finish-round')

        for (const round of data.round) {
            const trackImage = document.createElement('img')
            trackImage.src = `/images/tracks/${round.track_id}.png`

            const roundStatus = document.createElement('p')

            if (roundNumber > round.number) {
                const hostRecord = `${hostRider.rider_name}: ${round.host_record < 999 ? round.host_record : 'RETIRE'}`

                if (round.host_record > round.opponent_record) {
                    hostRecord = `<strong>${hostRecord}</strong>`
                }

                const opponentRecord = `${opponentRider.rider_name}: ${round.opponent_record < 999 ? round.opponent_record : 'RETIRE'}`

                if (round.opponent_record > round.host_record) {
                    hostRecord = `<strong>${opponentRecord}</strong>`
                }

                roundStatus.innerHTML = `${hostRecord} <br> ${opponentRecord}`
            }
            else {
                roundStatus.innerHTML = '진행 중 <br> &nbsp;'

                for (const element of document.querySelectorAll('.current-round > div > *')) {
                    element.remove()
                }

                const currentRoundNumber = document.createElement('p')
                currentRoundNumber.textContent = `ROUND ${roundNumber}`

                const trackName = document.createElement('p')
                trackName.textContent = round.track_name

                const currentRound = document.querySelector('.current-round > div')

                currentRound.appendChild(currentRoundNumber)
                currentRound.appendChild(trackImage.cloneNode())
                currentRound.appendChild(trackName)

                finishRound.disabled = (data.game.host_id == data.user_id && round.host_ready) || (data.game.opponent_id == data.user_id && round.opponent_ready)
            }

            const roundDiv = document.querySelector(`.round-list > div:nth-child(${round.number})`)
            roundDiv.appendChild(trackImage)
            roundDiv.appendChild(roundStatus)

            document.querySelector(`.round-list > div:nth-child(${round.number}) > div`).remove()
        }

        const bottomLeft = document.querySelector('.bottom-left')
        let channel

        if (data.game.channel.includes('speed')) {
            channel = '스피드'
        }
        else {
            channel = '아이템'
        }

        channel += ' '

        if (data.game.channel.includes('Indi')) {
            channel += '개인전'
        }
        else {
            channel += '팀전'
        }

        if (data.game.channel.includes('Infinit')) {
            channel += ' (무한)'
        }

        document.querySelector('.match-type').textContent = channel

        if (roundNumber <= 7) {
            bottomLeft.hidden = false
        }
        else {
            bottomLeft.hidden = true
            clearInterval(interval)
        }

        if (roundNumber > 1) {
            lastFinishedAt = Math.max(...data.round.map(round => round.finished_at))
        }
        else {
            lastFinishedAt = data.game.round_started_at
        }

        finishRound.addEventListener('click', async () => {
            try {
                let res = await Swal.fire({
                    icon: 'warning',
                    html: '멀티플레이를 진행하지 않고 다음 라운드로 <br> 넘어갈 경우 리타이어로 처리됩니다. <br> 정말 완료 하시겠습니까?',
                    showCancelButton: true,
                    confirmButtonText: '확인',
                    cancelButtonText: '취소',
                })

                if (res.isConfirmed) {
                    res = await postAsync('/round/finish')

                    if (res.result == 'error') {
                        throw new Error(res.error)
                    }
                }
            }
            catch (error) {
                await Swal.fire({
                    icon: 'warning',
                    html: error.message,
                    confirmButtonText: '확인',
                })
            }
        })
    })
}
catch (error) {
    await Swal.fire({
        icon: 'error',
        html: error.message,
        confirmButtonText: '새로고침',
    })

    location.reload()
}

interval = setInterval(async () => {
    if (roundNumber && roundNumber <= 7) {
        const res = await postAsync('/timestamp')
        const remainTimestamp = res.timestamp - lastFinishedAt

        if (remainTimestamp >= 0) {
            document.querySelector('.remain-time').textContent = 420 - remainTimestamp
        }
    }
}, 1000)