const form = document.querySelector('#login-form');
const message = document.querySelector('#login-error');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  message.hidden = true;
  try {
    const response = await fetch('/web/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginName: form.elements.loginName.value, password: form.elements.password.value }),
    });
    if (!response.ok) throw new Error((await response.json()).message || '로그인에 실패했습니다.');
    location.assign('/');
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
    button.disabled = false;
  }
});
