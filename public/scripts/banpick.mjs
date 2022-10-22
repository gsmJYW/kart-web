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

let lastBanpickedAt

try {
    const eventSource = new EventSource('/game/event')
    eventSource.addEventListener('game_update', async (e) => {
        const game = JSON.parse(e.data)

        const hostRider = await postAsync('/rider/name', { rider_id: game.host_rider_id })
        const opponentRider = await postAsync('/rider/name', { rider_id: game.opponent_rider_id })

        document.querySelector('.track-list').innerHTML = ''

        for (const banpick of document.querySelectorAll('.banpick-list > div > div, .banpick-list > div > p:nth-child(3), .banpick-list > div > img')) {
            banpick.remove()
        }

        for (const banpick of document.querySelectorAll('.banpick-list > div')) {
            const div = document.createElement('div')
            banpick.appendChild(div)
        }

        for (const host of document.querySelectorAll('.host')) {
            host.textContent = hostRider.rider_name
        }

        for (const opponent of document.querySelectorAll('.opponent')) {
            opponent.textContent = opponentRider.rider_name
        }

        for (const track of game.banpick) {
            const trackImage = document.createElement('img')
            trackImage.src = `/images/tracks/${track.track_name}.png`

            const trackName = document.createElement('p')
            trackName.textContent = `${track.track_name}`

            if (track.picked || track.banned) {
                const banpickBlank = document.querySelector(`.banpick-list > div:nth-child(${track.order}) > div`)

                const banpick = document.querySelector(`.banpick-list > div:nth-child(${track.order})`)
                banpick.insertBefore(trackImage, banpickBlank)
                banpick.insertBefore(trackName, banpickBlank)

                banpickBlank.remove()
            }
            else {
                const div = document.createElement('div')

                div.id = track.track_name
                div.appendChild(trackImage)
                div.appendChild(trackName)

                document.querySelector('.track-list').appendChild(div)
            }
        }

        const currentOrder = Math.max(...game.banpick.map(banpick => banpick.order)) + 1
        const turn = document.querySelector('.turn')
        let turnRiderName

        if (currentOrder % 2) {
            turnRiderName = hostRider.rider_name
        }
        else {
            turnRiderName = opponentRider.rider_name
        }

        if (currentOrder <= 9) {
            const currentBanpickDiv = document.querySelector(`.banpick-list > div:nth-child(${currentOrder})`)

            if (currentBanpickDiv) {
                const currentBanpick = document.createElement('p')
                currentBanpick.innerHTML = `<strong>${turnRiderName}</strong> 차례`

                currentBanpickDiv.appendChild(currentBanpick)
            }

            document.querySelector('.turn-rider').textContent = turnRiderName

            const banOrPick = document.querySelector('.ban-or-pick')

            if (currentOrder == 3 || currentOrder == 4) {
                banOrPick.textContent = '금지'
            }
            else {
                banOrPick.textContent = '선택'
            }

            turn.hidden = false
        }
        else {
            turn.hidden = true
        }

        lastBanpickedAt = Math.max(...game.banpick.map(banpick => banpick.banpicked_at))

        for (const track of document.querySelectorAll('.track-list > div')) {
            track.addEventListener('click', async (e) => {
                const res = await postAsync('/banpick', { track_name: track.id })

                if (res.result == 'error') {
                    await Swal.fire({
                        icon: 'warning',
                        html: res.error,
                        confirmButtonText: '확인',
                    })
                }
            })
        }

        if (game.game_started_at) {
            const res = await Swal.fire({
                title: '게임 시작',
                html: '게임이 진행 중입니다. <br> 이동 하시겠습니까?',
                showCancelButton: true,
                confirmButtonText: '확인',
                cancelButtonText: '취소',
            })

            if (res.isConfirmed) {
                location.href = '/banpick'
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

setInterval(async () => {
    const res = await postAsync('/timestamp')
    const remainTimestamp = res.timestamp - lastBanpickedAt

    if (remainTimestamp >= 0) {
        document.querySelector('.remain-time').textContent = 60 - remainTimestamp
    }
}, 1000)