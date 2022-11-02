let lastBanpickedAt
let order
let interval

try {
    const eventSource = new EventSource('/game/event?path=banpick')

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

        document.querySelector('.track-list').innerHTML = ''

        for (const banpickElement of document.querySelectorAll('.banpick-list > div > div, .banpick-list > div > p:nth-child(3), .banpick-list > div > img')) {
            banpickElement.remove()
        }

        for (const banpickDiv of document.querySelectorAll('.banpick-list > div')) {
            const div = document.createElement('div')
            banpickDiv.appendChild(div)
        }

        for (const banpick of data.banpick) {
            const trackImage = document.createElement('img')
            trackImage.src = `/images/tracks/${banpick.track_id}.png`

            const trackName = document.createElement('p')
            trackName.textContent = banpick.track_name

            if (banpick.picked || banpick.banned) {
                const banpickDiv = document.querySelector(`.banpick-list > div:nth-child(${banpick.order})`)
                banpickDiv.appendChild(trackImage)
                banpickDiv.appendChild(trackName)

                document.querySelector(`.banpick-list > div:nth-child(${banpick.order}) > div`).remove()
            }
            else {
                const div = document.createElement('div')

                div.id = banpick.track_id
                div.appendChild(trackImage)
                div.appendChild(trackName)

                document.querySelector('.track-list').appendChild(div)
            }
        }

        order = Math.max(...data.banpick.map((banpick) => banpick.order)) + 1
        const top = document.querySelector('.top')

        if (order <= 9 && !data.game.closed_at) {
            let turnRiderName
            let remainOrder = order

            for (const remainBanpickDiv of document.querySelectorAll(`.banpick-list > div:nth-child(n + ${order})`)) {
                let remainTurnRiderName

                if (remainOrder % 2) {
                    remainTurnRiderName = hostRiderName
                }
                else {
                    remainTurnRiderName = opponentRiderName
                }

                const p = document.createElement('p')
                p.innerHTML = remainTurnRiderName

                remainBanpickDiv.appendChild(p)
                remainOrder++
            }

            const banpickRandom = document.querySelector('.banpick-random')

            banpickRandom.onclick = async () => {
                try {
                    const res = await postAsync('/banpick/random')

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
            }

            if (order % 2) {
                turnRiderName = hostRiderName
                banpickRandom.disabled = data.user_id == data.game.opponent_id
            }
            else {
                turnRiderName = opponentRiderName
                banpickRandom.disabled = data.user_id == data.game.host_id
            }

            document.querySelector('.turn-rider').textContent = turnRiderName

            const banOrPick = document.querySelector('.ban-or-pick')

            if (order == 3 || order == 4) {
                banOrPick.textContent = '금지'
            }
            else {
                banOrPick.textContent = '선택'
            }

            top.hidden = false
        }
        else {
            top.hidden = true
            clearInterval(interval)

            if (data.game.quit_user_id) {
                let quitRiderName

                if (data.game.quit_user_id == data.game.host_id) {
                    quitRiderName = hostRiderName
                }
                else {
                    quitRiderName = opponentRiderName
                }

                const res = await Swal.fire({
                    title: '게임 종료',
                    html: `<strong>${quitRiderName}</strong>님이 게임을 나갔습니다. <br> 로비로 돌아 가시겠습니까?`,
                    showCancelButton: true,
                    confirmButtonText: '확인',
                    cancelButtonText: '취소',
                    allowOutsideClick: false,
                })

                if (res.isConfirmed) {
                    location.href = '/'
                }
            }
            else {
                const res = await Swal.fire({
                    title: '게임 시작',
                    html: '게임이 진행 중입니다. <br> 이동 하시겠습니까?',
                    showCancelButton: true,
                    confirmButtonText: '확인',
                    cancelButtonText: '취소',
                    allowOutsideClick: false,
                })

                if (res.isConfirmed) {
                    location.href = '/round'
                }
            }

            return
        }

        lastBanpickedAt = Math.max(...data.banpick.map(banpick => banpick.banpicked_at))

        for (const track of document.querySelectorAll('.track-list > div')) {
            track.onclick = async () => {
                try {
                    const res = await postAsync('/banpick', { track_id: track.id })

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
            }
        }
    })
}
catch {
    await Swal.fire({
        icon: 'error',
        html: '알 수 없는 오류가 발생 하였습니다.',
        confirmButtonText: '새로고침',
    })

    location.reload()
}

interval = setInterval(async () => {
    if (order && order <= 9) {
        const res = await postAsync('/timestamp')
        const remainTimestamp = res.timestamp - lastBanpickedAt

        if (remainTimestamp >= 0) {
            document.querySelector('.remain-time').textContent = 60 - remainTimestamp
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