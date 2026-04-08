export function credencialesHtml({ nombre, correo, pin, rol, loginUrl }) {
  return `
  <!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8">
    <title>Bienvenido</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:Inter,Arial,Helvetica,sans-serif;color:#111">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eee;">
            <tr>
              <td style="background:#111;color:#fff;padding:28px 28px;font-size:22px;font-weight:700;letter-spacing:0.3px;">
                Jhoann Barber
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Bienvenido${
                  nombre ? ", " + nombre : ""
                }</div>
                <div style="font-size:14px;line-height:1.6;margin-top:6px;">Tu acceso al sistema ha sido creado.</div>
                <div style="margin-top:18px;padding:16px;border:1px dashed #ddd;border-radius:12px;background:#fafafa;">
                  <div style="font-size:13px;color:#666;margin-bottom:6px;">Correo electrónico</div>
                  <div style="font-size:16px;font-weight:600;">${correo}</div>
                  <div style="height:12px;"></div>
                  <div style="font-size:13px;color:#666;margin-bottom:6px;">PIN temporal</div>
                  <div style="font-size:24px;font-weight:800;letter-spacing:2px;">${pin}</div>
                  <div style="height:12px;"></div>
                  <div style="font-size:13px;color:#666;margin-bottom:6px;">Rol asignado</div>
                  <div style="font-size:16px;font-weight:600;">${rol}</div>
                </div>
                <a href="${loginUrl}" style="display:inline-block;margin-top:22px;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">Iniciar sesión</a>
                <div style="font-size:12px;color:#666;margin-top:16px;">Por seguridad, cambia tu PIN al ingresar.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #eee;font-size:12px;color:#777;">
                © ${new Date().getFullYear()} Jhoann Barber. Todos los derechos reservados.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}
