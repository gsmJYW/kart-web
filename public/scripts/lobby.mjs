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

function buildGameCard(gameId, mode, trackType, banpickAmount) {
    let title

    switch (mode) {
        case 'speed':
            title = '스피드'
            break

        case 'item':
            title = '아이템'
            break
    }

    title += ' / '

    switch (trackType) {
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

    document.querySelector('#game-card-title').textContent = title
    document.querySelector('#banpick-amount').textContent = banpickAmount
    document.querySelector('#game-card').hidden = false
    document.querySelector('#show-game-id').addEventListener('click', async () => {
        await Swal.fire({
            title: `초대 코드`,
            html: gameId,
            confirmButtonText: '확인',
        })
    })
    document.querySelector('#close-game').addEventListener('click', async () => {
        try {
            const res = await postAsync('/game/close')

            if (res.result == 'error') {
                throw new Error(res.error)
            }

            document.querySelector('#game-card').hidden = true
        }
        catch (error) {
            await Swal.fire({
                icon: 'warning',
                html: error.message,
                confirmButtonText: '확인',
            })
        }
    })
}

try {
    const res = await postAsync('/game')

    if (res.result == 'error') {
        throw new Error(res.error)
    }

    if (res.game.id) {
        buildGameCard(res.game.id, res.game.mode, res.game.track_type, res.game.banpick_amount)
    }
}
catch (error) {
    await Swal.fire({
        icon: 'warning',
        html: error.message,
        confirmButtonText: '확인',
    })
}

document.querySelector('#signout').addEventListener('click', async () => {
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
})

document.querySelector('#join').addEventListener('click', async () => {
    const res = await Swal.fire({
        title: '초대 코드 입력',
        input: 'text',
        showCancelButton: true,
        confirmButtonText: '확인',
        cancelButtonText: '취소',
    })

    if (res.isConfirmed) {
        const gameId = res.value.trim()

        if (/[^A-Za-z0-9]/g.test(gameId) || gameId.length != 6) {
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
                icon: 'warning',
                html: error.message,
                confirmButtonText: '확인',
            })
        }
    }
})

for (const random of document.querySelectorAll('.track-type-list > img')) {
    random.addEventListener('click', async (e) => {
        const trackType = e.target.id
        let mode = 'item'

        if (trackType != 'crazy') {
            const res = await Swal.fire({
                html: `<img src="/images/${trackType}.png" />`,
                input: 'radio',
                inputOptions: {
                    'item': '아이템전',
                    'speed': '스피드전',
                },
                inputValue: 'speed',
                showCancelButton: true,
                confirmButtonText: '확인',
                cancelButtonText: '취소',
                inputValidator: (value) => {
                    if (!value) {
                        return '모드를 선택해주세요!'
                    }
                }
            })
            mode = res.value
        }

        let banpickAmount = 0

        if (mode) {
            try {
                let res = await postAsync('/tracks', { track_type: trackType, mode: mode })

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
                    title: '밴픽 트랙 수',
                    icon: 'question',
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
                    icon: 'warning',
                    html: error.message,
                    confirmButtonText: '확인',
                })
            }
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
                    mode: mode,
                    track_type: trackType,
                    banpick_amount: banpickAmount,
                })

                if (res.result == 'error') {
                    throw new Error(res.error)
                }

                buildGameCard(res.game_id, mode, trackType, banpickAmount)

                await Swal.fire({
                    title: `게임 생성 완료`,
                    icon: 'success',
                    html: `초대 코드: <strong>${res.game_id}</strong> <br> 사이트에서 나가셔도 취소되지 않습니다.`,
                    confirmButtonText: '확인',
                })
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