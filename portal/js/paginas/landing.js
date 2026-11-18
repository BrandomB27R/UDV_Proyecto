// Landing y acceso. Con sesión válida se entra directo al inicio del perfil (requisito 11).
import { api, token, borrarToken, ApiError } from "../api.js";
import { APP_NAME, RUTAS, tituloPestana } from "../config.js";
import { poner, mensaje } from "../dom.js";
import { iniciarSesion } from "../sesion.js";

tituloPestana(null);
document.querySelectorAll('[data-app="nombre"]').forEach((el) => { el.textContent = APP_NAME; });
document.querySelectorAll('[data-app="anio"]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });

const form = document.getElementById("acceso");
const aviso = document.getElementById("login-aviso");
const correo = document.getElementById("correo");
const clave = document.getElementById("clave");
const boton = document.getElementById("entrar");

if (new URLSearchParams(location.search).get("sesion") === "vencida") {
  poner(aviso, mensaje("info", "Tu sesión terminó. Vuelve a iniciar sesión."));
  history.replaceState(null, "", RUTAS.landing);
}

// ¿Ya hay sesión? Se comprueba con /me; si el token no sirve, se borra y se queda aquí.
if (token()) {
  try {
    await api("/me", { sin401: true });
    location.replace(RUTAS.inicio);
  } catch {
    borrarToken();
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  poner(aviso);
  correo.removeAttribute("aria-invalid");
  clave.removeAttribute("aria-invalid");
  if (!correo.value.trim()) { correo.setAttribute("aria-invalid", "true"); correo.focus(); poner(aviso, mensaje("error", "Escribe tu correo.")); return; }
  if (!clave.value) { clave.setAttribute("aria-invalid", "true"); clave.focus(); poner(aviso, mensaje("error", "Escribe tu contraseña.")); return; }
  boton.disabled = true;
  boton.textContent = "Entrando…";
  try {
    await iniciarSesion(correo.value.trim(), clave.value);
    location.replace(RUTAS.inicio);
  } catch (err) {
    // Un 422 por contraseña corta no debe revelar nada distinto de un 401: solo se
    // señala el correo cuando details trae ese campo.
    const correoInvalido = err instanceof ApiError && err.status === 422 && err.details && typeof err.details === "object"
      && ("correo" in err.details || err.campo === "correo");
    const texto = correoInvalido ? "Revisa el correo: no parece válido."
      : err instanceof ApiError && [401, 422].includes(err.status) ? "Correo o contraseña incorrectos."
      : err.message;
    if (correoInvalido) correo.setAttribute("aria-invalid", "true");
    poner(aviso, mensaje("error", texto));
    clave.value = "";
    clave.focus();
    boton.disabled = false;
    boton.textContent = "Entrar";
  }
});
