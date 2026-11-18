const form = document.querySelector('#recover-form');
const message = document.querySelector('#recover-message');
form.addEventListener('submit', async event => {
  event.preventDefault(); message.hidden = true;
  if (form.elements.newPassword.value !== form.elements.passwordConfirm.value) {
    message.textContent = '새 비밀번호 확인이 일치하지 않습니다.'; message.hidden = false; return;
  }
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const response = await fetch('/web/reset-password', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        loginName: form.elements.loginName.value, recoveryCode: form.elements.recoveryCode.value,
        newPassword: form.elements.newPassword.value,
      }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '계정 복구에 실패했습니다.');
    message.textContent = '비밀번호를 재설정했음. 모든 기존 로그인과 Agent 토큰이 해제됐음. 새 비밀번호로 로그인해 주세요.';
    message.hidden = false; form.reset();
  } catch (error) { message.textContent = error.message; message.hidden = false; }
  finally { button.disabled = false; }
});
