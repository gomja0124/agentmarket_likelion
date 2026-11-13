const form = document.querySelector('#register-form');
const message = document.querySelector('#register-error');
const selling = new URLSearchParams(location.search).get('next') === 'sell';
if (selling) {
  form.querySelector('.auth-switch a').href = '/login?next=sell';
  form.querySelector('p').textContent = '계정을 만들면 바로 내 매물 등록 화면으로 이동합니다.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  message.hidden = true;
  if (form.elements.password.value !== form.elements.passwordConfirm.value) {
    message.textContent = '비밀번호 확인이 일치하지 않습니다.';
    message.hidden = false;
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch('/web/register', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: form.elements.loginName.value, nickname: form.elements.nickname.value,
        password: form.elements.password.value }),
    });
    if (!response.ok) throw new Error((await response.json()).message || '회원가입에 실패했습니다.');
    location.assign(selling ? '/#sell' : '/');
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
    button.disabled = false;
  }
});
