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

try {
    const eventSource = new EventSource('/game/event')
    eventSource.addEventListener('game_update', async (e) => {
        const game = JSON.parse(e.data)

        const hostRider = await postAsync('/rider/name', { rider_id: game.host_rider_id })
        const opponentRider = await postAsync('/rider/name', { rider_id: game.opponent_rider_id })

        for (const host of document.querySelectorAll('.host')) {
            host.textContent += ` (${hostRider.rider_name})`
        }

        for (const opponent of document.querySelectorAll('.opponent')) {
            opponent.textContent += ` (${opponentRider.rider_name})`
        }

        for (const track of game.banpick) {
            const trackImage = document.createElement('img')
            trackImage.id = track.track_name
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

                div.appendChild(trackImage)
                div.appendChild(trackName)

                document.querySelector('.track-list').appendChild(div)
            }
        }

        const currentOrder = Math.max(...game.banpick.map(banpick => banpick.order)) + 1
        const currentBanpickDiv = document.querySelector(`.banpick-list > div:nth-child(${currentOrder})`)

        if (currentBanpickDiv) {
            const currentBanpick = document.createElement('p')
            currentBanpick.textContent = '밴픽 진행 중'

            currentBanpickDiv.appendChild(currentBanpick)
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