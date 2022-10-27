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

const riderName = res.value.trim()

if (res.isConfirmed) {
    try {
        const res = await fetch('/signup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                rider_name: riderName,
            }),
        })

        const json = await res.json()

        if (json.result == 'error') {
            throw new Error(json.error)
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
else {
    await fetch('/signout')
}

location.reload()