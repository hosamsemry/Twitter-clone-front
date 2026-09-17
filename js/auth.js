const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const errorNote = document.getElementById('errorNote');
const formHeaderTitle = document.getElementById('formHeaderTitle');

document.getElementById('switchToRegister').addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.style.display = 'none';
  registerForm.style.display = 'flex';
  document.getElementById('switchToRegisterWrap').style.display = 'none';
  document.getElementById('switchToLoginWrap').style.display = 'block';
  if (formHeaderTitle) formHeaderTitle.textContent = 'Create your account';
  errorNote.classList.remove('show');
  document.getElementById('regUsername').focus();
});

document.getElementById('switchToLogin').addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.style.display = 'none';
  loginForm.style.display = 'flex';
  document.getElementById('switchToLoginWrap').style.display = 'none';
  document.getElementById('switchToRegisterWrap').style.display = 'block';
  if (formHeaderTitle) formHeaderTitle.textContent = 'Sign in to 𝕏';
  errorNote.classList.remove('show');
  document.getElementById('loginEmailOrUsername').focus();
});

function showError(msg) {
  errorNote.textContent = msg;
  errorNote.classList.add('show');
}

// After getting a token, decode the JWT for the id, then pull the full profile from /users/profile.
async function loadProfileAfterAuth(token) {
  setToken(token);
  try {
    const profile = await api('/users/profile');
    setUser(profile);
  } catch (_) {
    const decoded = parseJwt(token);
    setUser({ _id: decoded?.id });
  }
  window.location.href = 'feed.html';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorNote.classList.remove('show');
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';

  const emailOrUsername = document.getElementById('loginEmailOrUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      auth: false,
      body: { emailOrUsername, password },
    });
    await loadProfileAfterAuth(data.token);
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorNote.classList.remove('show');
  const submitBtn = registerForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';

  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;

  try {
    const data = await api('/auth/register', {
      method: 'POST',
      auth: false,
      body: { username, email, password },
    });
    await loadProfileAfterAuth(data.token);
  } catch (err) {
    showError(err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create account';
  }
});

// Already signed in? skip straight to the feed.
if (getToken()) window.location.href = 'feed.html';
