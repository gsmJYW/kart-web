try {
    const eventSource = new EventSource('/game/event?path=lobby')
    eventSource.addEventListener('game_update', async (e) => {
        const data = JSON.parse(e.data)

        if (!data.game) {
            document.querySelector('.game-card').hidden = true
            return
        }

        let title

        if (data.game.channel.includes('speed')) {
            title = '스피드'
        }
        else {
            title = '아이템'
        }

        title += ' '

        if (data.game.channel.includes('Indi')) {
            title += '개인전'
        }
        else {
            title += '팀전'
        }

        if (data.game.channel.includes('Infinit')) {
            title += ' (무한)'
        }

        title += ' / '

        switch (data.game.track_type) {
            case 'very_easy':
                title += 'Very Easy 랜덤'
                break

            case 'easy':
                title += 'Easy 랜덤'
                break

            case 'normal':
                title += 'Normal 랜덤'
                break

            case 'hard':
                title += 'Hard 랜덤'
                break

            case 'very_hard':
                title += 'Very Hard 랜덤'
                break

            case 'all':
                title += '전체 랜덤'
                break

            case 'league':
                title += '리그 랜덤'
                break

            case 'new':
                title += '뉴 랜덤'
                break

            case 'reverse':
                title += '리버스 랜덤'
                break

            case 'crazy':
                title += '크레이지 랜덤'
                break
        }

        const gameStarted = document.querySelector('.game-started')
        const gameWaiting = document.querySelector('.game-waiting')

        if (data.game.opponent_id) {
            gameStarted.hidden = false
            gameWaiting.hidden = true

            let subtitle = '밴픽 진행 중'

            if (data.game.round_started_at) {
                subtitle = '게임 진행 중'
            }

            document.querySelector('.game-started > div > .game-card-subtitle').textContent = subtitle
            document.querySelector('.open-game').onclick = () => {
                if (data.game.round_started_at) {
                    window.location.href = '/round'
                }
                else {
                    window.location.href = '/banpick'
                }
            }
        }
        else {
            gameStarted.hidden = true
            gameWaiting.hidden = false

            document.querySelector('.banpick-amount').textContent = data.game.banpick_amount
            document.querySelector('.show-game-id').onclick = async () => {
                const res = await Swal.fire({
                    title: `초대 코드`,
                    html: data.game.id,
                    showCancelButton: true,
                    confirmButtonText: '복사',
                    cancelButtonText: '닫기',
                    allowOutsideClick: false,
                })

                if (res.isConfirmed) {
                    await navigator.clipboard.writeText(data.game.id)
                }
            }
            document.querySelector('.close-game').onclick = async () => {
                try {
                    const res = await postAsync('/game/close')

                    if (res.result == 'error') {
                        throw new Error(res.error)
                    }
                }
                catch (error) {
                    await Swal.fire({
                        icon: 'error',
                        title: '오류',
                        html: error.message,
                        confirmButtonText: '확인',
                    })
                }
            }
        }

        for (const gameCardTitle of document.querySelectorAll('.game-card-title')) {
            gameCardTitle.textContent = title
        }

        if (data.game.round_started_at) {
            const res = await Swal.fire({
                title: '게임 시작',
                html: '게임이 진행 중입니다. <br> 이동 하시겠습니까?',
                showCancelButton: true,
                confirmButtonText: '확인',
                cancelButtonText: '취소',
            })

            if (res.isConfirmed) {
                location.href = '/round'
            }
        }
        else if (data.game.banpick_started_at) {
            const res = await Swal.fire({
                title: '게임 시작',
                html: '밴픽이 진행 중입니다. <br> 이동 하시겠습니까?',
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
    await showError(error)
}

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

document.querySelector('.stat').onclick = async () => {
    await Swal.fire({
        title: '공사중',
        html: '아직 개발 중이에요!',
        confirmButtonText: '확인',
    })
}

document.querySelector('.change-rider-name').onclick = async () => {
    const res = await Swal.fire({
        title: '라이더명 입력',
        input: 'text',
        showCancelButton: true,
        confirmButtonText: '확인',
        cancelButtonText: '취소',
    })

    if (res.isConfirmed) {
        const riderName = res.value.trim()

        try {
            const res = await postAsync('/rider/name/update', { rider_name: riderName })

            if (res.result == 'error') {
                throw new Error(res.error)
            }

            await Swal.fire({
                icon: 'success',
                html: '라이더명을 변경 하였습니다.',
                confirmButtonText: '확인',
            })
        }
        catch (error) {
            await Swal.fire({
                icon: 'error',
                title: '오류',
                html: error.message,
                confirmButtonText: '확인',
            })
        }
    }
}

document.querySelector('.signout').onclick = async () => {
    const res = await Swal.fire({
        icon: 'warning',
        html: '로그아웃 하여도 대기 중이거나 <br> 진행 중인 게임은 취소되지 않습니다.',
        showCancelButton: true,
        confirmButtonText: '로그아웃',
        cancelButtonText: '취소'
    })

    if (res.isConfirmed) {
        await fetch('/signout')
        location.reload()
    }
}

document.querySelector('.join').onclick = async () => {
    const res = await Swal.fire({
        title: '초대 코드 입력',
        input: 'text',
        showCancelButton: true,
        confirmButtonText: '확인',
        cancelButtonText: '취소',
    })

    if (res.isConfirmed) {
        const gameId = res.value.trim()

        if (/[^a-z0-9]/g.test(gameId) || gameId.length != 6) {
            await Swal.fire({
                icon: 'warning',
                html: '초대 코드에 잘못된 문자가 들어갔거나 6자가 아닙니다.',
                confirmButtonText: '확인',
            })
            return
        }

        try {
            const res = await postAsync('/game/join', { game_id: gameId })

            if (res.result == 'error') {
                throw new Error(res.error)
            }
        }
        catch (error) {
            await Swal.fire({
                icon: 'error',
                title: '오류',
                html: error.message,
                confirmButtonText: '확인',
            })
        }
    }
}

for (const random of document.querySelectorAll('.track-type-list > img')) {
    random.onclick = async (e) => {
        const trackType = e.target.id
        let channel = 'item'

        if (trackType != 'crazy') {
            const res = await Swal.fire({
                html: `<img src="/images/randoms/${trackType}.png" />`,
                input: 'radio',
                inputOptions: {
                    'speed': '스피드전',
                    'item': '아이템전',
                },
                inputValue: 'speed',
                showCancelButton: true,
                confirmButtonText: '확인',
                cancelButtonText: '취소',
            })

            if (!res.isConfirmed) {
                return
            }

            channel = res.value
        }

        const res = await Swal.fire({
            html: `<img src="/images/randoms/${trackType}.png" />`,
            input: 'radio',
            inputOptions: {
                'Indi': '개인전',
                'Team': '팀전',
            },
            inputValue: 'Indi',
            showCancelButton: true,
            confirmButtonText: '확인',
            cancelButtonText: '취소',
        })

        if (!res.isConfirmed) {
            return
        }

        channel += res.value

        if (channel.includes('speed')) {
            const res = await Swal.fire({
                html: `<img src="/images/randoms/${trackType}.png" />`,
                input: 'radio',
                inputOptions: {
                    'normal': '통합',
                    'Infinit': '무한',
                },
                inputValue: 'normal',
                showCancelButton: true,
                confirmButtonText: '확인',
                cancelButtonText: '취소',
            })

            if (!res.isConfirmed) {
                return
            }
            else if (res.value == 'Infinit') {
                channel += res.value
            }
        }

        let banpickAmount = 0

        try {
            let res = await postAsync('/tracks', {
                channel: channel,
                track_type: trackType,
            })

            if (res.result == 'error') {
                throw new Error(res.error)
            }

            if (res.tracks.length < 9) {
                await Swal.fire({
                    icon: 'warning',
                    html: '트랙 수가 밴픽을 진행하기에 부족합니다.',
                    confirmButtonText: '확인',
                })
                return
            }

            res = await Swal.fire({
                icon: 'question',
                title: '밴픽 트랙 수',
                input: 'range',
                inputLabel: (trackType == 'crazy' ? '주의: 크레이지는 아이템전만 가능합니다.\n' : '') + '아래 만큼의 트랙을 랜덤으로 뽑아 밴픽을 진행합니다.',
                inputAttributes: {
                    min: 9,
                    max: res.tracks.length,
                    step: 1
                },
                inputValue: Math.round(9 + (res.tracks.length - 9) / 2),
                showCancelButton: true,
                confirmButtonText: '확인',
                cancelButtonText: '취소',
            })

            if (res.isConfirmed) {
                banpickAmount = res.value
            }
        }
        catch (error) {
            await Swal.fire({
                icon: 'error',
                title: '오류',
                html: error.message,
                confirmButtonText: '확인',
            })
        }

        if (banpickAmount) {
            try {
                swal.fire({
                    html: '게임을 여는 중입니다.',
                    showConfirmButton: false,
                    allowOutsideClick: false,
                    heightAuto: false,
                })
                swal.showLoading()

                let res = await postAsync('/game/create', {
                    channel: channel,
                    track_type: trackType,
                    banpick_amount: banpickAmount,
                })

                if (res.result == 'error') {
                    throw new Error(res.error)
                }

                const gameId = res.game_id

                res = await Swal.fire({
                    title: `게임 생성 완료`,
                    icon: 'success',
                    html: `사이트에서 나가셔도 대기방은 없어지지 않습니다. <br> 좌측 상단의 취소를 누르시기 전까지는 <br> 누군가 참가해 게임이 시작될 수 있습니다. <br><br> 초대 코드: <strong>${gameId}</strong>`,
                    showCancelButton: true,
                    confirmButtonText: '복사',
                    cancelButtonText: '닫기',
                    allowOutsideClick: false,
                })

                if (res.isConfirmed) {
                    await navigator.clipboard.writeText(gameId)
                }
            }
            catch (error) {
                await Swal.fire({
                    icon: 'error',
                    title: '오류',
                    html: error.message,
                    confirmButtonText: '확인',
                })
            }
        }
    }
}

try {
    const topRight = document.querySelector('.top-right')
    const avatar = document.querySelector('.avatar')

    let res = await postAsync('/user')

    if (res.result == 'error') {
        throw new Error(res.error)
    }

    document.querySelector('.name').textContent = res.user.name

    if (res.user.avatar) {
        avatar.src = `https://cdn.discordapp.com/avatars/${res.user.id}/${res.user.avatar}.png?size=2048`
    }
    else {
        let defaultAvatar

        switch (res.user.discriminator % 5) {
            case 0:
                defaultAvatar = 'blue'
                break

            case 1:
                defaultAvatar = 'grey'
                break

            case 2:
                defaultAvatar = 'green'
                break

            case 3:
                defaultAvatar = 'orange'
                break

            case 4:
                defaultAvatar = 'red'
                break
        }

        avatar.src = `/images/discord/${defaultAvatar}.png`
    }

    document.querySelector('.profile').onclick = () => {
        const dropdown = document.querySelector('.top-right > .dropdown-menu')
        dropdown.hidden = !dropdown.hidden
    }

    res = await postAsync('/notification') 

    if (res.result == 'error') {
        throw new Error(res.error)
    }

    for (const notification of res.notification) (
        await Swal.fire({
            icon: 'info',
            title: '알림',
            html: notification.content,
            confirmButtonText: '확인',
        })
    )
}
catch (error) {
    await showError(error)
}

async function showError(error) {
    const res = await Swal.fire({
        icon: 'error',
        title: '오류',
        html: error.message,
        showCancelButton: true,
        confirmButtonText: '새로고침',
        cancelButtonText: '로그아웃',
        showOutsideClick: false,
    })

    if (res.isConfirmed) {
        location.reload()
    }
    else {
        await fetch('/signout')
        location.reload()
    }
}