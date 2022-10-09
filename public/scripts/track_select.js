function postAsync(url, params = {}) {
    return new Promise((resolve, reject) => {
        fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
        }).then(async (res) => {
            resolve(await res.json())
        }).catch((error) => reject(error))
    })
}

for (const random of document.querySelectorAll('.random-list > img')) {
    random.addEventListener('click', async (e) => {
        const randomType = e.target.id
        let mode = 'item'

        if (randomType != 'crazy') {
            const res = await Swal.fire({
                html: `<img src="/images/${randomType}.png" />`,
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

        if (mode) {
            try {
                let res = await postAsync('/trackAmount', { track_type: randomType, mode: mode })

                if (res.result == 'error') {
                    throw new Error(res.error)
                }

                if (res.trackAmount < 9) {
                    await Swal.fire({
                        icon: 'warning',
                        html: '트랙 수가 밴픽을 진행하기에 부족합니다.'
                    })
                    return
                }

                res = await Swal.fire({
                    title: '밴픽 트랙 수',
                    icon: 'question',
                    input: 'range',
                    inputLabel: (randomType == 'crazy' ? '주의: 크레이지는 아이템전만 가능합니다.\n' : '') + '아래 만큼의 트랙을 랜덤으로 뽑아 밴픽을 진행합니다.',
                    inputAttributes: {
                        min: 9,
                        max: res.trackAmount,
                        step: 1
                    },
                    inputValue: Math.round(9 + (res.trackAmount - 9) / 2),
                    showCancelButton: true,
                    confirmButtonText: '확인',
                    cancelButtonText: '취소',
                })

                const banpickAmount = res.value
            }
            catch (error) {
                await Swal.fire({
                    icon: 'error',
                    html: `트랙 수를 받아오는 도중 오류가 발생 하였습니다. <br> ${error}`,
                    confirmButtonText: '확인',
                })
            }
        }
    })
}