let lastFinishedAt
let roundNumber
let interval

try {
    const eventSource = new EventSource('/game/event?path=round')

    eventSource.addEventListener('error', async (e) => {
        eventSource.close()

        await Swal.fire({
            icon: 'warning',
            html: e.data.toString(),
            confirmButtonText: '홈으로',
        })

        location.href = '/'
    })

    eventSource.addEventListener('server_side_error', async () => {
        eventSource.close()

        await Swal.fire({
            icon: 'error',
            html: '알 수 없는 오류가 발생 하였습니다.',
            confirmButtonText: '새로고침',
        })

        location.reload()
    })

    eventSource.addEventListener('game_update', async (e) => {
        Swal.close()

        const data = JSON.parse(e.data)

        let res = await postAsync('/rider/name', { rider_id: data.game.host_rider_id })

        if (res.result != 'OK') {
            throw new Error(res.error)
        }

        const hostRiderName = res.rider_name

        res = await postAsync('/rider/name', { rider_id: data.game.opponent_rider_id })

        if (res.result != 'OK') {
            throw new Error(res.error)
        }

        const opponentRiderName = res.rider_name

        roundNumber = Math.max(...data.round.map(round => round.number))

        for (const roundElement of document.querySelectorAll('.round-list > div > div, .round-list > div > p:nth-child(3), .round-list > div > img')) {
            roundElement.remove()
        }

        for (const roundDiv of document.querySelectorAll('.round-list > div')) {
            const div = document.createElement('div')
            roundDiv.appendChild(div)
        }

        document.querySelector('.host').textContent = hostRiderName
        document.querySelector('.opponent').textContent = opponentRiderName

        const hostScore = data.round.filter((round) => Number(round.host_record) < Number(round.opponent_record)).length
        const opponentScore = data.round.filter((round) => Number(round.host_record) > Number(round.opponent_record)).length

        document.querySelector('.host-score').textContent = hostScore
        document.querySelector('.opponent-score').textContent = opponentScore

        const roundSkip = document.querySelector('.round-skip')
        const currentRound = document.querySelector('.current-round > div')

        if (data.game.closed_at) {
            let icon
            let title
            let desc

            if (data.game.quit_user_id) {
                if (data.user_id == data.game.quit_user_id) {
                    icon = 'error'
                    title = '패배'
                }
                else {
                    icon = 'success'
                    title = '승리'
                }

                let quitRiderName

                if (data.game.quit_user_id == data.game.host_id) {
                    quitRiderName = hostRiderName
                }
                else {
                    quitRiderName = opponentRiderName
                }

                desc = `<strong>${quitRiderName}</strong>님이 게임을 나갔습니다.`
            }
            else if (hostScore > opponentScore) {
                if (data.user_id == data.game.host_id) {
                    icon = 'success'
                    title = '승리'
                }
                else {
                    icon = 'error'
                    title = '패배'
                }

                desc = `<strong>${hostRiderName}</strong>님의 승리입니다.`
            }
            else if (opponentScore > hostScore) {
                if (data.user_id == data.game.opponent_id) {
                    icon = 'success'
                    title = '승리'
                }
                else {
                    icon = 'error'
                    title = '패배'
                }

                desc = `<strong>${opponentRiderName}</strong>님의 승리입니다.`
            }
            else {
                icon = 'question'
                title = '무승부'
                desc = '승자가 없습니다.'
            }

            Swal.fire({
                icon: icon,
                title: title,
                html: `${desc} <br> 로비로 돌아 가시겠습니까?`,
                showCancelButton: true,
                confirmButtonText: '확인',
                cancelButtonText: '취소',
                allowOutsideClick: false,
            }).then((res) => {
                if (res.isConfirmed) {
                    location.href = '/'
                }
            })

            roundSkip.hidden = true
            currentRound.hidden = true
        }

        for (const banpick of data.banpick.filter((banpick) => banpick.round)) {
            const roundStatus = document.createElement('p')

            const trackImage = document.createElement('img')
            trackImage.src = `/images/tracks/${banpick.track_id}.png`

            const round = data.round.find((round) => round.number == banpick.round)

            if (!round || (round.number == roundNumber && data.game.closed_at)) {
                continue
            }

            if (round.host_record && round.opponent_record) {
                let hostRecord = `${hostRiderName}: ${formatRecord(Number(round.host_record))}`

                if (Number(round.host_record) < Number(round.opponent_record)) {
                    hostRecord = `<strong>${hostRecord}</strong>`
                }

                let opponentRecord = `${opponentRiderName}: ${formatRecord(Number(round.opponent_record))}`

                if (Number(round.opponent_record) < Number(round.host_record)) {
                    opponentRecord = `<strong>${opponentRecord}</strong>`
                }

                roundStatus.innerHTML = `${hostRecord} <br> ${opponentRecord}`
            }
            else {
                roundStatus.innerHTML = '진행 중'
            }

            if (round.number == roundNumber) {
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

                roundSkip.disabled = (data.game.host_id == data.user_id && round.host_skipped) || (data.game.opponent_id == data.user_id && round.opponent_skipped)

                if (!roundSkip.disabled && (round.host_skipped || round.opponent_skipped)) {
                    Swal.fire({
                        icon: 'question',
                        html: '상대가 라운드 스킵을 요청했어요. <br> 리타이어로 처리하고 라운드를 넘기는 것에 동의하십니까?',
                        showCancelButton: true,
                        confirmButtonText: '확인',
                        cancelButtonText: '취소',
                        allowOutsideClick: false,
                    }).then(async (res) => {
                        if (!res.isConfirmed) {
                            return
                        }

                        try {
                            const res = await postAsync('/round/skip')

                            if (res.result == 'error') {
                                await showWarning(res.reason)
                            }
                            else if (res.result == 'server_side_error') {
                                throw new Error()
                            }
                        }
                        catch {
                            await showError()
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

        if (data.game.closed_at) {
            bottomLeft.hidden = true
            clearInterval(interval)
        }
        else {
            bottomLeft.hidden = false
        }

        if (roundNumber > 1) {
            lastFinishedAt = Math.max(...data.round.map(round => round.finished_at))
        }
        else {
            lastFinishedAt = data.game.round_started_at
        }

        roundSkip.onclick = async () => {
            try {
                let res = await Swal.fire({
                    icon: 'warning',
                    html: '라운드 스킵을 요청하고 <br> 상대가 동의하면 라타이어 처리됩니다. <br> 정말 넘기시겠습니까?',
                    showCancelButton: true,
                    confirmButtonText: '확인',
                    cancelButtonText: '취소',
                    allowOutsideClick: false,
                })

                if (!res.isConfirmed) {
                    return
                }

                res = await postAsync('/round/skip')

                if (res.result == 'error') {
                    await showWarning(res.reason)
                }
                else if (res.result == 'server_side_error') {
                    throw new Error()
                }
                else if (res.result == 'waiting for the other') {
                    await Swal.fire({
                        icon: 'success',
                        html: '상대가 동의하기를 기다리고 있어요.',
                        confirmButtonText: '확인',
                        showOutsideClick: false,
                    })
                }
            }
            catch {
                await showError()
            }
        }
    })
}
catch {
    await Swal.fire({
        icon: 'error',
        title: '오류',
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

async function showWarning(reason) {
    await Swal.fire({
        icon: 'warning',
        html: reason,
        confirmButtonText: '확인',
    })
}

async function showError() {
    await Swal.fire({
        icon: 'error',
        html: '알 수 없는 오류가 발생 하였습니다.',
        confirmButtonText: '확인',
    })
}

function formatRecord(record) {
    if (record > 9999) {
        return 'RETIRE'
    }

    return `${Math.floor(record / 60)}:${Math.floor(record % 60).toString().padStart(2, '0')}:${(record * 1000 % 1000).toString().padStart(3, '0')}`
}