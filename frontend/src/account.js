const form = document.querySelector('#account-form');
const message = document.querySelector('#account-message');
let csrfToken = '';
const session = await fetch('/web/session', { credentials: 'same-origin' }).then(response => response.json());
if (!session.authenticated) location.replace('/login');
else csrfToken = session.csrfToken;
form.addEventListener('submit', async event => {
  event.preventDefault(); message.hidden = true;
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const response = await fetch('/web/recovery-code', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ password: form.elements.password.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '복구 코드 발급에 실패했습니다.');
    form.elements.password.value = '';
    document.querySelector('#account-code').textContent = result.recoveryCode;
    document.querySelector('#account-result').hidden = false;
    message.textContent = '새 코드가 발급됨. 이 화면을 떠나면 다시 표시되지 않음.'; message.hidden = false;
  } catch (error) { message.textContent = error.message; message.hidden = false; }
  finally { button.disabled = false; }
});
document.querySelector('#copy-account-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.querySelector('#account-code').textContent); }
  catch { document.querySelector('#account-code').focus(); }
});
