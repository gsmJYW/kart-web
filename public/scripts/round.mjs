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
    const eventSource = new EventSource('/game/event?path=round')
    eventSource.addEventListener('game_update', async (e) => {
        Swal.close()

        const data = JSON.parse(e.data)

        const hostRider = await postAsync('/rider/name', { rider_id: data.game.host_rider_id })
        const opponentRider = await postAsync('/rider/name', { rider_id: data.game.opponent_rider_id })

        roundNumber = Math.max(...data.round.map(round => round.number))

        if (data.game.closed_at) {
            roundNumber = Infinity
        }

        for (const roundElement of document.querySelectorAll('.round-list > div > div, .round-list > div > p:nth-child(3), .round-list > div > img')) {
            roundElement.remove()
        }

        for (const roundDiv of document.querySelectorAll('.round-list > div')) {
            const div = document.createElement('div')
            roundDiv.appendChild(div)
        }

        document.querySelector('.host').textContent = hostRider.rider_name
        document.querySelector('.opponent').textContent = opponentRider.rider_name

        const hostScore = data.round.filter((round) => Number(round.host_record) < Number(round.opponent_record)).length
        const opponentScore = data.round.filter((round) => Number(round.host_record) > Number(round.opponent_record)).length

        document.querySelector('.host-score').textContent = hostScore
        document.querySelector('.opponent-score').textContent = opponentScore

        const finishRound = document.querySelector('.finish-round')
        const currentRound = document.querySelector('.current-round > div')

        if (roundNumber > 7) {
            finishRound.hidden = true
            currentRound.hidden = true
        }

        for (const round of data.round) {
            const trackImage = document.createElement('img')
            trackImage.src = `/images/tracks/${round.track_id}.png`

            const roundStatus = document.createElement('p')

            if (roundNumber > round.number) {
                let hostRecord = `${hostRider.rider_name}: ${formatRecord(Number(round.host_record))}`

                if (Number(round.host_record) < Number(round.opponent_record)) {
                    hostRecord = `<strong>${hostRecord}</strong>`
                }

                let opponentRecord = `${opponentRider.rider_name}: ${formatRecord(Number(round.opponent_record))}`

                if (Number(round.opponent_record) < Number(round.host_record)) {
                    opponentRecord = `<strong>${opponentRecord}</strong>`
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

                currentRound.appendChild(currentRoundNumber)
                currentRound.appendChild(trackImage.cloneNode())
                currentRound.appendChild(trackName)

                finishRound.disabled = (data.game.host_id == data.user_id && round.host_ready) || (data.game.opponent_id == data.user_id && round.opponent_ready)

                if (!finishRound.disabled && (round.host_ready || round.opponent_ready)) {
                    Swal.fire({
                        icon: 'warning',
                        html: '상대가 매치 기록이 없는 상태에서 라운드를 완료했어요. <br> 리타이어로 처리하고 라운드를 넘기는 것에 동의하십니까?',
                        showCancelButton: true,
                        confirmButtonText: '확인',
                        cancelButtonText: '취소',
                    }).then(async (res) => {
                        if (res.isConfirmed) {
                            try {
                                const res = await postAsync('/round/finish-anyway')

                                if (res.result == 'error') {
                                    throw new Error(res.error)
                                }
                            }
                            catch (error) {
                                await Swal.fire({
                                    icon: 'warning',
                                    html: error.message,
                                    confirmButtonText: '확인',
                                })
                            }
                        }
                    })
                }
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

        finishRound.onclick = async () => {
            try {
                let res = await postAsync('/round/finish')

                if (res.result == 'error') {
                    throw new Error(res.error)
                }
                else if (res.result == 'match not found') {
                    const res = await Swal.fire({
                        icon: 'warning',
                        html: '매치 기록을 찾지 못했습니다. <br> 인게임 시상식이 끝나고 최대 20초까지 걸릴 수 있습니다. <br> 이대로 완료하고 리타이어 처리를 원하십니까?',
                        showCancelButton: true,
                        confirmButtonText: '확인',
                        cancelButtonText: '취소',
                        showOutsideClick: false,
                    })

                    if (res.isConfirmed) {
                        const res = await postAsync('/round/finish-anyway')

                        if (res.result == 'error') {
                            throw new Error(res.error)
                        }
                        else if (res.result == 'waiting for the other') {
                            await Swal.fire({
                                icon: 'success',
                                html: '상대가 라운드를 완료하기를 기다리고 있어요.',
                                confirmButtonText: '확인',
                                showOutsideClick: false,
                            })
                        }
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
        }
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

function formatRecord(record) {
    if (record > 999) {
        return 'RETIRE'
    }

    return `${Math.floor(record / 60)}:${Math.floor(record % 60).toString().padStart(2, '0')}:${(record * 1000 % 1000).toString().padStart(3, '0')}`
}