const res = await Swal.fire({
    icon: 'success',
    title: '거의 다 왔어요',
    html: '카트라이더 인게임 라이더명을 입력해주세요. <br> 추후 인게임에서 변경 시 자동으로 업데이트 되며 <br> 가입 후 수정 가능합니다.',
    input: 'text',
    showCancelButton: true,
    confirmButtonText: '가입',
    cancelButtonText: '취소',
    allowOutsideClick: false,
})

if (res.isConfirmed) {
    const riderName = res.value.trim()

    try {
        const res = await postAsync('/signup', {
            rider_name: riderName,
        })

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
else {
    await fetch('/signout')
}

location.reload()

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